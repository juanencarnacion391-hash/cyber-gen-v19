// ====================== MAIN.JS - MASTER OMEGA V15.2 (FUNCIONAL) ======================
// Desarrollado por: Ing. Juan Jose Encarnacion
// Nucleo de Inteligencia Cyber-Gen
// Sin dependencias: la API key se lee de src/config.js (window.GEMINI_API_KEY)

// Orden pensado para velocidad: los modelos "flash" van primero porque responden
// varias veces mas rapido que los "pro". Solo se cae a un modelo mas lento si el
// rapido falla (404/429/5xx), ver executeModelFallback.
// Solo modelos "flash": son los que tienen cuota gratuita real. "gemini-pro-latest" se saco
// de la lista porque ese alias hoy apunta a un modelo Pro con cuota 0 en el plan gratuito
// (no es un limite de velocidad, es que ese modelo especifico requiere plan de pago).
const MODELS_LIST = [
  "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"
];

const SYSTEM_PROMPT = `Eres MINI GEMINI AI MASTER V15.2, disenada por el Ing. Juan Jose Encarnacion.

REGLAS DE FORMATO DE TEXTO (CRITICO):
1. ESTRUCTURA: Usa siempre Titulos (##) y Subtitulos (###) para organizar la informacion.
2. RESALTADO: Aplica negritas (**palabra**) a terminos clave, nombres propios y conceptos importantes.
3. DATOS: Aplica SIEMPRE formato de codigo (\`valor\`) a numeros, porcentajes (%), fechas y valores monetarios (ej: \`$1,250.00\`, \`25%\`).
4. TONO: Profesional, tecnico, directo y conciso (evita relleno innecesario, responde directo al punto). Usa emojis de tecnologia de forma moderada.
5. Si el usuario pregunta la hora, horario o clima de un lugar, y el mensaje incluye un bloque "[DATO_VERIFICADO: ...]", usa EXACTAMENTE esos datos (son reales, obtenidos en el momento). Nunca inventes horas ni datos climaticos por tu cuenta.

MISION CRITICA DE GRAFICOS:
1. ANALISIS DE ARCHIVOS: Analiza con precision tecnica cualquier archivo adjunto.
2. VISUALIZACION MULTIPLE: Si el usuario pide VARIOS graficos, crea bloques [CHART_DATA: {...}] TOTALMENTE SEPARADOS.
3. REGLAS DE CHART.JS (ESTRICTO):
   - NUNCA uses puntos suspensivos (...) en los arrays.
   - Usa SIEMPRE numeros reales.
   - NO envuelvas el bloque en markdown.
   - Formato exacto: [CHART_DATA: {"type":"bar","data":{"labels":[...],"datasets":[{"label":"...","data":[...]}]}}]
4. ESTILO: Cyberpunk neon vibrante.

LIMITES INNEGOCIABLES:
- Nunca generas ni describes imagenes sexuales, ni ninguna imagen que involucre a menores de edad en absoluto.
- Nunca ayudas a crear, editar o falsificar recetas medicas ni documentos de prescripcion de medicamentos controlados. Puedes ayudar con documentos de texto en general (informes, contratos, cartas, ensayos, CVs, etc.).`;

// --- CONFIGURACION DE API KEY (src/config.js) ---
const API_KEY = (window.GEMINI_API_KEY || "").trim();

if (!API_KEY || API_KEY.includes("PON_AQUI")) {
  console.error("[CYBER-GEN] No se encontro una API key valida. Edita src/config.js con tu clave real.");
}

// --- ESTADO / PERSISTENCIA ---
const STORAGE_SESSIONS = "cybergen_sessions_v15";
const STORAGE_AUDIO = "cybergen_audio_v15";
const STORAGE_MODEL = "cybergen_model_v15";

let sessions = [];
try { sessions = JSON.parse(localStorage.getItem(STORAGE_SESSIONS)) || []; } catch (e) { sessions = []; }

let currentSessionId = null;
let isAudioEnabled = localStorage.getItem(STORAGE_AUDIO) !== "false";
let preferredModelIndex = Math.max(0, MODELS_LIST.indexOf(localStorage.getItem(STORAGE_MODEL) || MODELS_LIST[0]));
let pendingFiles = []; // { name, mimeType, base64?, textContent? }
let isSending = false;
let recognition = null;
let isListening = false;

