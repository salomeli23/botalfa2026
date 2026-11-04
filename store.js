// Historial de conversaciones para el panel y el MCP.
// Con DATABASE_URL (Postgres de Railway) se guarda de forma permanente;
// sin ella se usa memoria (sirve para pruebas, se borra al reiniciar).
const { EventEmitter } = require("events");

const eventos = new EventEmitter();
eventos.setMaxListeners(100);

const VENTANA_24H = 24 * 60 * 60;
const ahora = () => Math.floor(Date.now() / 1000);

/* ------------------------------------------------------------------ */
/*  Extraer texto legible de los mensajes                              */
/* ------------------------------------------------------------------ */

// Mensaje que llega del cliente (o eco de lo que escribiste en el celular)
function textoEntrante(m) {
  switch (m.type) {
    case "text": return m.text?.body || "";
    case "interactive": {
      const r = m.interactive?.button_reply || m.interactive?.list_reply;
      return r ? `🔘 ${r.title}` : "[respuesta interactiva]";
    }
    case "button": return `🔘 ${m.button?.text || ""}`;
    case "image": return `[imagen]${m.image?.caption ? " " + m.image.caption : ""}`;
    case "video": return `[video]${m.video?.caption ? " " + m.video.caption : ""}`;
    case "document": return `[documento] ${m.document?.filename || m.document?.caption || ""}`.trim();
    case "audio": return "[audio]";
    case "sticker": return "[sticker]";
    case "location": return `[ubicación] ${m.location?.name || ""} ${m.location?.latitude},${m.location?.longitude}`.trim();
    case "contacts": return "[contacto]";
    case "reaction": return `[reacción] ${m.reaction?.emoji || ""}`.trim();
    default: return `[${m.type || "mensaje"}]`;
  }
}

// Mensaje que envía el bot (payload de la Cloud API)
function textoSaliente(p) {
  switch (p.type) {
    case "text": return p.text?.body || "";
    case "image": return `[imagen]${p.image?.caption ? " " + p.image.caption : ""}`;
    case "video": return `[video]${p.video?.caption ? " " + p.video.caption : ""}`;
    case "document": return `[documento] ${p.document?.filename || ""}`.trim();
    case "template": return `[plantilla] ${p.template?.name || ""}`;
    case "interactive": {
      const i = p.interactive || {};
      const partes = [i.header?.text, i.body?.text].filter(Boolean);
      const botones = (i.action?.buttons || []).map((b) => b.reply?.title).filter(Boolean);
      if (botones.length) partes.push(botones.map((t) => `[${t}]`).join(" "));
      if (i.action?.sections) {
        const filas = i.action.sections.flatMap((s) => s.rows || []).map((r) => r.title);
        partes.push(`📋 ${i.action.button || "Lista"}: ${filas.join(", ")}`);
      }
      return partes.join("\n");
    }
    default: return `[${p.type || "mensaje"}]`;
  }
}

/* ------------------------------------------------------------------ */
/*  Backend: Postgres                                                  */
/* ------------------------------------------------------------------ */

