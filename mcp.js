// MCP remoto (Streamable HTTP) para que Claude lea y responda las conversaciones del bot.
// URL: https://TU-APP.up.railway.app/mcp/<MCP_KEY>   (o /mcp con "Authorization: Bearer <MCP_KEY>")
const crypto = require("crypto");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");
const { errorMeta } = require("./panel");

const iso = (ts) => (ts ? new Date(Number(ts) * 1000).toISOString() : null);
const soloDigitos = (s) => String(s || "").replace(/\D/g, "");

function claveValida(req) {
  const { MCP_KEY } = process.env;
  if (!MCP_KEY) return false;
  const dada = req.params.clave || (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(String(dada));
  const b = Buffer.from(MCP_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function crearServidor({ historial, enviarManual, negocio }) {
  const server = new McpServer({ name: `whatsapp-${negocio}`, version: "1.0.0" });
  const ok = (data) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
  const fallo = (msg) => ({ isError: true, content: [{ type: "text", text: msg }] });

  const contactoOut = (c) => ({
    numero: c.wa_id,
    nombre: c.nombre,
    ultimo_mensaje: c.ultimo_texto,
    fecha: iso(c.ultimo_ts),
    pidio_asesor: !!c.pendiente_asesor,
    ...(c.pendiente_asesor ? { motivo: c.motivo_asesor } : {}),
    puede_responder: historial.ventanaAbierta(c),
  });

  server.registerTool("listar_conversaciones", {
    title: "Listar conversaciones",
    description: `Conversaciones recientes del bot de WhatsApp de ${negocio}. Primero aparecen los clientes que pidieron asesor. "puede_responder" indica si sigue abierta la ventana de 24 h de Meta.`,
    inputSchema: {
      buscar: z.string().optional().describe("Filtra por nombre o número"),
      solo_pendientes: z.boolean().optional().describe("Solo los clientes que pidieron hablar con un asesor"),
      limite: z.number().int().min(1).max(100).optional().describe("Por defecto 20"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ buscar, solo_pendientes, limite = 20 }) => {
    const filas = await historial.listarContactos({ buscar, pendientes: !!solo_pendientes, limite });
    return ok((filas || []).map(contactoOut));
  });

  server.registerTool("leer_conversacion", {
    title: "Leer conversación",
    description: 'Mensajes con un cliente, del más antiguo al más reciente. "de" indica quién escribió: cliente, bot, telefono (el dueño desde la app), panel o claude.',
    inputSchema: {
      numero: z.string().describe("Número del cliente, ej. 573001234567"),
      limite: z.number().int().min(1).max(200).optional().describe("Por defecto 40"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ numero, limite = 40 }) => {
    const wa_id = soloDigitos(numero);
    const [c, mensajes] = await Promise.all([historial.contacto(wa_id), historial.mensajes(wa_id, { limite })]);
    if (!c) return fallo(`No hay conversación con ${wa_id}.`);
    return ok({
      cliente: contactoOut(c),
      mensajes: (mensajes || []).map((m) => ({ de: m.origen, texto: m.texto, fecha: iso(m.ts), ...(m.estado ? { estado: m.estado } : {}) })),
    });
  });

  server.registerTool("buscar_mensajes", {
    title: "Buscar mensajes",
    description: "Busca un texto en todas las conversaciones guardadas.",
    inputSchema: {
      texto: z.string().min(1),
      limite: z.number().int().min(1).max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  }, async ({ texto, limite = 30 }) => {
    const filas = await historial.buscar(texto, limite);
    return ok((filas || []).map((m) => ({ numero: m.wa_id, nombre: m.nombre, de: m.origen, texto: m.texto, fecha: iso(m.ts) })));
  });

  server.registerTool("enviar_mensaje", {
    title: "Enviar mensaje",
    description: `Envía un mensaje de texto a un cliente desde el número de WhatsApp de ${negocio} (aparece en el panel y en la app del celular). Solo funciona si el cliente escribió en las últimas 24 h. Confirma el texto con el usuario antes de enviarlo.`,
    inputSchema: {
      numero: z.string().describe("Número del cliente, ej. 573001234567"),
      texto: z.string().min(1).max(4096),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async ({ numero, texto }) => {
    const r = await enviarManual(soloDigitos(numero), texto, "claude");
    return r.ok ? ok(`Enviado a ${soloDigitos(numero)} (id ${r.id}).`) : fallo(errorMeta(r.error));
  });

  server.registerTool("marcar_atendido", {
    title: "Marcar atendido",
    description: "Quita (o vuelve a poner) la marca de 'pidió asesor' de un cliente.",
    inputSchema: {
      numero: z.string(),
      pendiente: z.boolean().optional().describe("true para volver a marcarlo como pendiente. Por defecto false"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ numero, pendiente = false }) => {
    await historial.marcarAsesor(soloDigitos(numero), pendiente);
    return ok(pendiente ? "Marcado como pendiente." : "Marcado como atendido.");
  });

  return server;
}

module.exports = function montarMcp(app, deps) {
  const rutas = ["/mcp", "/mcp/:clave"];

  app.post(rutas, async (req, res) => {
    if (!process.env.MCP_KEY) return res.status(503).json({ error: "Define la variable MCP_KEY en Railway para activar el MCP." });
    if (!claveValida(req)) return res.status(401).json({ error: "No autorizado" });
    // Modo sin estado: un servidor nuevo por petición (funciona bien con varias réplicas y reinicios)
    const server = crearServidor(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("MCP:", e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Error interno" }, id: null });
    }
  });

  app.all(rutas, (_req, res) =>
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Método no permitido" }, id: null })
  );
};