// --- REFERENCIAS AL DOM ---
const chatBox        = document.getElementById('chat-box');
const welcomeScreen  = document.getElementById('welcome-screen');
const promptInput    = document.getElementById('prompt-input');
const chatForm       = document.getElementById('chat-form');
const sendBtn        = document.getElementById('send-btn');
const sidebar        = document.getElementById('sidebar');
const toggleSidebar  = document.getElementById('toggle-sidebar');
const closeSidebar   = document.getElementById('close-sidebar');
const modelSelect    = document.getElementById('model-select');
const historyList    = document.getElementById('chat-history-list');
const sttBtn         = document.getElementById('stt-btn');
const fileUpload     = document.getElementById('file-upload');
const filePreviewBar = document.getElementById('file-preview-bar');
const toggleAudioBtn = document.getElementById('toggle-audio-global');
const newChatBtn     = document.getElementById('new-chat-btn');
const clearBtn       = document.getElementById('clear-btn');
const statusDot      = document.getElementById('status-dot');

// ====================== INIT ======================
function initApp() {
  buildModelSelector();
  renderHistorySidebar();
  updateAudioBtnStyle();
  ajustarInput();
  setupSpeechRecognition();

  const last = sessions[0];
  if (last) loadSession(last.id); else startNewChat();

  chatForm.addEventListener('submit', onSubmit);
  promptInput.addEventListener('input', ajustarInput);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatForm.requestSubmit(); }
  });
  toggleSidebar.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  closeSidebar.addEventListener('click', () => sidebar.classList.add('collapsed'));
  newChatBtn.addEventListener('click', startNewChat);
  clearBtn.addEventListener('click', startNewChat);
  toggleAudioBtn.addEventListener('click', () => {
    isAudioEnabled = !isAudioEnabled;
    localStorage.setItem(STORAGE_AUDIO, String(isAudioEnabled));
    updateAudioBtnStyle();
    if (!isAudioEnabled) window.speechSynthesis.cancel();
  });
  fileUpload.addEventListener('change', onFilesSelected);
  modelSelect.addEventListener('change', () => {
    preferredModelIndex = Math.max(0, MODELS_LIST.indexOf(modelSelect.value));
    localStorage.setItem(STORAGE_MODEL, modelSelect.value);
  });
  sttBtn.addEventListener('click', toggleListening);

  checkApiStatus();
}

// Chequeo silencioso al cargar: hace una llamada minima (1 token de salida) para saber si la
// API key y la cuota realmente funcionan, en vez de que el usuario lo descubra a mitad de un chat.
async function checkApiStatus() {
  if (!API_KEY) { setStatus('error', 'Falta la API key en src/config.js'); return; }
  setStatus('checking', 'Verificando conexion...');
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELS_LIST[0]}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'hola' }] }],
          generationConfig: { maxOutputTokens: 1 }
        })
      }
    );
    if (res.ok) { setStatus('ok', 'Conectado — cuota disponible'); return; }
    let errMsg = `HTTP ${res.status}`;
    try { const j = await res.json(); errMsg = j?.error?.message || errMsg; } catch (e) {}
    if (isZeroQuotaError(errMsg)) setStatus('error', 'Tu API key tiene cuota 0 — revisa billing en Google Cloud');
    else setStatus('error', errMsg.slice(0, 120));
  } catch (e) {
    setStatus('error', 'Sin conexion a internet o dominio bloqueado');
  }
}

function setStatus(state, title) {
  if (!statusDot) return;
  statusDot.classList.remove('status-ok', 'status-error', 'status-checking');
  statusDot.classList.add(`status-${state}`);
  statusDot.title = title;
}

function buildModelSelector() {
  modelSelect.innerHTML = MODELS_LIST.map(m => `<option value="${m}">${m}</option>`).join('');
  modelSelect.value = MODELS_LIST[preferredModelIndex] || MODELS_LIST[0];
}

function ajustarInput() {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 150) + 'px';
}

function updateAudioBtnStyle() {
  toggleAudioBtn.innerHTML = isAudioEnabled
    ? `<i class="fas fa-volume-up"></i> Voz: ON`
    : `<i class="fas fa-volume-mute"></i> Voz: OFF`;
}

// ====================== SESIONES / HISTORIAL ======================
function saveSessions() {
  localStorage.setItem(STORAGE_SESSIONS, JSON.stringify(sessions));
}

function getCurrentSession() {
  return sessions.find(s => s.id === currentSessionId);
}

function startNewChat() {
  const session = { id: 'sess-' + Date.now(), title: 'Nueva Conversacion', messages: [], createdAt: Date.now() };
  sessions.unshift(session);
  currentSessionId = session.id;
  saveSessions();
  renderHistorySidebar();
  clearChatBox();
  window.speechSynthesis.cancel();
}