function crearPostgres(url) {
  const { Pool } = require("pg");
  const local = /localhost|127\.0\.0\.1|\.railway\.internal/.test(url);
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
  // Si Postgres se reinicia, las conexiones inactivas fallan: lo registramos sin tumbar el bot
  pool.on("error", (e) => console.error("Postgres (conexión inactiva):", e.message));
  const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);

  return {
    tipo: "postgres",
    async init() {
      await q(`
        CREATE TABLE IF NOT EXISTS wa_contactos (
          wa_id TEXT PRIMARY KEY,
          nombre TEXT,
          phone_id TEXT,
          ultimo_ts BIGINT DEFAULT 0,
          ultimo_texto TEXT,
          ultimo_entrante_ts BIGINT DEFAULT 0,
          pendiente_asesor BOOLEAN DEFAULT FALSE,
          motivo_asesor TEXT
        );
        CREATE TABLE IF NOT EXISTS wa_mensajes (
          id TEXT PRIMARY KEY,
          wa_id TEXT NOT NULL,
          direccion TEXT NOT NULL,
          origen TEXT NOT NULL,
          tipo TEXT,
          texto TEXT,
          ts BIGINT NOT NULL,
          estado TEXT,
          orden BIGSERIAL
        );
        CREATE INDEX IF NOT EXISTS wa_mensajes_contacto_ts ON wa_mensajes (wa_id, ts);`);
    },
    async guardarMensaje(m) {
      const rows = await q(
        `INSERT INTO wa_mensajes (id, wa_id, direccion, origen, tipo, texto, ts, estado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [m.id, m.wa_id, m.direccion, m.origen, m.tipo, m.texto, m.ts, m.estado || null]
      );
      return rows.length > 0;
    },
    async actualizarEstado(id, estado) {
      const rows = await q(`UPDATE wa_mensajes SET estado = $2 WHERE id = $1 RETURNING *`, [id, estado]);
      return rows[0] || null;
    },
    async tocarContacto(c) {
      const rows = await q(
        `INSERT INTO wa_contactos (wa_id, nombre, phone_id, ultimo_ts, ultimo_texto, ultimo_entrante_ts)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (wa_id) DO UPDATE SET
           nombre = COALESCE(EXCLUDED.nombre, wa_contactos.nombre),
           phone_id = COALESCE(EXCLUDED.phone_id, wa_contactos.phone_id),
           ultimo_texto = CASE WHEN EXCLUDED.ultimo_ts >= wa_contactos.ultimo_ts THEN EXCLUDED.ultimo_texto ELSE wa_contactos.ultimo_texto END,
           ultimo_ts = GREATEST(wa_contactos.ultimo_ts, EXCLUDED.ultimo_ts),
           ultimo_entrante_ts = GREATEST(wa_contactos.ultimo_entrante_ts, EXCLUDED.ultimo_entrante_ts)
         RETURNING *`,
        [c.wa_id, c.nombre || null, c.phone_id || null, c.ts, c.texto, c.entrante ? c.ts : 0]
      );
      return rows[0];
    },
    async marcarAsesor(wa_id, pendiente, motivo) {
      const rows = await q(
        `INSERT INTO wa_contactos (wa_id, pendiente_asesor, motivo_asesor) VALUES ($1,$2,$3)
         ON CONFLICT (wa_id) DO UPDATE SET pendiente_asesor = $2, motivo_asesor = $3 RETURNING *`,
        [wa_id, pendiente, pendiente ? motivo || null : null]
      );
      return rows[0];
    },
    contacto: (wa_id) => q(`SELECT * FROM wa_contactos WHERE wa_id = $1`, [wa_id]).then((r) => r[0] || null),
    listarContactos({ buscar, pendientes, limite = 50 } = {}) {
      const cond = [];
      const params = [];
      if (buscar) { params.push(`%${buscar}%`); cond.push(`(nombre ILIKE $${params.length} OR wa_id LIKE $${params.length})`); }
      if (pendientes) cond.push(`pendiente_asesor`);
      params.push(limite);
      return q(
        `SELECT * FROM wa_contactos ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
         ORDER BY pendiente_asesor DESC, ultimo_ts DESC LIMIT $${params.length}`,
        params
      );
    },
    async mensajes(wa_id, { limite = 50, antes } = {}) {
      const rows = await q(
        `SELECT * FROM wa_mensajes WHERE wa_id = $1 AND ts < $2 ORDER BY ts DESC, orden DESC LIMIT $3`,
        [wa_id, antes || 2 ** 40, limite]
      );
      return rows.reverse();
    },
    buscar: (texto, limite = 30) =>
      q(
        `SELECT m.*, c.nombre FROM wa_mensajes m LEFT JOIN wa_contactos c USING (wa_id)
         WHERE m.texto ILIKE $1 ORDER BY m.ts DESC, m.orden DESC LIMIT $2`,
        [`%${texto}%`, limite]
      ),
  };
}

/* ------------------------------------------------------------------ */
/*  Backend: memoria                                                   */
/* ------------------------------------------------------------------ */

function crearMemoria() {
  const MAX_MENSAJES = 5000;
  const contactos = new Map();
  const mensajes = new Map(); // id -> mensaje (Map conserva el orden de inserción)

  const base = (wa_id) => contactos.get(wa_id) || {
    wa_id, nombre: null, phone_id: null, ultimo_ts: 0, ultimo_texto: null,
    ultimo_entrante_ts: 0, pendiente_asesor: false, motivo_asesor: null,
  };

  return {
    tipo: "memoria",
    async init() {},
    async guardarMensaje(m) {
      if (mensajes.has(m.id)) return false;
      mensajes.set(m.id, { estado: null, ...m });
      if (mensajes.size > MAX_MENSAJES) mensajes.delete(mensajes.keys().next().value);
      return true;
    },
    async actualizarEstado(id, estado) {
      const m = mensajes.get(id);
      if (!m) return null;
      m.estado = estado;
      return m;
    },
    async tocarContacto(c) {
      const x = base(c.wa_id);
      x.nombre = c.nombre || x.nombre;
      x.phone_id = c.phone_id || x.phone_id;
      if (c.ts >= x.ultimo_ts) { x.ultimo_ts = c.ts; x.ultimo_texto = c.texto; }
      if (c.entrante) x.ultimo_entrante_ts = Math.max(x.ultimo_entrante_ts, c.ts);
      contactos.set(c.wa_id, x);
      return x;
    },
    async marcarAsesor(wa_id, pendiente, motivo) {
      const x = base(wa_id);
      x.pendiente_asesor = pendiente;
      x.motivo_asesor = pendiente ? motivo || null : null;
      contactos.set(wa_id, x);
      return x;
    },
    contacto: async (wa_id) => contactos.get(wa_id) || null,
    async listarContactos({ buscar, pendientes, limite = 50 } = {}) {
      const b = (buscar || "").toLowerCase();
      return [...contactos.values()]
        .filter((c) => !pendientes || c.pendiente_asesor)
        .filter((c) => !b || c.wa_id.includes(b) || (c.nombre || "").toLowerCase().includes(b))
        .sort((a, z) => (z.pendiente_asesor - a.pendiente_asesor) || (z.ultimo_ts - a.ultimo_ts))
        .slice(0, limite);
    },
    async mensajes(wa_id, { limite = 50, antes } = {}) {
      return [...mensajes.values()]
        .filter((m) => m.wa_id === wa_id && m.ts < (antes || 2 ** 40))
        .sort((a, z) => a.ts - z.ts)
        .slice(-limite);
    },
    async buscar(texto, limite = 30) {
      const t = texto.toLowerCase();
      return [...mensajes.values()]
        .filter((m) => (m.texto || "").toLowerCase().includes(t))
        .sort((a, z) => z.ts - a.ts)
        .slice(0, limite)
        .map((m) => ({ ...m, nombre: contactos.get(m.wa_id)?.nombre || null }));
    },
  };
}

/* ------------------------------------------------------------------ */
/*  API pública                                                         */
/* ------------------------------------------------------------------ */

const db = process.env.DATABASE_URL ? crearPostgres(process.env.DATABASE_URL) : crearMemoria();
const listo = db.init().then(
  () => console.log(`Historial de mensajes: ${db.tipo === "postgres" ? "Postgres" : "memoria (se borra al reiniciar; agrega DATABASE_URL)"}`),
  (e) => console.error("Error iniciando la base de datos del historial:", e.message)
);

// Ningún error del historial debe tumbar al bot
const seguro = (fn) => async (...args) => {
  try { await listo; return await fn(...args); } catch (e) { console.error("Historial:", e.message); return null; }
};

const registrar = seguro(async ({ id, wa_id, direccion, origen, tipo, texto, ts, estado, nombre, phone_id }) => {
  if (!id || !wa_id) return;
  ts = Number(ts) || ahora();
  const nuevo = await db.guardarMensaje({ id, wa_id, direccion, origen, tipo, texto, ts, estado });
  if (!nuevo) return;
  const contacto = await db.tocarContacto({ wa_id, nombre, phone_id, ts, texto, entrante: direccion === "entrante" });
  eventos.emit("mensaje", { id, wa_id, direccion, origen, tipo, texto, ts, estado: estado || null }, contacto);
});

module.exports = {
  eventos,
  textoEntrante,
  textoSaliente,
  ventanaAbierta: (c) => !!c && ahora() - Number(c.ultimo_entrante_ts || 0) < VENTANA_24H,

  // Mensaje que escribió el cliente
  registrarEntrante: (m, { nombre, phone_id } = {}) =>
    registrar({ id: m.id, wa_id: m.from, direccion: "entrante", origen: "cliente", tipo: m.type, texto: textoEntrante(m), ts: m.timestamp, nombre, phone_id }),

  // Lo que respondiste desde la app WhatsApp Business del celular (coexistencia)
  registrarEco: (m, { phone_id } = {}) =>
    registrar({ id: m.id, wa_id: m.to, direccion: "saliente", origen: "telefono", tipo: m.type, texto: textoEntrante(m), ts: m.timestamp, estado: "sent", phone_id }),

  // Lo que envió el bot, el panel o Claude por la API
  registrarSaliente: (payload, id, origen, phone_id) =>
    registrar({ id, wa_id: payload.to, direccion: "saliente", origen, tipo: payload.type, texto: textoSaliente(payload), estado: "sent", phone_id }),

  actualizarEstado: seguro(async (id, estado) => {
    const m = await db.actualizarEstado(id, estado);
    if (m) eventos.emit("estado", { id, wa_id: m.wa_id, estado });
  }),

  marcarAsesor: seguro(async (wa_id, pendiente, motivo) => {
    const c = await db.marcarAsesor(wa_id, pendiente, motivo);
    eventos.emit("contacto", c);
    return c;
  }),

  contacto: seguro((wa_id) => db.contacto(wa_id)),
  listarContactos: seguro((opts) => db.listarContactos(opts)),
  mensajes: seguro((wa_id, opts) => db.mensajes(wa_id, opts)),
  buscar: seguro((texto, limite) => db.buscar(texto, limite)),
};
