import axios, { type AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import path from "path";
import readline from "readline";

interface Process {
    detail: string;
    processNumber: string;
    lastMovement: string;
    detailUrl: string;
    documents: Document[];
}

interface Document {
    name: string;
    url: string;
    onclick: string;
    idBin?: string;
    idProcessoDocumento?: string;
    idProcessoDoc?: string;
    idProcDocBin?: string;
    idProcessoTrf?: string;
    numeroDocumento?: string;
    nomeArqProcDocBin?: string;
    receiptUrl?: string;
    fileName?: string;
    downloaded?: boolean;
}

interface FailedDownload {
    name: string;
    url: string;
    processNumber: string;
    error: string;
    attempts: number;
    date: string;
}

// ============================================================
// CONFIGURACION
// ============================================================

const url = "https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam";
const downloadsDir = path.join(process.cwd(), "downloads");
const outputDir = path.join(process.cwd(), "output");
const failedDownloadsPath = path.join(process.cwd(), "failed-downloads.json");
const processesJsonPath = path.join(outputDir, "processes.json");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const MAX_RETRIES = 4;
const DOWNLOAD_DELAY = 1000;

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_").substring(0, 150);
}

function askQuestion(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function loadFailedDownloads(): Promise<FailedDownload[]> {
    try {
        const content = await fs.readFile(failedDownloadsPath, "utf-8");
        return JSON.parse(content) as FailedDownload[];
    } catch {
        return [];
    }
}

async function saveFailedDownloads(failedDownloads: FailedDownload[]): Promise<void> {
    await fs.writeFile(failedDownloadsPath, JSON.stringify(failedDownloads, null, 2), "utf-8");
}

function addFailedDownload(failedDownloads: FailedDownload[], failure: FailedDownload): void {
    const existingIndex = failedDownloads.findIndex((item) => item.url === failure.url);

    if (existingIndex >= 0) {
        failedDownloads[existingIndex] = failure;
        return;
    }

    failedDownloads.push(failure);
}

function removeFailedDownload(failedDownloads: FailedDownload[], documentUrl: string): void {
    const filtered = failedDownloads.filter((item) => item.url !== documentUrl);
    failedDownloads.length = 0;
    failedDownloads.push(...filtered);
}

async function saveProcesses(processes: Process[]): Promise<void> {
    await fs.writeFile(processesJsonPath, JSON.stringify(processes, null, 2), "utf-8");
}

async function requestWithRetry<T>(request: () => Promise<AxiosResponse<T>>): Promise<AxiosResponse<T>> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await request();

        if (response.status !== 429) {
            return response;
        }

        if (attempt >= MAX_RETRIES) {
            throw new Error("429 Too Many Requests");
        }

        const delay = 1000 * Math.pow(2, attempt);

        console.log(`429 recibido. Esperando ${delay} ms...`);

        await sleep(delay);
    }

    throw new Error("No se pudo completar la solicitud.");
}

// ============================================================
// DESCARGAR PDF CON RETRY
// ============================================================