function loadSession(id) {
  const session = sessions.find(s => s.id === id);
  if (!session) return startNewChat();
  currentSessionId = id;
  clearChatBox();
  session.messages.forEach(m => {
    if (m.role === 'user') appendUserMessage(m.text, m.files || []);
    else appendAiMessage(m.text, false);
  });
  renderHistorySidebar();
  sidebar.classList.add('collapsed');
}

function deleteSession(id, evt) {
  evt.stopPropagation();
  sessions = sessions.filter(s => s.id !== id);
  saveSessions();
  if (id === currentSessionId) {
    if (sessions[0]) loadSession(sessions[0].id); else startNewChat();
  } else {
    renderHistorySidebar();
  }
}

function renderHistorySidebar() {
  if (!sessions.length) {
    historyList.innerHTML = `<p style="color:var(--text-dim);font-size:0.8rem;padding:8px 15px;">Sin conversaciones aun.</p>`;
    return;
  }
  historyList.innerHTML = sessions.map(s => `
    <button class="nav-item history-item ${s.id === currentSessionId ? 'active' : ''}" data-id="${s.id}">
      <span><i class="fas fa-message"></i> ${escapeHtml(s.title || 'Conversacion')}</span>
      <span class="del-history" data-del="${s.id}" title="Eliminar"><i class="fas fa-trash"></i></span>
    </button>
  `).join('');

  historyList.querySelectorAll('.history-item').forEach(btn => {
    btn.addEventListener('click', () => loadSession(btn.dataset.id));
  });
  historyList.querySelectorAll('.del-history').forEach(btn => {
    btn.addEventListener('click', (e) => deleteSession(btn.dataset.del, e));
  });
}

function clearChatBox() {
  chatBox.innerHTML = '';
  const clone = welcomeScreen.cloneNode(true);
  chatBox.appendChild(clone);
}

function ensureWelcomeHidden() {
  const w = document.getElementById('welcome-screen');
  if (w) w.remove();
}

// ====================== ENVIO DE MENSAJES ======================
async function onSubmit(e) {
  e.preventDefault();
  if (isSending) return;

  const text = promptInput.value.trim();
  if (!text && pendingFiles.length === 0) return;
  if (!API_KEY) {
    appendAiMessage("Falta el archivo `src/config.js` con tu API key (o esta vacio/sin subir a GitHub). Crealo a partir de `src/config.example.js`, pon tu clave real, y sube ese archivo a tu repositorio.", true, true);
    return;
  }

  const filesForMsg = pendingFiles.map(f => ({ name: f.name, mimeType: f.mimeType }));
  appendUserMessage(text, filesForMsg);

  const session = getCurrentSession();
  session.messages.push({ role: 'user', text, files: filesForMsg });
  if (session.title === 'Nueva Conversacion' && text) {
    session.title = text.slice(0, 40) + (text.length > 40 ? '…' : '');
  }
  saveSessions();
  renderHistorySidebar();

  const userParts = buildUserParts(text, pendingFiles);
  pendingFiles = [];
  renderFilePreview();

  promptInput.value = '';
  ajustarInput();
  isSending = true;
  sendBtn.disabled = true;

  try {
    // --- Atajos rapidos: hora mundial, clima animado, generacion de imagenes ---
    // Estos NO pasan por el modelo de texto: son mas rapidos y usan datos reales verificables.
    const handled = await tryFeatureIntercepts(text, session);
    if (handled) return;

    // --- Chat normal con Gemini, en streaming (la respuesta se va mostrando palabra por palabra) ---
    const loadingEl = appendLoadingBubble();
    let responseText = '';
    let bubbleEl = null;

    await executeModelFallbackStream(userParts, preferredModelIndex, (chunkText, fullTextSoFar) => {
      responseText = fullTextSoFar;
      if (loadingEl.isConnected) loadingEl.remove();
      bubbleEl = renderStreamingChunk(bubbleEl, responseText);
    }, 0, (waitSec) => {
      loadingEl.innerHTML = `<i class="fas fa-clock"></i> Limite de solicitudes alcanzado, reintentando en ${waitSec}s...`;
    });

    if (loadingEl.isConnected) loadingEl.remove();
    if (!bubbleEl) appendAiMessage(responseText || '(sin respuesta)', true);
    else finalizeStreamedMessage(bubbleEl, responseText);

    session.messages.push({ role: 'model', text: responseText });
    saveSessions();
    if (isAudioEnabled) speak(responseText);
  } catch (err) {
    console.error(err);
    appendAiMessage(buildFriendlyErrorMessage(err), true, true);
  } finally {
    isSending = false;
    sendBtn.disabled = false;
  }
}

