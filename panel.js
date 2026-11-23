// Panel web de conversaciones: /panel (protegido con ADMIN_KEY)
const path = require("path");

module.exports = function montarPanel(app, { historial, enviarManual, adminOk, negocio }) {
  const auth = (req, res, next) => (adminOk(req) ? next() : res.status(401).json({ error: "Clave incorrecta" }));
  const lim = (v, def, max = 300) => Math.min(Math.max(Number(v) || def, 1), max);

  // Nombre del asesor: lo escribe cada uno al entrar (la clave es la misma para todos).
  // Llega en la cabecera x-asesor (codificada) o en ?asesor= para el canal en vivo.
  const limpiarNombre = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
  // Lista fija de asesores (variable ASESORES="Andrea,Santiago"). Si está vacía, cada uno escribe su nombre libre.
  const ASESORES = String(process.env.ASESORES || "").split(",").map(limpiarNombre).filter(Boolean);
  const nombreAsesor = (req) => {
    let raw = req.get("x-asesor") || req.query.asesor || "";
    try { raw = decodeURIComponent(raw); } catch {}
    const n = limpiarNombre(raw);
    if (!n) return null;
    if (!ASESORES.length) return n;
    // Con lista fija, solo se aceptan esos nombres (con su escritura oficial)
    return ASESORES.find((a) => a.toLowerCase() === n.toLowerCase()) || null;
  };

  // Público a propósito: el login la necesita antes de tener la clave (solo son nombres)
  app.get("/panel/api/asesores", (_req, res) => res.json(ASESORES));

  // Presencia: qué asesor tiene abierto qué chat (en memoria; se reconstruye sola si el servidor reinicia)
  const conexiones = new Map(); // id de pestaña -> { asesor, viendo, res }
  const presencia = () => [...conexiones.values()].map(({ asesor, viendo, desde }) => ({ asesor, viendo, desde }));
  const avisarPresencia = () => {
    const payload = `event: presencia\ndata: ${JSON.stringify(presencia())}\n\n`;
    for (const c of conexiones.values()) c.res.write(payload);
  };

  app.get("/panel", (_req, res) => res.sendFile(path.join(__dirname, "public", "panel.html")));

  app.get("/panel/api/info", auth, (_req, res) => res.json({ negocio }));

  app.get("/panel/api/contactos", auth, async (req, res) => {
    const filas = await historial.listarContactos({
      buscar: req.query.buscar || "",
      pendientes: req.query.pendientes === "1",
      humano: req.query.humano === "1",
      etiqueta: req.query.etiqueta || "",
      limite: lim(req.query.limite, 100),
    });
    res.json((filas || []).map((c) => ({ ...c, ventana_abierta: historial.ventanaAbierta(c) })));
  });

  app.get("/panel/api/mensajes", auth, async (req, res) => {
    if (!req.query.wa_id) return res.status(400).json({ error: "Falta wa_id" });
    const [mensajes, contacto] = await Promise.all([
      historial.mensajes(String(req.query.wa_id), { limite: lim(req.query.limite, 200, 500) }),
      historial.contacto(String(req.query.wa_id)),
    ]);
    res.json({
      contacto: contacto && { ...contacto, ventana_abierta: historial.ventanaAbierta(contacto) },
      mensajes: mensajes || [],
    });
  });

  app.post("/panel/api/enviar", auth, async (req, res) => {
    const { to, texto } = req.body || {};
    if (!to || !String(texto || "").trim()) return res.status(400).json({ error: "Faltan destinatario o texto" });
    const r = await enviarManual(String(to), String(texto), "panel", nombreAsesor(req));
    if (!r.ok) return res.status(422).json({ error: errorMeta(r.error) });
    res.json(r);
  });

  app.post("/panel/api/atendido", auth, async (req, res) => {
    const { wa_id, pendiente = false } = req.body || {};
    if (!wa_id) return res.status(400).json({ error: "Falta wa_id" });
    res.json(await historial.marcarAsesor(String(wa_id), !!pendiente));
  });

  // Modo humano: detener o reactivar el bot para un cliente
  app.post("/panel/api/bot", auth, async (req, res) => {
    const { wa_id, pausado } = req.body || {};
    if (!wa_id || typeof pausado !== "boolean") return res.status(400).json({ error: "Faltan wa_id o pausado" });
    const c = await historial.pausarBot(String(wa_id), pausado);
    if (!c) return res.status(500).json({ error: "No se pudo cambiar el modo del bot" });
    res.json(c);
  });

  // Etiquetas tipo CRM
  app.get("/panel/api/etiquetas", auth, async (_req, res) => res.json((await historial.listarEtiquetas()) || []));

  app.post("/panel/api/etiquetas", auth, async (req, res) => {
    const { wa_id, etiquetas } = req.body || {};
    if (!wa_id || !Array.isArray(etiquetas)) return res.status(400).json({ error: "Faltan wa_id o etiquetas" });
    const c = await historial.ponerEtiquetas(String(wa_id), etiquetas);
    if (!c) return res.status(500).json({ error: "No se pudieron guardar las etiquetas" });
    res.json(c);
  });

  // El panel avisa qué chat abrió (o null al cerrarlo)
  app.post("/panel/api/presencia", auth, (req, res) => {
    const { pestana, viendo } = req.body || {};
    const c = conexiones.get(String(pestana || ""));
    if (!c) return res.status(404).json({ error: "Pestaña no conectada" });
    const nuevo = viendo ? String(viendo) : null;
    if (c.viendo !== nuevo) { c.viendo = nuevo; c.desde = Date.now(); avisarPresencia(); }
    res.json({ ok: true });
  });

  // Tiempo real (Server-Sent Events). EventSource no permite cabeceras: la clave va en ?key=
  app.get("/panel/api/eventos", auth, (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": ok\n\n");
    const enviar = (evento) => (data, contacto) =>
      res.write(`event: ${evento}\ndata: ${JSON.stringify(contacto ? { ...data, contacto } : data)}\n\n`);
    const handlers = { mensaje: enviar("mensaje"), estado: enviar("estado"), contacto: enviar("contacto") };
    for (const [ev, fn] of Object.entries(handlers)) historial.eventos.on(ev, fn);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);

    // Registrar esta pestaña para la presencia
    const pestana = String(req.query.pestana || "").slice(0, 64);
    if (pestana) {
      conexiones.set(pestana, { asesor: nombreAsesor(req) || "Asesor", viendo: null, desde: Date.now(), res });
      avisarPresencia();
    } else {
      res.write(`event: presencia\ndata: ${JSON.stringify(presencia())}\n\n`);
    }

    req.on("close", () => {
      clearInterval(ping);
      for (const [ev, fn] of Object.entries(handlers)) historial.eventos.off(ev, fn);
      if (pestana && conexiones.get(pestana)?.res === res) { conexiones.delete(pestana); avisarPresencia(); }
    });
  });
};

// Traduce los errores más comunes de Meta a algo entendible
function errorMeta(raw) {
  let e;
  try { e = JSON.parse(raw)?.error; } catch { return String(raw || "Error desconocido"); }
  if (e?.code === 131047 || /24 hours|re-engagement/i.test(e?.message || ""))
    return "Pasaron más de 24 h desde el último mensaje del cliente. Solo puedes escribirle con una plantilla aprobada.";
  return `${e?.message || "Error de Meta"}${e?.code ? ` (código ${e.code})` : ""}`;
}
module.exports.errorMeta = errorMeta;
