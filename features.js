// ====================== FEATURES.JS — Hora mundial, clima animado, generacion de imagenes ======================
// Se apoya en APIs publicas sin necesidad de API key (Open-Meteo) para datos reales y verificables,
// y en el modelo de imagenes de Gemini (misma API key que el chat) para generar imagenes.

// ---------- utilidades ----------
function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// ---------- 1) HORA MUNDIAL (instantaneo, sin llamar a la IA: es un dato exacto, no algo que "generar") ----------
// Mapa pais/ciudad -> zona horaria IANA. Cubre los paises hispanohablantes y las principales
// zonas horarias del mundo. Si el lugar no esta aqui, se intenta con Intl como respaldo.
const TZ_MAP = {
  "republica dominicana": "America/Santo_Domingo", "rd": "America/Santo_Domingo", "santo domingo": "America/Santo_Domingo",
  "mexico": "America/Mexico_City", "cdmx": "America/Mexico_City", "ciudad de mexico": "America/Mexico_City",
  "espana": "Europe/Madrid", "madrid": "Europe/Madrid",
  "argentina": "America/Argentina/Buenos_Aires", "buenos aires": "America/Argentina/Buenos_Aires",
  "colombia": "America/Bogota", "bogota": "America/Bogota",
  "venezuela": "America/Caracas", "caracas": "America/Caracas",
  "peru": "America/Lima", "lima": "America/Lima",
  "chile": "America/Santiago", "santiago": "America/Santiago",
  "ecuador": "America/Guayaquil", "quito": "America/Guayaquil",
  "bolivia": "America/La_Paz", "la paz": "America/La_Paz",
  "paraguay": "America/Asuncion", "asuncion": "America/Asuncion",
  "uruguay": "America/Montevideo", "montevideo": "America/Montevideo",
  "cuba": "America/Havana", "la habana": "America/Havana", "havana": "America/Havana",
  "puerto rico": "America/Puerto_Rico", "san juan": "America/Puerto_Rico",
  "panama": "America/Panama",
  "costa rica": "America/Costa_Rica",
  "nicaragua": "America/Managua", "managua": "America/Managua",
  "honduras": "America/Tegucigalpa", "tegucigalpa": "America/Tegucigalpa",
  "el salvador": "America/El_Salvador", "san salvador": "America/El_Salvador",
  "guatemala": "America/Guatemala",
  "haiti": "America/Port-au-Prince",
  "estados unidos": "America/New_York", "eeuu": "America/New_York", "usa": "America/New_York",
  "nueva york": "America/New_York", "new york": "America/New_York",
  "los angeles": "America/Los_Angeles", "california": "America/Los_Angeles",
  "miami": "America/New_York", "chicago": "America/Chicago", "texas": "America/Chicago",
  "canada": "America/Toronto", "toronto": "America/Toronto", "vancouver": "America/Vancouver",
  "brasil": "America/Sao_Paulo", "brazil": "America/Sao_Paulo", "sao paulo": "America/Sao_Paulo", "rio de janeiro": "America/Sao_Paulo",
  "reino unido": "Europe/London", "inglaterra": "Europe/London", "londres": "Europe/London", "london": "Europe/London", "uk": "Europe/London",
  "francia": "Europe/Paris", "paris": "Europe/Paris",
  "alemania": "Europe/Berlin", "berlin": "Europe/Berlin",
  "italia": "Europe/Rome", "roma": "Europe/Rome", "italy": "Europe/Rome",
  "portugal": "Europe/Lisbon", "lisboa": "Europe/Lisbon",
  "paises bajos": "Europe/Amsterdam", "holanda": "Europe/Amsterdam", "amsterdam": "Europe/Amsterdam",
  "belgica": "Europe/Brussels", "bruselas": "Europe/Brussels",
  "suiza": "Europe/Zurich", "zurich": "Europe/Zurich",
  "austria": "Europe/Vienna", "viena": "Europe/Vienna",
  "grecia": "Europe/Athens", "atenas": "Europe/Athens",
  "rusia": "Europe/Moscow", "moscu": "Europe/Moscow", "moscow": "Europe/Moscow",
  "turquia": "Europe/Istanbul", "estambul": "Europe/Istanbul",
  "suecia": "Europe/Stockholm", "noruega": "Europe/Oslo", "dinamarca": "Europe/Copenhagen", "finlandia": "Europe/Helsinki",
  "polonia": "Europe/Warsaw", "irlanda": "Europe/Dublin", "dublin": "Europe/Dublin",
  "china": "Asia/Shanghai", "beijing": "Asia/Shanghai", "shanghai": "Asia/Shanghai",
  "japon": "Asia/Tokyo", "tokio": "Asia/Tokyo", "tokyo": "Asia/Tokyo", "japan": "Asia/Tokyo",
  "corea del sur": "Asia/Seoul", "seul": "Asia/Seoul", "corea": "Asia/Seoul",
  "india": "Asia/Kolkata", "nueva delhi": "Asia/Kolkata", "mumbai": "Asia/Kolkata",
  "emiratos arabes unidos": "Asia/Dubai", "dubai": "Asia/Dubai", "emiratos": "Asia/Dubai",
  "arabia saudita": "Asia/Riyadh", "riad": "Asia/Riyadh",
  "israel": "Asia/Jerusalem", "jerusalen": "Asia/Jerusalem", "tel aviv": "Asia/Jerusalem",
  "singapur": "Asia/Singapore", "singapore": "Asia/Singapore",
  "tailandia": "Asia/Bangkok", "bangkok": "Asia/Bangkok",
  "vietnam": "Asia/Ho_Chi_Minh", "filipinas": "Asia/Manila", "manila": "Asia/Manila",
  "indonesia": "Asia/Jakarta", "jakarta": "Asia/Jakarta",
  "malasia": "Asia/Kuala_Lumpur",
  "pakistan": "Asia/Karachi",
  "egipto": "Africa/Cairo", "el cairo": "Africa/Cairo", "cairo": "Africa/Cairo",
  "sudafrica": "Africa/Johannesburg", "johannesburgo": "Africa/Johannesburg",
  "nigeria": "Africa/Lagos", "lagos": "Africa/Lagos",
  "marruecos": "Africa/Casablanca",
  "kenia": "Africa/Nairobi", "nairobi": "Africa/Nairobi",
  "australia": "Australia/Sydney", "sidney": "Australia/Sydney", "sydney": "Australia/Sydney", "melbourne": "Australia/Melbourne",
  "nueva zelanda": "Pacific/Auckland", "auckland": "Pacific/Auckland",
};