// ====================== ATAJOS: HORA / CLIMA / IMAGENES ======================
async function tryFeatureIntercepts(text, session) {
  const F = window.CyberFeatures;
  if (!F) return false;

  // 1) Hora mundial — instantaneo, sin llamar a ningun modelo
  const timeQ = F.detectTimeQuery(text);
  if (timeQ) {
    const loadingEl = appendLoadingBubble();
    const answer = F.renderTimeAnswer(timeQ);
    loadingEl.remove();
    appendAiMessage(answer, true);
    session.messages.push({ role: 'model', text: answer });
    saveSessions();
    if (isAudioEnabled) speak(answer);
    return true;
  }

  // 2) Clima con tarjeta animada — datos reales de Open-Meteo
  const place = F.detectWeatherQuery(text);
  if (place) {
    const loadingEl = appendLoadingBubble();
    try {
      const w = await F.fetchWeatherData(place);
      const cardHtml = F.buildWeatherCardHtml(w);
      const summary = `## 🌦️ Clima en ${w.place}\n\n**Condicion:** ${w.condition} — \`${w.tempC}°C\` (sensacion \`${w.feelsLikeC}°C\`)\n**Humedad:** \`${w.humidity}%\` · **Viento:** \`${w.windKmh} km/h\``;
      loadingEl.remove();
      appendAiMessage(summary, true, false, cardHtml);
      session.messages.push({ role: 'model', text: summary });
      saveSessions();
      if (isAudioEnabled) speak(summary);
    } catch (err) {
      loadingEl.remove();
      appendAiMessage(`⚠️ No pude obtener el clima de **${escapeHtml(place)}**.\n\n\`${escapeHtml(err.message)}\``, true, true);
    }
    return true;
  }

  // 3) Generacion de imagenes por prompt
  const imgPrompt = F.detectImageGenQuery(text);
  if (imgPrompt) {
    if (F.isImagePromptBlocked(imgPrompt)) {
      appendAiMessage('No puedo generar esa imagen. No genero contenido sexual ni contenido que involucre a menores de edad, sin excepciones.', true, true);
      return true;
    }
    const loadingEl = appendLoadingBubble();
    try {
      const img = await F.generateImage(imgPrompt, API_KEY);
      loadingEl.remove();
      appendAiImageMessage(imgPrompt, img.base64, img.mimeType);
      session.messages.push({ role: 'model', text: `[Imagen generada: ${imgPrompt}]` });
      saveSessions();
    } catch (err) {
      loadingEl.remove();
      appendAiMessage(`⚠️ No pude generar la imagen.\n\n\`${escapeHtml(err.message)}\`\n\nSi el error persiste, verifica en Google AI Studio que tu cuenta tenga acceso al modelo de imagenes.`, true, true);
    }
    return true;
  }

  return false;
}

function buildUserParts(text, files) {
  const parts = [];
  if (text) parts.push({ text });
  files.forEach(f => {
    if (f.textContent) {
      parts.push({ text: `Contenido del archivo adjunto "${f.name}":\n\n${f.textContent}` });
    } else if (f.base64) {
      parts.push({ inlineData: { mimeType: f.mimeType, data: f.base64 } });
    }
  });
  if (!text && files.length) parts.push({ text: 'Analiza el archivo adjunto con precision tecnica.' });
  return parts;
}

