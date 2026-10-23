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

/* ------------------------------------------------------------------ */
/*  Saludo principal con la lista de servicios                         */
/*  Limites de WhatsApp: cuerpo 1024 caracteres, titulo de fila 24,    */
/*  descripcion de fila 72, texto del boton 20, pie 60.                */
/* ------------------------------------------------------------------ */

const SALUDO = `¡Hola! 👋 Soy Andrea 🙋‍♀️, asesora de Alfa Polarizados.

📍 Estamos ubicados en la Cra. 49 #134A-41 – Barrio Spring, Bogotá.

Estoy lista para ayudarte a elegir el mejor servicio para tu vehículo. 😊

Trabajamos con materiales de alta calidad y procesos profesionales, diseñados para clientes que realmente valoran la calidad y el detalle. 🛡️

💬 Indícame qué servicio deseas:`;

const sendMainMenu = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: SALUDO },
      footer: { text: "Toca el botón para elegir" },
      action: {
        button: "Ver servicios",
        sections: [
          {
            title: "Nuestros servicios",
            rows: [
              {
                id: "servicio_1",
                title: "Polarizado vehicular",
                description: "Polarizado y seguridad vehicular 🚗",
              },
              {
                id: "servicio_2",
                title: "PPF",
                description: "Protección de pintura, Piano Black y partes acrílicas",
              },
              {
                id: "servicio_3",
                title: "Película Antiatraco",
                description: "Mayor seguridad para tus vidrios 🚨",
              },
              {
                id: "servicio_4",
                title: "Arquitectónico",
                description: "Polarizado arquitectónico 🏢",
              },
              {
                id: "servicio_5",
                title: "Detailing Profesional",
                description: "Cuidado y detalle para tu vehículo ✨",
              },
            ],
          },
        ],
      },
    },
  });

// Botones que se envian despues de cada respuesta (maximo 3, titulo de hasta 20 caracteres)
const sendFollowUp = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "¿Qué deseas hacer ahora?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "asesor", title: "Hablar con asesor" } },
          { type: "reply", reply: { id: "volver", title: "Ver servicios" } },
        ],
      },
    },
  });

/* ------------------------------------------------------------------ */
/*  Respuestas por servicio (edita estos textos a tu gusto)            */
/* ------------------------------------------------------------------ */

const PEDIR_DATOS =
  "Para ayudarte mejor, cuéntame por favor:\n• Marca, modelo y año de tu vehículo\n• Si tienes alguna pregunta específica";

const servicios = {
  servicio_1: `🚗 *Polarizado y seguridad vehicular*\n\nTe asesoramos para elegir la película que mejor se adapte a tu vehículo.\n\n${PEDIR_DATOS}`,
  servicio_2: `🛡️ *PPF: protección de pintura, Piano Black y partes acrílicas*\n\nProtegemos tu vehículo con procesos profesionales.\n\n${PEDIR_DATOS}`,
  servicio_3: `🚨 *Película Antiatraco*\n\nAumenta la seguridad de los vidrios de tu vehículo.\n\n${PEDIR_DATOS}`,
  servicio_4:
    "🏢 *Polarizado Arquitectónico*\n\nCuéntame por favor:\n• Si es para casa, oficina o local\n• Cantidad aproximada de ventanas o metros\n• Ciudad y barrio",
  servicio_5: `✨ *Detailing Profesional*\n\nCuidado y detalle para que tu vehículo luzca como nuevo.\n\n${PEDIR_DATOS}`,
};

const MSG_ASESOR =
  "👤 Perfecto, un asesor continuará la conversación contigo en breve. ¡Gracias por tu paciencia! 😊";

/* ------------------------------------------------------------------ */
/*  Logica del bot                                                     */
/* ------------------------------------------------------------------ */

async function responderServicio(from, id) {
  await sendText(from, servicios[id]);
  return sendFollowUp(from);
}

async function handleIncoming(message) {
  const from = message.from;

  // 1) El usuario eligio algo de la lista o toco un boton
  if (message.type === "interactive") {
    const reply = message.interactive.button_reply || message.interactive.list_reply;
    const id = reply?.id;

    if (servicios[id]) return responderServicio(from, id);
    if (id === "asesor") return sendText(from, MSG_ASESOR);
    return sendMainMenu(from); // "volver" u otro
  }

  // 2) Texto: si escribe un numero del 1 al 5, lo tratamos como la opcion elegida
  if (message.type === "text") {
    const texto = (message.text?.body || "").trim();
    if (/^[1-5]$/.test(texto)) return responderServicio(from, `servicio_${texto}`);
    return sendMainMenu(from);
  }

  // 3) Imagenes, audios, etc.
  await sendText(from, "Por ahora solo puedo leer texto y las opciones del menú 🙂");
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
    console.log("Webhook verificado correctamente por Meta");
    return res.status(200).send(challenge);
  }
  console.error("Fallo la verificacion del webhook: el VERIFY_TOKEN no coincide");
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
  console.log("POST /webhook recibido");

  if (!firmaValida(req)) {
    console.error(
      "Firma invalida: el APP_SECRET de Railway no coincide con el de la app de Meta. Mensaje ignorado."
    );
    return res.sendStatus(401);
  }

  // Respondemos 200 enseguida para que Meta no reintente
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const messages = value?.messages;
    if (!messages) {
      console.log(
        "Evento sin mensajes (estado de entrega u otro):",
        JSON.stringify(value?.statuses?.[0]?.status || "otro")
      );
      return; // puede ser un estado de entrega (enviado, leido...)
    }

    for (const message of messages) {
      console.log("Mensaje recibido de", message.from, "tipo:", message.type);
      handleIncoming(message).catch((e) => console.error("Error manejando mensaje:", e));
    }
  } catch (e) {
    console.error("Error procesando webhook:", e);
  }
});

app.get("/", (_req, res) => res.send("Bot de WhatsApp funcionando ✅"));

app.listen(PORT, () => console.log(`Servidor escuchando en el puerto ${PORT}`));