function findTimezone(rawPlace) {
  const key = normalizeText(rawPlace).replace(/^(el |la |los |las )/, '');
  if (TZ_MAP[key]) return { tz: TZ_MAP[key], label: rawPlace.trim() };
  // intenta encontrar por coincidencia parcial (ej: "estado de mexico" -> "mexico")
  const found = Object.keys(TZ_MAP).find(k => key.includes(k) || k.includes(key));
  if (found) return { tz: TZ_MAP[found], label: rawPlace.trim() };
  return null;
}

const TIME_PATTERNS = [
  /qu[ée] hora es en (.+)/i,
  /hora (?:actual |exacta |)(?:que es |que hay |)en (.+)/i,
  /horario de (.+)/i,
  /dime la hora en (.+)/i,
];

function detectTimeQuery(text) {
  const t = text.trim().replace(/[?¿!¡.]+$/, '');
  for (const re of TIME_PATTERNS) {
    const m = t.match(re);
    if (m && m[1]) {
      const place = m[1].trim();
      const found = findTimezone(place);
      if (found) return found;
    }
  }
  return null;
}

function renderTimeAnswer({ tz, label }) {
  const now = new Date();
  const timeStr = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: tz }).format(now);
  const dateStr = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(now);
  return `## 🕒 Hora en ${label}\n\n**Hora actual:** \`${timeStr}\`\n**Fecha:** ${dateStr}\n**Zona horaria:** \`${tz}\`\n`;
}