function buildFriendlyErrorMessage(err) {
  const msg = err.message || String(err);
  const m = escapeHtml(msg);

  if (/limit:\s*0/i.test(msg)) {
    return `⚠️ **Tu API key tiene cuota 0, sin importar el modelo.**\n\nEsto ya no es un problema de que modelo esta en la lista — le paso hasta a \`gemini-2.0-flash\`, que normalmente si tiene cuota gratuita. Cuando **todos** los modelos dan \`limit: 0\`, el problema esta en el proyecto de Google Cloud asociado a tu API key, no en la app. Revisa esto en este orden:\n\n1. Entra a **[Google AI Studio](https://aistudio.google.com/apikey)** y mira a que proyecto de Google Cloud esta asociada tu key.\n2. En **[Google Cloud Console → Billing](https://console.cloud.google.com/billing)**, verifica si ese proyecto tiene facturacion habilitada. Google ha ido restringiendo el nivel gratuito por region/tipo de cuenta; algunas cuentas (sobre todo Google Workspace o cuentas creadas recientemente) ya no reciben cuota gratuita hasta que se habilita facturacion.\n3. Revisa tu uso y limites reales en **[ai.dev/rate-limit](https://ai.dev/rate-limit)**.\n4. Si nada de eso aplica, prueba generar una API key nueva desde una cuenta personal de Gmail (no Workspace) en aistudio.google.com/apikey — a veces el proyecto por defecto que crea Google si tiene cuota y el anterior no.\n\nDetalle tecnico: \`${m}\``;
  }
  if (/quota exceeded|rate.?limit|429/i.test(msg)) {
    return `⚠️ **Se alcanzo el limite de solicitudes gratuitas por minuto.**\n\nEspera unos segundos e intenta de nuevo. Si pasa seguido, revisa tu uso en https://ai.dev/rate-limit.\n\nDetalle: \`${m}\``;
  }
  return `⚠️ **Error de conexion con el nucleo Gemini.**\n\nDetalle: \`${m}\`\n\nVerifica que \`src/config.js\` exista en tu repositorio de GitHub y tenga tu API key real de Google AI Studio (https://aistudio.google.com/apikey), y que tengas conexion a internet.`;
}

function buildRequestBody(userParts) {
  const session = getCurrentSession();
  const sessionCtx = (session ? session.messages.slice(0, -1) : [])
    .slice(-10)
    .map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text || '' }] }));

  return {
    contents: [...sessionCtx, { role: 'user', parts: userParts }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
  };
}

// Extrae el numero de segundos de un mensaje tipo "Please retry in 37.09s" (Google lo manda en
// los errores 429 temporales). Devuelve null si no lo encuentra.
function parseRetryDelaySeconds(msg) {
  const m = String(msg || '').match(/retry in (\d+(?:\.\d+)?)s/i);
  return m ? Math.min(Math.ceil(parseFloat(m[1])), 60) : null;
}

function isZeroQuotaError(msg) {
  return /limit:\s*0/i.test(String(msg || ''));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Version sin streaming (se mantiene como respaldo por si el navegador no soporta streams legibles)
async function executeModelFallback(userParts, startIndex = 0, attempt = 0) {
  const model = MODELS_LIST[startIndex] || MODELS_LIST[0];
  const body = buildRequestBody(userParts);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': API_KEY },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try { const errJson = await res.json(); errMsg = errJson?.error?.message || errMsg; } catch (e) {}

    // Cuota 0: es un problema de cuenta, no de este modelo en particular — probar los demas
    // modelos tambien fallara, asi que no perdemos tiempo intentandolo.
    if (isZeroQuotaError(errMsg)) throw new Error(errMsg);

    if (res.status === 429) {
      const waitSec = parseRetryDelaySeconds(errMsg);
      if (waitSec) {
        await sleep(waitSec * 1000);
        return executeModelFallback(userParts, startIndex, attempt); // mismo modelo, un reintento
      }
    }

    if ((res.status === 404 || res.status === 429 || res.status >= 500) && attempt < MODELS_LIST.length - 1) {
      return executeModelFallback(userParts, startIndex + 1, attempt + 1);
    }
    throw new Error(errMsg);
  }

  return await res.json();
}

// Version en streaming: usa el endpoint SSE de Gemini para ir mostrando la respuesta a medida
// que se genera, en vez de esperar el mensaje completo. Esto es lo que hace que la IA "se sienta"
// mucho mas rapida, aunque el tiempo total de generacion sea similar.
async function executeModelFallbackStream(userParts, startIndex, onChunk, attempt = 0, onRetryWait = null) {
  const model = MODELS_LIST[startIndex] || MODELS_LIST[0];
  const body = buildRequestBody(userParts);

  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': API_KEY },
        body: JSON.stringify(body)
      }
    );
  } catch (networkErr) {
    if (attempt < MODELS_LIST.length - 1) {
      return executeModelFallbackStream(userParts, startIndex + 1, onChunk, attempt + 1, onRetryWait);
    }
    throw networkErr;
  }

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try { const errJson = await res.json(); errMsg = errJson?.error?.message || errMsg; } catch (e) {}

    if (isZeroQuotaError(errMsg)) throw new Error(errMsg);

    if (res.status === 429) {
      const waitSec = parseRetryDelaySeconds(errMsg);
      if (waitSec) {
        if (onRetryWait) onRetryWait(waitSec);
        await sleep(waitSec * 1000);
        return executeModelFallbackStream(userParts, startIndex, onChunk, attempt, onRetryWait);
      }
    }

    if ((res.status === 404 || res.status === 429 || res.status >= 500) && attempt < MODELS_LIST.length - 1) {
      return executeModelFallbackStream(userParts, startIndex + 1, onChunk, attempt + 1, onRetryWait);
    }
    throw new Error(errMsg);
  }

  if (!res.body || !res.body.getReader) {
    // Navegador sin soporte de streams legibles: cae al modo no-streaming
    const data = await res.json();
    const full = extractText(data);
    onChunk(full, full);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop(); // guarda la ultima linea incompleta para el siguiente chunk

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const piece = extractText(parsed);
        if (piece) {
          fullText += piece;
          onChunk(piece, fullText);
        }
      } catch (e) { /* fragmento incompleto, se ignora */ }
    }
  }

  if (!fullText) throw new Error('Respuesta vacia del modelo.');
}