async function downloadPdf(
    document: Document,
    filePath: string,
    cookieHeader: string,
    detailUrl: string,
    processNumber: string,
    failedDownloads: FailedDownload[]
): Promise<boolean> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`Intento ${attempt + 1}/${MAX_RETRIES + 1}`);

            let response;

            // ====================================================
            // DOCUMENTO NUEVO
            // ====================================================

            if (document.url.includes("documentoSemLoginHTML.seam")) {
                const htmlResponse = await axios.get(document.url, {
                    headers: {
                        Cookie: cookieHeader,
                        "User-Agent": USER_AGENT,
                        Referer: detailUrl
                    },
                    responseType: "text",
                    validateStatus: (status) => status >= 200 && status < 500
                });

                if (htmlResponse.status === 429) {
                    if (attempt >= MAX_RETRIES) {
                        throw new Error("429 Too Many Requests");
                    }

                    const delay = 1000 * Math.pow(2, attempt);
                    console.log(`429 recibido. Esperando ${delay} ms...`);
                    await sleep(delay);
                    continue;
                }

                if (htmlResponse.status < 200 || htmlResponse.status >= 300) {
                    throw new Error(`HTTP ${htmlResponse.status}`);
                }

                const $document = cheerio.load(htmlResponse.data);

                const form = $document("form#j_id42");

                if (!form.length) {
                    throw new Error("No se encontro el formulario de descarga PDF.");
                }

                const action = form.attr("action") ?? document.url;

                const viewState = form.find("input[name='javax.faces.ViewState']").attr("value") ?? "";
                const formId = form.find("input[name='j_id42']").attr("value") ?? "j_id42";

                const downloadLink = form.find("a#j_id42\\:downloadPDF");

                const onclick = downloadLink.attr("onclick") ?? "";

                const caMatch = onclick.match(/'ca':'([^']+)'/);
                const idProcDocBinMatch = onclick.match(/'idProcDocBin':'([^']+)'/);

                const ca = caMatch?.[1] ?? "";
                const idProcDocBin = idProcDocBinMatch?.[1] ?? "";
                document.idProcDocBin = idProcDocBin;

                if (!ca || !idProcDocBin) {
                    throw new Error("No se pudieron obtener ca o idProcDocBin.");
                }

                if (!viewState) {
                    throw new Error("No se encontro javax.faces.ViewState.");
                }

                const pdfData = new URLSearchParams();

                pdfData.append("j_id42", formId);
                pdfData.append("javax.faces.ViewState", viewState);
                pdfData.append("j_id42:downloadPDF", "j_id42:downloadPDF");
                pdfData.append("ca", ca);
                pdfData.append("idProcDocBin", idProcDocBin);

                console.log("Generando PDF...");
                console.log("idProcDocBin:", idProcDocBin);

                response = await axios.post(
                    new URL(action, document.url).toString(),
                    pdfData.toString(),
                    {
                        headers: {
                            Cookie: cookieHeader,
                            "User-Agent": USER_AGENT,
                            Referer: document.url,
                            "Content-Type": "application/x-www-form-urlencoded",
                            Accept: "application/pdf,*/*"
                        },
                        responseType: "arraybuffer",
                        validateStatus: (status) => status >= 200 && status < 500
                    }
                );
            } else {
                // ====================================================
                // DOCUMENTO VIEJO
                // ====================================================

                response = await axios.get(document.url, {
                    headers: {
                        Cookie: cookieHeader,
                        "User-Agent": USER_AGENT,
                        Referer: detailUrl
                    },
                    responseType: "arraybuffer",
                    validateStatus: (status) => status >= 200 && status < 500
                });
            }

            // ====================================================
            // ERROR 429
            // ====================================================

            if (response.status === 429) {
                if (attempt >= MAX_RETRIES) {
                    throw new Error("429 Too Many Requests");
                }

                const delay = 1000 * Math.pow(2, attempt);
                console.log(`429 recibido. Esperando ${delay} ms...`);
                await sleep(delay);
                continue;
            }

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`HTTP ${response.status}`);
            }

            // ====================================================
            // VERIFICAR PDF
            // ====================================================

            const contentType = String(response.headers["content-type"] ?? "");

            const firstBytes = Buffer.from(response.data).subarray(0, 5).toString();

            if (!contentType.toLowerCase().includes("application/pdf") && firstBytes !== "%PDF-") {
                throw new Error(`La respuesta no es un PDF. Content-Type: ${contentType}`);
            }

            // ====================================================
            // GUARDAR PDF
            // ====================================================

            await fs.writeFile(filePath, response.data);

            console.log("PDF guardado correctamente.");

            removeFailedDownload(failedDownloads, document.url);
            await saveFailedDownloads(failedDownloads);

            return true;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;

                if (status === 429) {
                    if (attempt >= MAX_RETRIES) {
                        console.log("Se alcanzo el maximo de reintentos.");
                    } else {
                        const delay = 1000 * Math.pow(2, attempt);
                        console.log(`429 recibido. Esperando ${delay} ms...`);
                        await sleep(delay);
                        continue;
                    }
                }

                console.error("Error HTTP:", status);
                console.error("Mensaje:", error.message);
            } else {
                console.error("Error:", error);
            }

            addFailedDownload(failedDownloads, {
                name: document.name,
                url: document.url,
                processNumber,
                error: error instanceof Error ? error.message : String(error),
                attempts: attempt + 1,
                date: new Date().toISOString()
            });

            await saveFailedDownloads(failedDownloads);

            return false;
        }
    }

    return false;
}

// ============================================================
// PROGRAMA PRINCIPAL
// ============================================================