// ---------- 2) CLIMA CON ANIMACIONES (Open-Meteo, gratis, sin API key) ----------
const WEATHER_PATTERNS = [
  /clima (?:actual |que hace |que hay |de |en )+(.+)/i,
  /tiempo (?:que hace |actual |de |en )+(.+)/i,
  /temperatura (?:actual |de |en )+(.+)/i,
  /(?:va a |como esta el clima )?(?:llover|nevar) en (.+)/i,
];

function detectWeatherQuery(text) {
  const t = text.trim().replace(/[?¿!¡.]+$/, '');
  for (const re of WEATHER_PATTERNS) {
    const m = t.match(re);
    if (m && m[1] && m[1].trim().length > 1) return m[1].trim();
  }
  return null;
}

// Codigos WMO -> categoria visual + texto
function weatherCodeInfo(code) {
  const map = {
    0: { label: 'Despejado', anim: 'wx-sun', icon: 'fa-sun' },
    1: { label: 'Mayormente despejado', anim: 'wx-sun', icon: 'fa-sun' },
    2: { label: 'Parcialmente nublado', anim: 'wx-cloud', icon: 'fa-cloud-sun' },
    3: { label: 'Nublado', anim: 'wx-cloud', icon: 'fa-cloud' },
    45: { label: 'Niebla', anim: 'wx-fog', icon: 'fa-smog' },
    48: { label: 'Niebla escarchada', anim: 'wx-fog', icon: 'fa-smog' },
    51: { label: 'Llovizna ligera', anim: 'wx-rain', icon: 'fa-cloud-rain' },
    53: { label: 'Llovizna', anim: 'wx-rain', icon: 'fa-cloud-rain' },
    55: { label: 'Llovizna intensa', anim: 'wx-rain', icon: 'fa-cloud-rain' },
    61: { label: 'Lluvia ligera', anim: 'wx-rain', icon: 'fa-cloud-showers-heavy' },
    63: { label: 'Lluvia', anim: 'wx-rain', icon: 'fa-cloud-showers-heavy' },
    65: { label: 'Lluvia intensa', anim: 'wx-rain', icon: 'fa-cloud-showers-heavy' },
    71: { label: 'Nieve ligera', anim: 'wx-snow', icon: 'fa-snowflake' },
    73: { label: 'Nieve', anim: 'wx-snow', icon: 'fa-snowflake' },
    75: { label: 'Nieve intensa', anim: 'wx-snow', icon: 'fa-snowflake' },
    80: { label: 'Chubascos', anim: 'wx-rain', icon: 'fa-cloud-showers-heavy' },
    81: { label: 'Chubascos fuertes', anim: 'wx-rain', icon: 'fa-cloud-showers-heavy' },
    82: { label: 'Chubascos violentos', anim: 'wx-storm', icon: 'fa-bolt' },
    95: { label: 'Tormenta electrica', anim: 'wx-storm', icon: 'fa-bolt' },
    96: { label: 'Tormenta con granizo', anim: 'wx-storm', icon: 'fa-cloud-bolt' },
    99: { label: 'Tormenta severa con granizo', anim: 'wx-storm', icon: 'fa-cloud-bolt' },
  };
  return map[code] || { label: 'Condicion desconocida', anim: 'wx-cloud', icon: 'fa-cloud' };
}

async function fetchWeatherData(place) {
  const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=es&format=json`);
  const geoData = await geoRes.json();
  const loc = geoData?.results?.[0];
  if (!loc) throw new Error(`No encontre la ubicacion "${place}".`);

  const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=auto`);
  const wData = await wRes.json();
  const c = wData?.current;
  if (!c) throw new Error('El servicio de clima no devolvio datos.');

  const info = weatherCodeInfo(c.weather_code);
  return {
    place: [loc.name, loc.admin1, loc.country].filter(Boolean).join(', '),
    tempC: Math.round(c.temperature_2m),
    feelsLikeC: Math.round(c.apparent_temperature),
    humidity: c.relative_humidity_2m,
    windKmh: Math.round(c.wind_speed_10m),
    precipitation: c.precipitation,
    condition: info.label,
    anim: info.anim,
    icon: info.icon,
  };
}