function renderStreamingChunk(bubbleEl, fullTextSoFar) {
  ensureWelcomeHidden();
  if (!bubbleEl) {
    bubbleEl = document.createElement('div');
    bubbleEl.className = 'message ai-message streaming';
    chatBox.appendChild(bubbleEl);
  }
  // Durante el streaming se muestra texto plano (rapido); el markdown final se aplica al terminar.
  bubbleEl.textContent = fullTextSoFar;
  scrollToBottom();
  return bubbleEl;
}

function finalizeStreamedMessage(bubbleEl, fullText) {
  bubbleEl.classList.remove('streaming');
  const { html, charts } = procesarEstructuraVisual(fullText || '');
  let finalHtml = html;
  charts.forEach((c, i) => {
    finalHtml = finalHtml.replace(`%%%CHART_${i}%%%`, `<div class="chart-wrap"><canvas id="${c.id}"></canvas></div>`);
  });
  bubbleEl.innerHTML = finalHtml;
  charts.forEach(c => {
    const canvas = bubbleEl.querySelector(`#${c.id}`);
    if (canvas) {
      try { new Chart(canvas.getContext('2d'), normalizeChartConfig(c.config)); }
      catch (e) { canvas.replaceWith(document.createTextNode('[Error al renderizar grafico]')); }
    }
  });
  if (window.Prism) bubbleEl.querySelectorAll('pre code').forEach(block => Prism.highlightElement(block));
  if (fullText && fullText.length > 40) bubbleEl.appendChild(makeDownloadTextButton(fullText));
  scrollToBottom();
}

// Botoncito para descargar cualquier respuesta de texto (documento editado, informe, etc.) como .txt
function makeDownloadTextButton(text) {
  const a = document.createElement('a');
  a.className = 'download-text-btn';
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = 'cyber-gen-documento.txt';
  a.innerHTML = '<i class="fas fa-download"></i> Descargar como .txt';
  return a;
}

function extractText(data) {
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    const blockReason = data?.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`Respuesta bloqueada por seguridad: ${blockReason}`);
    return ''; // fragmento de streaming sin texto (ej. solo metadata) — no es un error
  }
  return (candidate.content?.parts || []).map(p => p.text || '').join('');
}

// ====================== RENDERIZADO DE MENSAJES ======================
function appendUserMessage(text, files) {
  ensureWelcomeHidden();
  const div = document.createElement('div');
  div.className = 'message user-message';
  let filesHtml = '';
  if (files && files.length) {
    filesHtml = '<div>' + files.map(f => `<span class="file-chip"><i class="fas fa-paperclip"></i> ${escapeHtml(f.name)}</span>`).join('') + '</div>';
  }
  div.innerHTML = `${escapeHtml(text)}${filesHtml}`;
  chatBox.appendChild(div);
  scrollToBottom();
}

function appendLoadingBubble() {
  ensureWelcomeHidden();
  const div = document.createElement('div');
  div.className = 'message ai-message loading';
  div.innerHTML = `<i class="fas fa-microchip"></i> Procesando <span class="dots"><span>.</span><span>.</span><span>.</span></span>`;
  chatBox.appendChild(div);
  scrollToBottom();
  return div;
}

