require("dotenv").config();
const crypto = require("crypto");
const express = require("express");

const {
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  APP_SECRET,
  GRAPH_VERSION = "v21.0",
  PORT = 3000,
} = process.env;

const API_URL = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

const app = express();

// Guardamos el body crudo para poder validar la firma de Meta
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

/* ------------------------------------------------------------------ */
/*  Envio de mensajes                                                  */
/* ------------------------------------------------------------------ */

async function sendMessage(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) {
    console.error("Error enviando mensaje:", res.status, await res.text());
  }
}

const sendText = (to, text) =>
  sendMessage({ to, type: "text", text: { body: text } });

// Menu principal con botones (maximo 3, titulo de hasta 20 caracteres)
const sendMainMenu = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: { type: "text", text: "Bienvenido 👋" },
      body: { text: "¿Qué quieres hacer hoy?" },
      footer: { text: "Elige una opción" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "ventas", title: "Ventas" } },
          { type: "reply", reply: { id: "soporte", title: "Soporte" } },
          { type: "reply", reply: { id: "mas_opciones", title: "Más opciones" } },
        ],
      },
    },
  });

// Menu en lista (hasta 10 opciones en total)
const sendListMenu = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Más opciones" },
      body: { text: "Selecciona lo que necesitas:" },
      footer: { text: "Toca el botón para ver la lista" },
      action: {
        button: "Ver opciones", // texto del boton que abre la lista (max 20 caracteres)
        sections: [
          {
            title: "Información",
            rows: [
              { id: "horarios", title: "Horarios", description: "Cuándo atendemos" },
              { id: "ubicacion", title: "Ubicación", description: "Dónde estamos" },
              { id: "precios", title: "Precios", description: "Nuestros planes" },
            ],
          },
          {
            title: "Contacto",
            rows: [
              { id: "asesor", title: "Hablar con un asesor", description: "Atención personalizada" },
              { id: "volver", title: "Volver al menú", description: "Menú principal" },
            ],
          },
        ],
      },
    },
  });

/* ------------------------------------------------------------------ */
/*  Logica del bot: que responder segun el id del boton/opcion         */
/* ------------------------------------------------------------------ */

const respuestas = {
  ventas: "🛒 Estas son nuestras opciones de venta. Escríbenos qué producto te interesa y te cotizamos.",
  soporte: "🛠️ Cuéntanos tu problema en un mensaje y te ayudamos lo antes posible.",
  horarios: "🕘 Atendemos de lunes a viernes de 8:00 a.m. a 6:00 p.m. y sábados de 9:00 a.m. a 1:00 p.m.",
  ubicacion: "📍 Estamos en Bogotá. Escribe tu ciudad y te indicamos la sede más cercana.",
  precios: "💰 Escríbenos qué servicio necesitas y te enviamos los precios actualizados.",
  asesor: "👤 Un asesor te escribirá en breve. Gracias por tu paciencia.",
};

async function handleIncoming(message) {
  const from = message.from;

  // 1) El usuario toco un boton o eligio algo de la lista
  if (message.type === "interactive") {
    const reply = message.interactive.button_reply || message.interactive.list_reply;
    const id = reply?.id;

    if (id === "mas_opciones") return sendListMenu(from);
    if (id === "volver") return sendMainMenu(from);
    if (respuestas[id]) {
      await sendText(from, respuestas[id]);
      return sendMainMenu(from);
    }
    return sendMainMenu(from);
  }

  // 2) Texto libre: mostramos el menu
  if (message.type === "text") {
    return sendMainMenu(from);
  }

  // 3) Imagenes, audios, etc.
  await sendText(from, "Por ahora solo puedo leer texto y opciones del menú 🙂");
  return sendMainMenu(from);
}

/* ------------------------------------------------------------------ */
/*  Webhook                                                            */
/* ------------------------------------------------------------------ */

// Verificacion inicial que hace Meta al configurar el webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

function firmaValida(req) {
  if (!APP_SECRET) return true; // si no configuraste APP_SECRET, no se valida (solo para pruebas)
  const firma = req.get("x-hub-signature-256");
  if (!firma || !req.rawBody) return false;
  const esperada =
    "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody).digest("hex");
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Recepcion de mensajes
app.post("/webhook", (req, res) => {
  if (!firmaValida(req)) return res.sendStatus(401);

  // Respondemos 200 enseguida para que Meta no reintente
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const messages = value?.messages;
    if (!messages) return; // puede ser un estado de entrega (enviado, leido...)

    for (const message of messages) {
      handleIncoming(message).catch((e) => console.error("Error manejando mensaje:", e));
    }
  } catch (e) {
    console.error("Error procesando webhook:", e);
  }
});

app.get("/", (_req, res) => res.send("Bot de WhatsApp funcionando ✅"));

app.listen(PORT, () => console.log(`Servidor escuchando en el puerto ${PORT}`));
