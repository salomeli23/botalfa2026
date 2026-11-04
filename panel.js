// Panel web de conversaciones: /panel (protegido con ADMIN_KEY)
const path = require("path");

module.exports = function montarPanel(app, { historial, enviarManual, adminOk, negocio }) {
  const auth = (req, res, next) => (adminOk(req) ? next() : res.status(401).json({ error: "Clave incorrecta" }));
  const lim = (v, def, max = 300) => Math.min(Math.max(Number(v) || def, 1), max);

  app.get("/panel", (_req, res) => res.sendFile(path.join(__dirname, "public", "panel.html")));

  app.get("/panel/api/info", auth, (_req, res) => res.json({ negocio }));

  app.get("/panel/api/contactos", auth, async (req, res) => {
    const filas = await historial.listarContactos({
      buscar: req.query.buscar || "",
      pendientes: req.query.pendientes === "1",
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
    const r = await enviarManual(String(to), String(texto), "panel");
    if (!r.ok) return res.status(422).json({ error: errorMeta(r.error) });
    res.json(r);
  });

  app.post("/panel/api/atendido", auth, async (req, res) => {
    const { wa_id, pendiente = false } = req.body || {};
    if (!wa_id) return res.status(400).json({ error: "Falta wa_id" });
    res.json(await historial.marcarAsesor(String(wa_id), !!pendiente));
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
    req.on("close", () => {
      clearInterval(ping);
      for (const [ev, fn] of Object.entries(handlers)) historial.eventos.off(ev, fn);
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