function appendAiMessage(rawText, doHighlight = true, isError = false, extraHtml = '') {
  ensureWelcomeHidden();
  const { html, charts } = procesarEstructuraVisual(rawText || '');
  const div = document.createElement('div');
  div.className = 'message ai-message' + (isError ? ' error-message' : '');

  let finalHtml = html;
  charts.forEach((c, i) => {
    finalHtml = finalHtml.replace(`%%%CHART_${i}%%%`, `<div class="chart-wrap"><canvas id="${c.id}"></canvas></div>`);
  });
  if (extraHtml) finalHtml = extraHtml + finalHtml;
  div.innerHTML = finalHtml;
  if (!isError && rawText && rawText.length > 40) div.appendChild(makeDownloadTextButton(rawText));
  chatBox.appendChild(div);

  charts.forEach(c => {
    const canvas = div.querySelector(`#${c.id}`);
    if (canvas) {
      try { new Chart(canvas.getContext('2d'), normalizeChartConfig(c.config)); }
      catch (e) { canvas.replaceWith(document.createTextNode('[Error al renderizar grafico]')); }
    }
  });

  if (doHighlight && window.Prism) {
    div.querySelectorAll('pre code').forEach(block => Prism.highlightElement(block));
  }
  scrollToBottom();
}

function appendAiImageMessage(prompt, base64, mimeType) {
  ensureWelcomeHidden();
  const div = document.createElement('div');
  div.className = 'message ai-message ai-image-message';
  div.innerHTML = `
    <p><i class="fas fa-wand-magic-sparkles"></i> Imagen generada: <em>${escapeHtml(prompt)}</em></p>
    <img class="generated-image" src="data:${mimeType};base64,${base64}" alt="${escapeHtml(prompt)}">
    <a class="download-image-btn" download="cyber-gen-imagen.png" href="data:${mimeType};base64,${base64}">
      <i class="fas fa-download"></i> Descargar
    </a>
  `;
  chatBox.appendChild(div);
  scrollToBottom();
}

function normalizeChartConfig(config) {
  return {
    type: config.type || 'bar',
    data: config.data || {},
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#e0e0e0' } } },
      scales: config.type === 'pie' || config.type === 'doughnut' ? {} : {
        x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      },
      ...(config.options || {})
    }
  };
}

function scrollToBottom() {
  chatBox.scrollTop = chatBox.scrollHeight;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ====================== VISUALIZACION DE DATOS (CHART.JS) ======================
function procesarEstructuraVisual(text) {
  let processedText = text;
  const extractedConfigs = [];
  processedText = processedText.replace(/```(?:json|javascript|html)?\s*(\[CHART_DATA:[\s\S]*?\])\s*```/gi, '$1');
  const TAG = '[CHART_DATA:';

  while (processedText.includes(TAG)) {
    const tagIndex = processedText.indexOf(TAG);
    const jsonStart = processedText.indexOf('{', tagIndex);
    if (jsonStart === -1) { processedText = processedText.replace(TAG, '[CHART_DATA_INVALIDO]'); continue; }

    let depth = 0, jsonEnd = -1, found = false;
    for (let i = jsonStart; i < processedText.length; i++) {
      if (processedText[i] === '{') { depth++; found = true; }
      else if (processedText[i] === '}') { depth--; if (found && depth === 0) { jsonEnd = i; break; } }
    }

    if (jsonEnd !== -1) {
      const closingBracket = processedText.indexOf(']', jsonEnd);
      const fullMatch = processedText.substring(tagIndex, closingBracket + 1);
      const jsonStr = processedText.substring(jsonStart, jsonEnd + 1).trim();
      try {
        const config = JSON.parse(jsonStr);
        const cid = `chart-${Date.now()}-${extractedConfigs.length}`;
        extractedConfigs.push({ id: cid, config });
        processedText = processedText.replace(fullMatch, `\n\n%%%CHART_${extractedConfigs.length - 1}%%%\n\n`);
      } catch (e) {
        processedText = processedText.replace(fullMatch, ' [Error en Grafico] ');
      }
    } else {
      break;
    }
  }
  return { html: marked.parse(processedText), charts: extractedConfigs };
}

// ====================== SISTEMA DE VOZ (TTS) ======================
function speak(text) {
  if (!isAudioEnabled || !text) return;
  window.speechSynthesis.cancel();

  const clean = text
    .replace(/\[CHART_DATA[\s\S]*?\]/gs, ' Grafico generado en pantalla. ')
    .replace(/```[\s\S]*?```/gs, ' Bloque de codigo omitido. ')
    .replace(/<[^>]*>?/gm, '')
    .replace(/[#*`_~→←↑↓↔︎]/g, ' ')
    .replace(/([.?!:;])\s*/g, '$1|')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return;

  const chunks = clean.split('|').filter(c => c.trim().length > 0);
  let chunkIndex = 0;

  function playNextChunk() {
    if (chunkIndex >= chunks.length) return;
    const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex].trim());
    utterance.lang = 'es-ES';
    utterance.rate = 1.05;
    utterance.onend = () => { chunkIndex++; playNextChunk(); };
    window.speechSynthesis.speak(utterance);
  }
  setTimeout(playNextChunk, 80);
}

// ====================== DICTADO POR VOZ (STT) ======================
let baseTextBeforeListening = '';

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    sttBtn.disabled = true;
    sttBtn.title = 'Dictado no soportado en este navegador (usa Chrome o Edge)';
    return;
  }
  if (!window.isSecureContext) {
    sttBtn.disabled = true;
    sttBtn.title = 'El microfono requiere HTTPS (o localhost)';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.continuous = true;      // sigue escuchando hasta que el usuario detenga
  recognition.interimResults = true;  // muestra texto parcial mientras hablas, se siente "real"
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let finalTranscript = '';
    let interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalTranscript += chunk;
      else interimTranscript += chunk;
    }
    const base = baseTextBeforeListening ? baseTextBeforeListening + ' ' : '';
    promptInput.value = (base + finalTranscript + interimTranscript).trim();
    if (finalTranscript) baseTextBeforeListening = promptInput.value;
    ajustarInput();
  };

  recognition.onerror = (event) => {
    const messages = {
      'not-allowed': 'Permiso de microfono denegado. Habilitalo en los ajustes del navegador (icono de candado junto a la URL).',
      'service-not-allowed': 'El navegador bloqueo el acceso al microfono.',
      'no-speech': null, // no es un error real, simplemente no detecto voz aun
      'audio-capture': 'No se detecto ningun microfono conectado.',
      'network': 'Error de red durante el reconocimiento de voz.',
    };
    const msg = messages[event.error];
    if (msg) appendAiMessage(`🎙️ ${msg}`, false, true);
    if (event.error !== 'no-speech') stopListening();
  };

  recognition.onend = () => {
    // 'continuous' a veces termina solo tras una pausa larga; si el usuario no lo detuvo, reinicia.
    if (isListening) {
      try { recognition.start(); } catch (e) { stopListening(); }
    }
  };
}

