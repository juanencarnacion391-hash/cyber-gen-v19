# Cyber-Gen V15.2

Chat con Gemini (con fallback automático de modelos), gráficos dinámicos con Chart.js,
dictado y lectura por voz, adjuntos de Excel/CSV/PDF, e historial de conversaciones.

**Cero dependencias.** No usa npm, Vite, Node modules, ni nada que instalar. Solo
necesitas tener Node.js instalado (que ya tienes) para levantar un servidor local
mínimo incluido en `server.js`.

## Cómo correrlo

1. Abre una terminal (PowerShell o CMD) en esta carpeta.
2. Corre:

```
node server.js
```

3. Abre tu navegador en **http://localhost:5173**

Eso es todo. Para detenerlo, `Ctrl+C` en la terminal.

## Tu API key

Ya está puesta en `src/config.js`:

```js
window.GEMINI_API_KEY = "AQ.Ab8RN6KtxUV53NWwMT9RTgtY7l90WtSEigk5OJDya2AezzUjlQ";
```

Si necesitas cambiarla, edita ese archivo directamente. `src/config.example.js` es
una plantilla vacía por si quieres compartir el proyecto sin exponer tu clave real
(`config.js` está en `.gitignore` para que no se suba a git por accidente).

## Por qué se quitó Vite/npm

La versión anterior usaba Vite para leer la clave desde un archivo `.env`. En tu
máquina, Windows bloqueó un binario nativo que Vite/Rollup necesitan
(`rollup-win32-x64-msvc.node`) por una política de "Application Control" —
probablemente Smart App Control de Windows 11, un antivirus corporativo, o una
política de tu organización. Eso no se soluciona desde el código: hay que
autorizar el archivo en Windows Defender o pedirle a tu departamento de IT que lo
permita.

Para no depender de eso, reemplacé todo el mecanismo: ya no hay build step, ni
`node_modules`, ni binarios nativos de ningún tipo. `server.js` usa únicamente el
módulo `http` que viene incluido en Node, así que no hay nada que Windows pueda
bloquear.

## Qué se arregló / mejoró (acumulado)

- **Autenticación con el nuevo formato de clave (`AQ.`):** se manda por el header
  `X-goog-api-key`, no por `?key=` en la URL (que causaba el error 401
  `ACCESS_TOKEN_TYPE_UNSUPPORTED`).
- Modelos actualizados a los alias vigentes: `gemini-flash-latest`,
  `gemini-pro-latest`, con fallback a `gemini-2.5-flash` y `gemini-2.0-flash`.
- `index.html` ya no apunta a `script.js` (que no existía) ni depende de Vite.
- IDs del DOM en `index.html` y `src/main.js` ahora coinciden entre sí.
- Se implementaron todas las funciones que faltaban (historial, selector de
  modelo, manejo de audio, ajuste de input, envío de mensajes).
- Errores de conexión visibles directamente en el chat, no solo en la consola.
- Historial de conversaciones persistente en `localStorage`.
- Adjuntar Excel/CSV (convertido a CSV y enviado como contexto) y PDF (enviado
  como `inlineData` base64).
- Dictado por voz con la Web Speech API y lectura en voz alta de las respuestas.
- Gráficos `[CHART_DATA: {...}]` parseados con `JSON.parse` y renderizados
  inline con Chart.js.

## Nota de seguridad

Tu API key queda visible en el código fuente que le llega al navegador (así
funciona cualquier clave usada del lado del cliente). Está bien para uso propio,
pero si vas a publicar esto para que otras personas lo usen, conviene mover la
llamada a Gemini a un backend pequeño que guarde la key en el servidor.

**Importante:** tu archivo `.env` tenía la API key real y **no** estaba en
`.gitignore` — si ya hiciste `git push` antes, esa clave quedó pública en tu
repositorio de GitHub. Ya lo corregí en `.gitignore`, pero si el repo ya es
público, **rota (revoca y genera de nuevo) esa API key en
[Google AI Studio](https://aistudio.google.com/apikey)**, porque cualquiera
pudo haberla copiado del historial de commits.

## Publicar en GitHub Pages (arreglo de estilos)

Los estilos no se veían porque, para GitHub Pages, hace falta lo siguiente:

1. Sube **todo** el contenido de esta carpeta a la raíz del repositorio (no
   dentro de una subcarpeta), incluyendo la carpeta `src/`.
2. Asegúrate de que `src/config.js` exista en el repo — está en `.gitignore` a
   propósito (para no exponer tu clave), así que en GitHub Pages tendrás que
   subir una copia de ese archivo por separado o usar GitHub Secrets +
   Actions si quieres mantenerlo oculto. La forma simple para un proyecto
   personal: sube `src/config.js` igual, sabiendo que quedará visible (ver nota
   de seguridad arriba), o usa una key restringida por dominio en Google Cloud
   Console.
3. Ya agregué un archivo `.nojekyll` en la raíz — sin esto, GitHub Pages a
   veces ignora carpetas como `src/` porque intenta procesar el sitio con
   Jekyll.
4. En GitHub: **Settings → Pages → Source → Deploy from a branch**, elige la
   rama (`main`) y la carpeta `/ (root)`.
5. Verifica: abre la URL publicada, abre las herramientas de desarrollador
   (F12) → pestaña **Network**, recarga, y busca `style.css`. Si aparece en
   rojo (404), el archivo no llegó al repo — revisa el paso 1.

## Funciones nuevas (V15.3)

- **Streaming real:** las respuestas de texto se muestran palabra por palabra
  a medida que el modelo las genera (antes esperaba la respuesta completa).
  Además el modelo por defecto ahora es `gemini-2.5-flash` (el más rápido).
- **Micrófono real:** transcripción en vivo mientras hablas, reconocimiento
  continuo, y mensajes de error claros si el navegador bloquea el permiso
  (antes fallaba en silencio).
- **Hora de cualquier país:** pregunta "qué hora es en Japón" y responde al
  instante con la hora real (no inventada por la IA).
- **Clima con animaciones:** pregunta "clima en Madrid" y aparece una tarjeta
  con datos reales (Open-Meteo, sin API key) y una animación según la
  condición (sol, lluvia, nieve, tormenta, niebla).
- **Generación de imágenes:** pregunta "genera una imagen de..." y se genera
  con el modelo de imágenes de Gemini. Bloquea localmente cualquier intento
  de generar contenido sexual o que involucre menores, además de los filtros
  de seguridad propios de la API (que nunca se desactivan).
- **Edición de documentos de texto:** ahora también puedes subir `.txt`/`.md`,
  y cualquier respuesta larga de la IA tiene un botón para descargarla como
  `.txt`. **No implementé edición de recetas médicas** — ese tipo de
  documento es el que se usa para falsificar prescripciones de medicamentos
  controlados, así que quedó fuera de propósito. El resto de la edición de
  documentos de texto sí funciona normal.
