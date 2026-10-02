# Scraper PJe - Tribunal Regional Federal da 5ª Região

Scraper desarrollado en TypeScript para consultar información pública del sistema PJe del Tribunal Regional Federal da 5ª Região (TRF5), extraer información de los procesos y sus documentos, y descargar los PDFs asociados.

El scraper utiliza exclusivamente requests HTTP y parsing HTML. No utiliza automatización de navegador.

## Sitio objetivo

https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam

## Tecnologías utilizadas

- TypeScript
- Node.js
- Axios
- Cheerio

No se utilizan librerías de automatización de navegador como Puppeteer, Playwright o Selenium.

## Requisitos

- Node.js
- npm

## Instalación

Clonar el repositorio:

git clone 

## Instalar las dependencias:

npm install

## Ejecución

 - El programa solicita diferentes parámetros de búsqueda de forma interactiva.

Los campos disponibles son:

Número de proceso
Proceso de referencia
Nombre de la parte
Nombre del abogado
Clase judicial
Documento de la parte CPF/CNPJ
Número de OAB
UF de la OAB
Fecha desde
Fecha hasta

- Los campos pueden dejarse vacíos presionando Enter.

## Funcionamiento

El scraper realiza las siguientes etapas:

- Inicia una sesión con el sitio público del PJe.

- Obtiene y conserva las cookies de sesión.

- Analiza el formulario de consulta.

- Construye los parámetros de búsqueda.

- Realiza la consulta mediante una request HTTP.

- Extrae los procesos encontrados.

- Accede al detalle de cada proceso.

- Extrae los documentos asociados.

- Identifica las diferentes estructuras utilizadas por el sitio para acceder a los documentos.

- Descarga los PDFs.

- Guarda la información estructurada en formato JSON.

- Guarda el progreso durante la ejecución.

- Extracción de procesos

Para cada proceso se obtiene información como:

- Detalle
- Número de proceso
- Último movimiento
- URL del detalle
- Documentos asociados

## Extracción de documentos

El sitio utiliza diferentes estructuras para acceder a los documentos.

El scraper contempla documentos que utilizan URLs directas y documentos que requieren acceder primero a una página intermedia para generar el PDF.

Para los documentos se extraen, cuando están disponibles:

- Nombre
- URL
- idBin
- idProcessoDocumento
- idProcessoDoc
- idProcDocBin
- idProcessoTrf
- Número de documento
- Nombre del archivo
- URL del recibo
- Nombre del archivo descargado
- Estado de descarga

## Descarga de PDFs

Los PDFs se guardan dentro de la carpeta downloads.

Cada proceso tiene su propia carpeta y cada documento recibe un nombre descriptivo.

Ejemplo:

downloads/
└── 0001234-56.2025.4.05.0001/
    ├── 001_DOCUMENTO.pdf
    ├── 002_PETICION.pdf
    └── 003_SENTENCIA.pdf

Antes de descargar un documento, el scraper verifica si el archivo ya existe.

Si el PDF ya existe, se omite la descarga para evitar realizar requests innecesarias.

## Manejo de errores 429

El scraper implementa manejo específico para respuestas HTTP 429 Too Many Requests.

Cuando se recibe un error 429 se realizan reintentos utilizando backoff exponencial.

La espera utilizada es:

1 segundo
2 segundos
4 segundos
8 segundos

El scraper permite hasta 4 reintentos adicionales.

Si el documento continúa fallando después de los reintentos, la ejecución continúa con el siguiente documento.

## Documentos fallidos

Los documentos que no pudieron descargarse se registran en:

failed-downloads.json

El archivo contiene información como:

- Nombre del documento
- URL
- Número de proceso
- Error
- Cantidad de intentos
- Fecha del error

Los documentos fallidos se identifican por su URL para evitar duplicados.

Cuando un documento que había fallado posteriormente se descarga correctamente, su registro se elimina de failed-downloads.json.

Si no existen documentos fallidos, el archivo contiene:

[]

## Datos estructurados

La información de los procesos y documentos se guarda en:

output/processes.json

El scraper guarda el progreso después de procesar cada proceso para reducir la posibilidad de perder información si la ejecución se interrumpe.

## Límite de resultados

La consulta pública del PJe utilizada durante el desarrollo devuelve como máximo *30 resultados*.

El scraper procesa todos los resultados disponibles en la respuesta recibida y no establece artificialmente un límite de 30 resultados.

*Durante las pruebas realizadas no se identificó una segunda página de resultados disponible a través de la consulta pública utilizada.*

Por lo tanto, una ejecución puede procesar hasta 30 procesos cuando la consulta devuelve el máximo observado.

Este comportamiento corresponde a la consulta pública utilizada y debe tenerse en cuenta al evaluar el alcance de una ejecución.

## Delays

Para reducir la cantidad de requests realizadas al servidor, el scraper incorpora un delay entre las descargas de documentos.

Actualmente se utiliza un delay de 1 segundo entre documentos.

## Estructura del proyecto

scraper-challenge/
│
├── src/
│   └── index.ts
│
├── downloads/
│   └── PDFs descargados
│
├── output/
│   └── processes.json
│
├── failed-downloads.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── .gitignore
└── README.md

Las carpetas y archivos generados durante la ejecución pueden excluirse del repositorio mediante .gitignore.

El scraper contempla diferentes situaciones que pueden ocurrir durante una ejecución:

- Errores HTTP
- Respuestas 429
- Reintentos con backoff exponencial
- Documentos que no pueden descargarse
- PDFs que ya fueron descargados
- Respuestas que no contienen un PDF válido
- Documentos con diferentes estructuras dentro del sitio
- Interrupciones durante ejecuciones largas mediante guardado de progreso


## Alcance del desafío

El scraper fue desarrollado para demostrar:

- Navegación mediante requests HTTP
- Análisis de formularios HTML
- Manejo de sesiones y cookies
- Parsing HTML con Cheerio
- Extracción de información de procesos
- Extracción de información de documentos
- Descarga de archivos PDF
- Manejo de rate limiting
- Reintentos con backoff exponencial
- Registro de errores
- Persistencia de datos estructurados
- Guardado incremental del progreso

## Consideraciones

Este proyecto fue desarrollado exclusivamente como ejercicio técnico de scraping sobre la información pública disponible en el sitio indicado.

El scraper está diseñado para realizar requests de forma controlada mediante delays y mecanismos de retry para reducir la carga sobre el servidor.