function toggleListening() {
  if (!recognition) return;
  if (isListening) stopListening(); else startListening();
}
function startListening() {
  baseTextBeforeListening = promptInput.value;
  try {
    recognition.start();
    isListening = true;
    sttBtn.classList.add('listening');
    sttBtn.title = 'Escuchando... (clic para detener)';
  } catch (e) { /* ya estaba iniciado */ }
}
function stopListening() {
  isListening = false; // primero, para que onend no lo reinicie
  try { recognition.stop(); } catch (e) {}
  sttBtn.classList.remove('listening');
  sttBtn.title = 'Dictado por Voz';
}

// ====================== ARCHIVOS (XLSX / CSV / PDF) ======================
async function onFilesSelected(e) {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    try {
      if (/\.(xlsx|xls|csv)$/i.test(file.name)) {
        const text = await parseSpreadsheetToCsv(file);
        pendingFiles.push({ name: file.name, mimeType: 'text/csv', textContent: text.slice(0, 15000) });
      } else if (/\.pdf$/i.test(file.name)) {
        const base64 = await fileToBase64(file);
        pendingFiles.push({ name: file.name, mimeType: 'application/pdf', base64 });
      } else if (/\.(txt|md)$/i.test(file.name)) {
        const text = await file.text();
        pendingFiles.push({ name: file.name, mimeType: 'text/plain', textContent: text.slice(0, 15000) });
      }
    } catch (err) {
      console.error('Error leyendo archivo', file.name, err);
    }
  }
  fileUpload.value = '';
  renderFilePreview();
}

function parseSpreadsheetToCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_csv(firstSheet));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderFilePreview() {
  if (!pendingFiles.length) { filePreviewBar.classList.add('d-none'); filePreviewBar.innerHTML = ''; return; }
  filePreviewBar.classList.remove('d-none');
  filePreviewBar.innerHTML = pendingFiles.map((f, i) => `
    <span class="file-chip">
      <i class="fas fa-file"></i> ${escapeHtml(f.name)}
      <i class="fas fa-times" style="cursor:pointer;margin-left:4px;" data-remove="${i}"></i>
    </span>
  `).join('');
  filePreviewBar.querySelectorAll('[data-remove]').forEach(el => {
    el.addEventListener('click', () => {
      pendingFiles.splice(Number(el.dataset.remove), 1);
      renderFilePreview();
    });
  });
}

initApp();