function buildWeatherCardHtml(w) {
  return `
  <div class="weather-card">
    <div class="wx-anim ${w.anim}">
      <i class="fas ${w.icon} wx-main-icon"></i>
      ${w.anim === 'wx-rain' ? '<span class="wx-drop"></span><span class="wx-drop"></span><span class="wx-drop"></span><span class="wx-drop"></span>' : ''}
      ${w.anim === 'wx-snow' ? '<span class="wx-flake">❄</span><span class="wx-flake">❄</span><span class="wx-flake">❄</span>' : ''}
      ${w.anim === 'wx-storm' ? '<span class="wx-bolt"><i class="fas fa-bolt"></i></span>' : ''}
      ${w.anim === 'wx-cloud' ? '<i class="fas fa-cloud wx-cloud-extra"></i>' : ''}
    </div>
    <div class="wx-info">
      <div class="wx-place">${w.place}</div>
      <div class="wx-temp">${w.tempC}°C</div>
      <div class="wx-condition">${w.condition}</div>
      <div class="wx-details">
        <span><i class="fas fa-temperature-half"></i> Sensacion: ${w.feelsLikeC}°C</span>
        <span><i class="fas fa-droplet"></i> Humedad: ${w.humidity}%</span>
        <span><i class="fas fa-wind"></i> Viento: ${w.windKmh} km/h</span>
      </div>
    </div>
  </div>`;
}

// ---------- 3) GENERACION DE IMAGENES (Gemini image model, misma API key) ----------
// Nombre del modelo de imagenes de Gemini. Si Google cambia el nombre del modelo,
// actualiza esta constante (ver https://ai.google.dev/gemini-api/docs/image-generation).
const IMAGE_MODEL = "gemini-2.5-flash-image";

const IMAGE_PATTERNS = [
  /^(?:genera|generame|crea|creame|dibuja|dibujame|haz|hazme) (?:una |la |)imagen (?:de |sobre |que muestre |)(.+)/i,
  /^imagina (?:una |)imagen (?:de |sobre |)(.+)/i,
];

function detectImageGenQuery(text) {
  const t = text.trim();
  for (const re of IMAGE_PATTERNS) {
    const m = t.match(re);
    if (m && m[1] && m[1].trim().length > 1) return m[1].trim();
  }
  return null;
}

// Filtro local basico como capa adicional (el filtro real y principal es el de la API de Gemini,
// que nunca se debe desactivar). Bloquea intentos obvios de contenido sexual o con menores.
const BLOCKED_IMAGE_TERMS = [
  'nino', 'nina', 'ninos', 'ninas', 'menor de edad', 'menores de edad', 'infantil sexual',
  'desnud', 'sexual', 'porno', 'erotic', 'nsfw', 'xxx'
];

function isImagePromptBlocked(prompt) {
  const n = normalizeText(prompt);
  return BLOCKED_IMAGE_TERMS.some(term => n.includes(term));
}

async function generateImage(prompt, apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
      })
    }
  );

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j?.error?.message || msg; } catch (e) {}
    throw new Error(msg);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData);
  if (!imgPart) {
    const blockReason = data?.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`La imagen fue bloqueada por seguridad: ${blockReason}`);
    throw new Error('El modelo no devolvio ninguna imagen. Intenta reformular el prompt.');
  }
  return { base64: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType || 'image/png' };
}

// Expuesto globalmente para que main.js lo use sin bundler/modulos
window.CyberFeatures = {
  detectTimeQuery, renderTimeAnswer,
  detectWeatherQuery, fetchWeatherData, buildWeatherCardHtml,
  detectImageGenQuery, isImagePromptBlocked, generateImage,
};