async function main() {
    // ============================================================
    // 1. CREAR CARPETAS
    // ============================================================

    await fs.mkdir(downloadsDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    // ============================================================
    // 2. OBTENER LA PAGINA INICIAL
    // ============================================================

        const response = await requestWithRetry(() => axios.get(url, {
        headers: {
            "User-Agent": USER_AGENT
        },
        validateStatus: (status) => status >= 200 && status < 500
    }));

    // ============================================================
    // 3. OBTENER LAS COOKIES DE SESION
    // ============================================================

    const cookies = response.headers["set-cookie"] ?? [];
    const cookieHeader = cookies.map((cookie) => cookie.split(";")[0]).join("; ");

    console.log("Sesion iniciada");

    // ============================================================
    // 4. PARSEAR EL FORMULARIO
    // ============================================================

    const $ = cheerio.load(response.data);

    // Bloque usado durante el desarrollo para inspeccionar los campos
    // del formulario. Se conserva comentado para futuras tareas
    // de depuracion.

/*
    $("form#fPP input, form#fPP select, form#fPP textarea").each((_, element) => {
        const name = $(element).attr("name") ?? "";
        const id = $(element).attr("id") ?? "";
        const type = $(element).attr("type") ?? "";

        const parentText = $(element).parent().text().replace(/\s+/g, " ").trim();

        console.log({
            name,
            id,
            type,
            parentText
        });
    });
*/

    const formData: Record<string, string> = {};

    $("form#fPP [name]").each((_, element) => {
        const name = $(element).attr("name");

        if (!name) {
            return;
        }

        const value = $(element).attr("value") ?? "";
        formData[name] = value;
    });

    const estadoOptions: { value: string; text: string }[] = [];

    $("select[name='fPP:Decoration:estadoComboOAB'] option").each((_, element) => {
        estadoOptions.push({
            value: $(element).attr("value") ?? "",
            text: $(element).text().replace(/\s+/g, " ").trim()
        });
    });

    // ============================================================
    // 5. DATOS DE LA BUSQUEDA
    // ============================================================

    const numeroProcesso = await askQuestion("Numero de proceso (Enter para omitir): ");

    if (numeroProcesso) {
        formData["fPP:numProcesso-inputNumeroProcessoDecoration:numProcesso-inputNumeroProcesso"] = numeroProcesso;
    }

    const processoReferencia = await askQuestion("Proceso de referencia (Enter para omitir): ");

    if (processoReferencia) {
        formData["fPP:j_id162:processoReferenciaInput"] = processoReferencia;
    }

    const nomeParte = await askQuestion("Nombre de la parte (Enter para omitir): ");

    if (nomeParte) {
        formData["fPP:dnp:nomeParte"] = nomeParte;
    }

    const nomeAdv = await askQuestion("Nombre del abogado (Enter para omitir): ");

    if (nomeAdv) {
        formData["fPP:j_id180:nomeAdv"] = nomeAdv;
    }

    const classeJudicial = await askQuestion("Clase judicial (Enter para omitir): ");

    if (classeJudicial) {
        formData["fPP:j_id189:classeJudicial"] = classeJudicial;
    }

    const documentoParte = await askQuestion("Documento de la parte CPF/CNPJ (Enter para omitir): ");

    if (documentoParte) {
        formData["fPP:dpDec:documentoParte"] = documentoParte;
    }

    const numeroOAB = await askQuestion("Numero de OAB (Enter para omitir): ");

    if (numeroOAB) {
        formData["fPP:Decoration:numeroOAB"] = numeroOAB;
    }

    // console.log("\nEstados disponibles:");

    // estadoOptions.forEach((option, index) => {
    //     if (index > 0) {
    //         console.log(`${index}. ${option.text}`);
    //     }
    // });

    const estadoInput = await askQuestion("Seleccione UF de la OAB (Enter para omitir): ");

    if (estadoInput) {
        const estadoIndex = Number(estadoInput);
        const selectedEstado = estadoOptions[estadoIndex];

        if (selectedEstado) {
            formData["fPP:Decoration:estadoComboOAB"] = selectedEstado.value;
        }
    }

    const dataInicio = await askQuestion("Fecha desde (dd/mm/aaaa) (Enter para omitir): ");

    if (dataInicio) {
        formData["fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputDate"] = dataInicio;
    }

    const dataFim = await askQuestion("Fecha hasta (dd/mm/aaaa) (Enter para omitir): ");

    if (dataFim) {
        formData["fPP:dataAutuacaoDecoration:dataAutuacaoFimInputDate"] = dataFim;
    }

    // ============================================================
    // 6. PARAMETROS AJAX
    // ============================================================

    formData["AJAXREQUEST"] = "_viewRoot";
    formData["fPP:j_id244"] = "fPP:j_id244";
    formData["AJAX:EVENTS_COUNT"] = "1";

    // ============================================================
    // 7. REALIZAR LA BUSQUEDA
    // ============================================================

    const searchParams = new URLSearchParams(formData);

    const searchResponse = await requestWithRetry(() => axios.post(url, searchParams.toString(), {
        headers: {
            Accept: "*/*",
            "Accept-Language": "es-AR,es;q=0.9,en-US;q=0.8,en;q=0.7",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Cookie: cookieHeader,
            Origin: "https://pjett.trf5.jus.br",
            Referer: url,
            "User-Agent": USER_AGENT,
            "X-Requested-With": "XMLHttpRequest"
        },
        validateStatus: (status) => status >= 200 && status < 500
    }));
    // ============================================================
    // 8. INFORMACION DE LA RESPUESTA
    // ============================================================

    console.log("\nSTATUS:", searchResponse.status);

    // ============================================================
    // 9. OBTENER LOS PROCESOS
    // ============================================================

    const $results = cheerio.load(searchResponse.data);
    const rows = $results('tbody[id="fPP:processosTable:tb"] tr');

    console.log("\nCANTIDAD DE PROCESOS:", rows.length);

    // ============================================================
    // 10. CONVERTIR LOS PROCESOS EN OBJETOS
    // ============================================================

    const processes: Process[] = rows.map((_, element) => {
        const cells = $results(element).find("td").map((_, td) => $results(td).text().replace(/\s+/g, " ").trim()).get();
        const link = $results(element).find("a").first();
        const onclick = link.attr("onclick");
        let detailUrl = "";

        if (onclick) {
            const match = onclick.match(/openPopUp\('.*?','([^']+)'\)/);

            if (match && match[1]) {
                detailUrl = new URL(match[1], url).toString();
            }
        }

        // ====================================================
        // EXTRAER NUMERO REAL DEL PROCESO
        // ====================================================

        const processNumberMatch = (cells[1] ?? "").match(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/);
        const processNumber = processNumberMatch?.[0] ?? cells[1] ?? "";

        return {
            detail: cells[0] ?? "",
            processNumber,
            lastMovement: cells[2] ?? "",
            detailUrl,
            documents: []
        };
    }).get();

    // ============================================================
    // 11. GUARDAR DOCUMENTOS FALLIDOS
    // ============================================================

    const failedDownloads = await loadFailedDownloads();

    // ============================================================
    // 12. PROCESAR LOS PROCESOS
    // ============================================================

    for (let processIndex = 0; processIndex < processes.length; processIndex++) {
        const process = processes[processIndex];

        if(!process) continue;

        console.log("\n========================================");
        console.log(`PROCESO ${processIndex + 1}/${processes.length}`);
        console.log("Numero:", process.processNumber);
        console.log("Detalle:", process.detailUrl);
        console.log("========================================");

        if (!process.detailUrl) {
            console.log("No se encontro la URL del detalle.");
            continue;
        }

        // ========================================================
        // OBTENER DETALLE
        // ========================================================

        let detailResponse;

        try {
            detailResponse = await requestWithRetry(() => axios.get(process.detailUrl, {
                headers: {
                    Cookie: cookieHeader,
                    "User-Agent": USER_AGENT,
                    Referer: url
                },
                validateStatus: (status) => status >= 200 && status < 500
            }));

        } catch (error) {
            console.error("No se pudo obtener el detalle del proceso.");

            if (axios.isAxiosError(error)) {
                console.error("Status:", error.response?.status);
                console.error("Mensaje:", error.message);
            } else {
                console.error("Error:", error);
            }

            continue;
        }

        const $detail = cheerio.load(detailResponse.data);

        // ========================================================
        // EXTRAER DOCUMENTOS
        // ========================================================

        const documents: Document[] = [];

        $detail("a").each((_, element) => {
            const text = $detail(element).text().replace(/\s+/g, " ").trim();
            const href = $detail(element).attr("href") ?? "";
            const onclick = $detail(element).attr("onclick") ?? "";

            if (href && href.includes("idBin=") && href.includes("idProcessoDocumento=")) {
                const documentUrl = new URL(href, process.detailUrl);

                documents.push({
                    name: text,
                    url: documentUrl.toString(),
                    onclick,
                    idBin: documentUrl.searchParams.get("idBin") ?? "",
                    idProcessoDocumento: documentUrl.searchParams.get("idProcessoDocumento") ?? "",
                    numeroDocumento: documentUrl.searchParams.get("numeroDocumento") ?? "",
                    nomeArqProcDocBin: documentUrl.searchParams.get("nomeArqProcDocBin") ?? ""
                });

                return;
            }

            const documentMatch = onclick.match(/openPopUp\('[^']*',\s*'([^']*documentoSemLoginHTML\.seam[^']*)'/);
            const documentPath = documentMatch?.[1];

            if (!documentPath) {
                return;
            }

const documentUrl = new URL(documentPath, process.detailUrl);

            const idProcessoDoc = documentUrl.searchParams.get("idProcessoDoc") ?? "";

            if (!idProcessoDoc) {
                return;
            }

            let receiptUrl = "";

            $detail(element).parent().find("a").each((_, sibling) => {
                const siblingOnclick = $detail(sibling).attr("onclick") ?? "";

                const receiptMatch = siblingOnclick.match(/openPopUp\('[^']*',\s*'([^']*reportReciboPDF\.seam[^']*)'/);
                const receiptPath = receiptMatch?.[1];

                if (receiptPath) {
                    receiptUrl = new URL(receiptPath, process.detailUrl).toString();
}            });

            documents.push({
                name: text,
                url: documentUrl.toString(),
                onclick,
                idProcessoDoc,
                idBin: receiptUrl ? new URL(receiptUrl).searchParams.get("idBin") ?? "" : "",
                idProcessoTrf: receiptUrl ? new URL(receiptUrl).searchParams.get("idProcessoTrf") ?? "" : "",
                receiptUrl
            });
        });
        console.log("\nDOCUMENTOS ENCONTRADOS:", documents.length);

        documents.forEach((document, index) => {
            console.log(`Documento ${index + 1}: ${document.name}`);
            console.log(`URL: ${document.url}`);
            console.log(`idProcessoDoc: ${document.idProcessoDoc ?? "-"}`);
            console.log(`idBin: ${document.idBin ?? "-"}`);
            console.log(`receiptUrl: ${document.receiptUrl ?? "-"}`);
        });

        if (documents.length === 0) {
            console.log("No se encontraron documentos.");
        }

        // ========================================================
        // CREAR CARPETA DEL PROCESO
        // ========================================================

        const processFolderName = sanitizeName(process.processNumber || `process-${processIndex + 1}`);
        const processDir = path.join(downloadsDir, processFolderName);

        await fs.mkdir(processDir, { recursive: true });

        // ========================================================
        // DESCARGAR DOCUMENTOS
        // ========================================================

        for (let documentIndex = 0; documentIndex < documents.length; documentIndex++) {
            const document = documents[documentIndex];

            if(!document) continue;

            console.log(`\n[${documentIndex + 1}/${documents.length}]`);
            console.log("Documento:", document.name);

            const safeName = sanitizeName(document.name || `document-${documentIndex + 1}`);
            const fileName = `${String(documentIndex + 1).padStart(3, "0")}_${safeName}.pdf`;

            document.fileName = fileName;

            const filePath = path.join(processDir, fileName);

            // ====================================================
            // VERIFICAR SI YA EXISTE
            // ====================================================

            try {
                await fs.access(filePath);

                console.log("El PDF ya existe. Se omite.");

                document.downloaded = true;

                removeFailedDownload(failedDownloads, document.url);
                await saveFailedDownloads(failedDownloads);

                continue;
            } catch {
                // El archivo no existe.
            }
            // ====================================================
            // DESCARGAR PDF
            // ====================================================

            const success = await downloadPdf(
                document,
                filePath,
                cookieHeader,
                process.detailUrl,
                process.processNumber,
                failedDownloads
            );

            document.downloaded = success;

            if (!success) {
                console.log("No se pudo descargar el documento.");
            }

            // ====================================================
            // DELAY ENTRE DOCUMENTOS
            // ====================================================

            await sleep(DOWNLOAD_DELAY);
        }

        // ========================================================
        // ASOCIAR DOCUMENTOS AL PROCESO
        // ========================================================

        process.documents = documents;

        // ========================================================
        // GUARDAR PROGRESO
        // ========================================================

        // Guardar el progreso despues de cada proceso para no perder
        // informacion si el scraper se interrumpe durante una ejecucion larga.
        await saveProcesses(processes);

        console.log("Progreso guardado.");
    }

    // ============================================================
    // 13. GUARDAR DATOS ESTRUCTURADOS
    // ============================================================

    await saveProcesses(processes);

    // ============================================================
    // 14. FINALIZACION
    // ============================================================

    console.log("\n========================================");
    console.log("SCRAPER FINALIZADO");
    console.log("========================================");
    console.log("Procesos encontrados:", processes.length);
    console.log("Datos guardados en:", processesJsonPath);
    console.log("PDFs guardados en:", downloadsDir);
    console.log("Documentos fallidos:", failedDownloads.length);
}

// ============================================================
// MANEJO GENERAL DE ERRORES
// ============================================================

main().catch((error) => {
    console.error("\nERROR GENERAL:");

    if (axios.isAxiosError(error)) {
        console.error("Mensaje:", error.message);
        console.error("Status:", error.response?.status);
    } else {
        console.error("Error:", error);
    }
});