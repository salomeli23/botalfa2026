require("dotenv").config();
const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const express = require("express");

const {
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  APP_SECRET,
  GRAPH_VERSION = "v26.0",
  FB_APP_ID, // ID de tu app de Meta (para el boton de conexion por QR)
  ES_CONFIG_ID, // configuration ID de Embedded Signup
  ADMIN_KEY, // clave para abrir /conectar
  PORT = 3000,
} = process.env;

// Numero que recibio cada mensaje: asi el bot responde desde el numero conectado por QR
// sin guardar nada en disco (si no llega, se usa PHONE_NUMBER_ID de las variables).
const contexto = new AsyncLocalStorage();
const apiUrl = () =>
  `https://graph.facebook.com/${GRAPH_VERSION}/${contexto.getStore()?.phoneId || PHONE_NUMBER_ID}/messages`;

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
  const res = await fetch(apiUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) {
    console.error("Error enviando mensaje:", res.status, await res.text());
    return false;
  }
  return true;
}

const sendText = (to, text) =>
  sendMessage({ to, type: "text", text: { body: text } });

// WhatsApp descarga el archivo desde el enlace (debe ser publico). Imagen: jpg/png hasta 5 MB.
const sendImage = (to, link, caption) =>
  sendMessage({ to, type: "image", image: { link, ...(caption ? { caption } : {}) } });

// Video: mp4 (H.264 + AAC) de hasta 16 MB
const sendVideo = (to, link, caption) =>
  sendMessage({ to, type: "video", video: { link, ...(caption ? { caption } : {}) } });

const sendVolverMenu = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Si quieres consultar otro servicio, toca el botón 👇" },
      action: { buttons: [{ type: "reply", reply: { id: "volver", title: "Otros servicios" } }] },
    },
  });

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

// Botones que se envian al final (maximo 3, titulo de hasta 20 caracteres)
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
          { type: "reply", reply: { id: "volver", title: "Otros servicios" } },
        ],
      },
    },
  });

/* ------------------------------------------------------------------ */
/*  Servicios                                                          */
/* ------------------------------------------------------------------ */

const NOMBRE_SERVICIO = {
  servicio_1: "Polarizado y seguridad vehicular",
  servicio_2: "PPF (protección de pintura, Piano Black y partes acrílicas)",
  servicio_3: "Película Antiatraco",
  servicio_4: "Polarizado Arquitectónico",
  servicio_5: "Detailing Profesional",
};

// Servicios que preguntan marca y modelo del vehiculo
const SERVICIOS_CON_VEHICULO = new Set(["servicio_1", "servicio_2", "servicio_3", "servicio_5"]);

// Texto de bienvenida de cada servicio (edita a tu gusto)
const descripciones = {
  servicio_1: "🚗 *Polarizado y seguridad vehicular*\n\nTe asesoramos para elegir la película que mejor se adapte a tu vehículo.",
  servicio_2: "🛡️ *PPF: protección de pintura, Piano Black y partes acrílicas*\n\nProtegemos tu vehículo con procesos profesionales.",
  servicio_3: "🚨 *Película Antiatraco*\n\nAumenta la seguridad de los vidrios de tu vehículo.",
  servicio_4: "🏢 *Polarizado Arquitectónico*\n\nTe asesoramos para dar confort y privacidad a tus espacios.",
  servicio_5: "✨ *Detailing Profesional*\n\nCuidado y detalle para que tu vehículo luzca como nuevo.",
};

const MSG_ASESOR =
  "👤 Perfecto, un asesor continuará la conversación contigo en breve. ¡Gracias por tu paciencia! 😊";

/* ------------------------------------------------------------------ */
/*  Planes y videos del servicio 1 (polarizado vehicular)              */
/*  Se envian en el orden de estas listas.                             */
/* ------------------------------------------------------------------ */

const PLANES_POLARIZADO = [
  "https://res.cloudinary.com/ryidlaom/image/upload/v1792779622/WhatsApp_Image_2026-09-22_at_1.54.19_PM.jpg",
  "https://res.cloudinary.com/ryidlaom/image/upload/v1792779621/WhatsApp_Image_2026-09-22_at_1.54.18_PM.jpg",
  "https://res.cloudinary.com/ryidlaom/image/upload/v1792779622/WhatsApp_Image_2026-09-22_at_1.54.21_PM.jpg",
];

// Segundos de espera entre las imagenes de los planes y el mensaje del asesor con los botones
const ESPERA_ANTES_DE_VIDEOS_MS = 5000;

// Segundos de espera entre el mensaje de los videos y la pregunta de que plan le gusto
const ESPERA_PREGUNTA_PLAN_MS = 10000;

// Cada video se envia solo si el cliente toca su boton (titulo del boton: maximo 20 caracteres)
const VIDEOS_POLARIZADO = {
  video_instalacion: {
    boton: "Ver instalación",
    titulo: "Instalación",
    url: "https://res.cloudinary.com/ryidlaom/video/upload/v1792779622/VID-20260818-WA0023.mp4",
  },
  video_visibilidad: {
    boton: "Ver visibilidad",
    titulo: "Visibilidad",
    url: "https://res.cloudinary.com/ryidlaom/video/upload/v1792779622/VID-20260818-WA0022.mp4",
  },
  video_prueba: {
    boton: "Prueba de seguridad",
    titulo: "Prueba de seguridad",
    url: "https://res.cloudinary.com/ryidlaom/video/upload/v1792779622/VID-20260819-WA0011.mp4",
  },
};

// Botones con los videos que el cliente aun no ha visto (maximo 3 botones)
const sendVideoMenu = (to, vistos, texto) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: texto },
      action: {
        buttons: Object.entries(VIDEOS_POLARIZADO)
          .filter(([id]) => !vistos.includes(id))
          .slice(0, 3)
          .map(([id, v]) => ({ type: "reply", reply: { id, title: v.boton } })),
      },
    },
  });

// Envia los planes y ofrece los videos; el asesor toma la conversacion desde aqui
async function enviarPlanesPolarizado(from, vehiculo) {
  await sendText(from, "📋 Estos son nuestros *3 planes de polarizado*. Mira las opciones 👇");
  for (const url of PLANES_POLARIZADO) await sendImage(from, url);

  console.log(`ASESOR: cliente ${from} vio los planes de polarizado (${vehiculo}), pasa a asesor`);

  // Pausa para que el cliente alcance a ver los planes antes de mostrar el aviso y los botones
  await new Promise((resolve) => setTimeout(resolve, ESPERA_ANTES_DE_VIDEOS_MS));

  await sendVideoMenu(
    from,
    [],
    "👤 Un asesor te escribirá en breve para ayudarte a elegir el plan ideal para tu vehículo. Si tienes alguna pregunta, escríbela aquí.\n\n🎥 Mientras tanto, ¿quieres ver algún video?"
  );

  // Pasados unos segundos, preguntamos cual plan le gusto
  await new Promise((resolve) => setTimeout(resolve, ESPERA_PREGUNTA_PLAN_MS));

  // Si el cliente reinicio la conversacion ("hola", "menu"...) mientras esperabamos, no lo molestamos
  if (getSession(from)?.servicio !== "servicio_1") return;
  return sendPlanQuestion(from);
}

// Pregunta cual plan le gusto (titulo del boton: maximo 20 caracteres)
const OPCIONES_PLAN = {
  plan_ceramico: { boton: "Alfa Cerámico", nombre: "Alfa Cerámico" },
  plan_highcontrol: { boton: "Alfa High Control", nombre: "Alfa High Control" },
  plan_irr: { boton: "Alfa IR-R", nombre: "Alfa IR-R" },
};

const sendPlanQuestion = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "😊 ¿Cuál plan te gustó más?" },
      action: {
        buttons: Object.entries(OPCIONES_PLAN).map(([id, p]) => ({
          type: "reply",
          reply: { id, title: p.boton },
        })),
      },
    },
  });

// El cliente toco el boton de un plan
async function responderPlan(from, id) {
  const plan = OPCIONES_PLAN[id];
  if (!plan) return sendMainMenu(from);

  setSession(from, { plan: plan.nombre, estado: "listo" });
  const s = getSession(from);
  console.log(`PLAN ELEGIDO: cliente ${from} | plan: ${plan.nombre} | vehiculo: ${[s.marca, s.modelo].filter(Boolean).join(" ")}`);

  await sendText(
    from,
    `¡Excelente elección! 🙌 Anoté tu interés en el plan *${plan.nombre}*. El asesor te dará todos los detalles en breve. 😊`
  );
  return sendVolverMenu(from);
}

// El cliente toco el boton de un video
async function responderVideo(from, id) {
  const video = VIDEOS_POLARIZADO[id];
  if (!video) return sendMainMenu(from);

  const vistos = [...new Set([...(getSession(from)?.vistos || []), id])];
  setSession(from, { vistos, estado: "listo" });

  await sendVideo(from, video.url, `🎬 ${video.titulo}`);

  if (vistos.length < Object.keys(VIDEOS_POLARIZADO).length) {
    return sendVideoMenu(from, vistos, "¿Quieres ver otro video? 👇");
  }
  return sendVolverMenu(from);
}

/* ------------------------------------------------------------------ */
/*  Planes de pelicula antiatraco (servicio 3)                         */
/*  Titulo de fila de la lista: maximo 24 caracteres.                  */
/* ------------------------------------------------------------------ */

const PELICULAS_ANTIATRACO = {
  film_bronce: {
    nombre: "Plan Bronce",
    url: "https://res.cloudinary.com/ryidlaom/image/upload/v1792864170/bronce.jpg",
  },
  film_plata: {
    nombre: "Plan Plata",
    url: "https://res.cloudinary.com/ryidlaom/image/upload/v1792864170/plata.jpg",
  },
  film_oro: {
    nombre: "Plan Oro",
    url: "https://res.cloudinary.com/ryidlaom/image/upload/v1792864170/oro.jpg",
  },
  film_platino: {
    nombre: "Plan Platino",
    url: "https://res.cloudinary.com/ryidlaom/image/upload/v1792864170/platino.jpg",
  },
  film_diamante: {
    nombre: "Plan Diamante",
    url: "https://res.cloudinary.com/ryidlaom/image/upload/v1792864170/diamante.jpg",
  },
};

// Video de la pelicula antiatraco (mp4 H.264 + AAC, maximo 16 MB)
const VIDEO_ANTIATRACO_URL =
  "https://res.cloudinary.com/ryidlaom/video/upload/v1792864171/Pelicula_Antiatraco.mp4";
const ID_VIDEO_ANTIATRACO = "antiatraco_video"; // no empieza con "video_" (esos son del polarizado)

const sendAntiatracoList = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "😊 ¿Cuál plan de película antiatraco quieres ver?" },
      footer: { text: "Toca el botón para elegir" },
      action: {
        button: "Ver planes",
        sections: [
          {
            title: "Planes antiatraco",
            rows: Object.entries(PELICULAS_ANTIATRACO).map(([id, p]) => ({ id, title: p.nombre })),
          },
        ],
      },
    },
  });

const sendBotonVideoAntiatraco = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "🎬 Mira cómo funciona nuestra película antiatraco 👇" },
      action: {
        buttons: [{ type: "reply", reply: { id: ID_VIDEO_ANTIATRACO, title: "Ver video" } }],
      },
    },
  });

// Botones que se muestran despues de ver la imagen de un plan (maximo 3, titulo de hasta 20 caracteres)
const ID_ANTIATRACO_OTRO = "antiatraco_otro";
const ID_ANTIATRACO_ASESOR = "antiatraco_asesor";

const sendBotonesPostPlan = (to, nombrePlan) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: `¿Te interesa el *${nombrePlan}*? ¿Qué deseas hacer ahora? 👇` },
      action: {
        buttons: [
          { type: "reply", reply: { id: ID_ANTIATRACO_ASESOR, title: "Hablar con asesor" } },
          { type: "reply", reply: { id: ID_ANTIATRACO_OTRO, title: "Ver otro plan" } },
          { type: "reply", reply: { id: ID_VIDEO_ANTIATRACO, title: "Ver video" } },
        ],
      },
    },
  });

// Muestra el boton del video y la lista de planes (sin enviar todas las imagenes)
async function enviarPeliculasAntiatraco(from, vehiculo) {
  setSession(from, { pelicula: null });
  await sendText(from, "🛡️ Tenemos varios *planes de película de seguridad Antiatraco*. Elige el que quieres ver 👇");
  await sendBotonVideoAntiatraco(from);
  console.log(`ANTIATRACO: cliente ${from} vio la lista de planes (${vehiculo})`);
  return sendAntiatracoList(from);
}

// El cliente toco "Ver video": enviamos el video y volvemos a donde estaba
async function responderVideoAntiatraco(from) {
  await sendVideo(from, VIDEO_ANTIATRACO_URL, "🎬 Película Antiatraco");
  console.log(`ANTIATRACO VIDEO: cliente ${from} vio el video`);

  const s = getSession(from);
  if (s?.estado !== "antiatraco") return sendVolverMenu(from); // boton viejo: la conversacion ya habia terminado
  return s.pelicula ? sendBotonesPostPlan(from, s.pelicula) : sendAntiatracoList(from);
}

// El cliente eligio un plan de la lista: le mostramos esa imagen
async function responderPelicula(from, id) {
  const p = PELICULAS_ANTIATRACO[id];
  if (!p) return sendMainMenu(from);

  setSession(from, { pelicula: p.nombre, estado: "antiatraco" });
  console.log(`ANTIATRACO PLAN VISTO: cliente ${from} | ${p.nombre} | vehiculo: ${getSession(from)?.vehiculo || "-"}`);

  const enviada = await sendImage(from, p.url, p.nombre);
  if (!enviada) await sendText(from, `📌 ${p.nombre}`);
  return sendBotonesPostPlan(from, p.nombre);
}

// El cliente quiere hablar con un asesor sobre el plan que vio
async function antiatracoAAsesor(from) {
  const s = getSession(from) || {};
  return pasarAAsesor(from, `Antiatraco: interesado en ${s.pelicula || "planes antiatraco"}`);
}

/* ------------------------------------------------------------------ */
/*  Arquitectonico (servicio 4): ciudad -> lugar -> medidas -> asesor  */
/*  Titulo de fila de la lista: maximo 24 caracteres.                  */
/* ------------------------------------------------------------------ */

const CIUDADES_ARQ = {
  arqciudad_bogota: "Bogotá",
  arqciudad_medellin: "Medellín",
  arqciudad_cali: "Cali",
  arqciudad_bucaramanga: "Bucaramanga",
  arqciudad_villavicencio: "Villavicencio",
};
const ID_ARQ_CIUDAD_OTRA = "arqciudad_otra";

const LUGARES_ARQ = {
  arqlugar_casa: "Casa",
  arqlugar_apartamento: "Apartamento",
  arqlugar_oficina: "Oficina",
  arqlugar_local: "Local comercial",
  arqlugar_edificio: "Edificio",
};
const ID_ARQ_LUGAR_OTRO = "arqlugar_otro";

const sendCiudadArqList = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "📍 ¿En qué ciudad te encuentras?" },
      footer: { text: "Toca el botón para elegir" },
      action: {
        button: "Ver ciudades",
        sections: [
          {
            title: "Ciudades",
            rows: [
              ...Object.entries(CIUDADES_ARQ).map(([id, title]) => ({ id, title })),
              { id: ID_ARQ_CIUDAD_OTRA, title: "Otra ciudad" },
            ],
          },
        ],
      },
    },
  });

const sendLugarArqList = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "🏢 ¿Dónde lo quieres aplicar?" },
      footer: { text: "Toca el botón para elegir" },
      action: {
        button: "Ver opciones",
        sections: [
          {
            title: "Lugar de aplicación",
            rows: [
              ...Object.entries(LUGARES_ARQ).map(([id, title]) => ({ id, title })),
              { id: ID_ARQ_LUGAR_OTRO, title: "Otro" },
            ],
          },
        ],
      },
    },
  });

const MSG_MEDIDAS = `📐 Ahora indícame las medidas aproximadas del vidrio.

Ejemplos:
📏 2 m x 1.50 m
📏 3 m x 2 m

Si son varias ventanas puedes escribirlas todas.`;

// Ya tenemos la ciudad: preguntamos el lugar
async function arqPedirLugar(from) {
  setSession(from, { estado: "arq_lugar" });
  return sendLugarArqList(from);
}

// Ya tenemos el lugar: pedimos las medidas
async function arqPedirMedidas(from) {
  setSession(from, { estado: "arq_medidas" });
  return sendText(from, MSG_MEDIDAS);
}

// El cliente envio las medidas: pasa a asesor
async function arqFinalizar(from, medidas) {
  setSession(from, { medidas: medidas.slice(0, 500) });
  const s = getSession(from);
  console.log(
    `ARQUITECTONICO: cliente ${from} | ciudad: ${s.ciudad || "-"} | lugar: ${s.lugar || "-"} | medidas: ${s.medidas}`
  );
  return pasarAAsesor(from, "Arquitectonico: solicitud completa");
}

/* ------------------------------------------------------------------ */
/*  Detailing (servicio 5): servicios y pregunta de agendamiento       */
/* ------------------------------------------------------------------ */

const TEXTO_DETAILING = `✨ ¡Dale a tu vehículo el cuidado premium que realmente merece! 🚗✨

Nuestro Detailing Profesional va mucho más allá de un lavado común. Es un proceso completo diseñado para restaurar, proteger y resaltar cada detalle de tu vehículo:

🔹 *Descontaminación y tratamiento de pintura*
Eliminamos impurezas profundas y devolvemos el brillo original, dejando la superficie suave, protegida y como nueva.

🔹 *Limpieza profunda de tapicería, techos y carteras*
Removemos manchas, suciedad y olores, devolviendo frescura y elegancia al interior.

🔹 *Lavado de motor y chasis*
Limpieza técnica que mejora la apariencia y ayuda al buen funcionamiento de tu vehículo.

🔹 *Lavado general detallado*
Cada rincón se limpia con precisión, sin dejar espacios olvidados.

🔹 *Hidratación de partes negras*
Recuperamos el color y la vida de plásticos y molduras, logrando un acabado renovado.

💎 No es solo limpieza… es transformación.
Tu carro no solo se verá mejor, se sentirá como nuevo.`;

// Opciones de agendamiento (titulo de fila: maximo 24 caracteres). Edita a tu gusto.
const AGENDA_DETAILING = {
  agenda_hoy: "Hoy",
  agenda_manana: "Mañana",
  agenda_semana: "Esta semana",
  agenda_otra: "Otra fecha",
};

const sendAgendaDetailingList = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "📅 ¿Cuándo quieres agendar? 👩‍💻" },
      footer: { text: "Toca el botón para elegir" },
      action: {
        button: "Ver opciones",
        sections: [
          {
            title: "Agendamiento",
            rows: Object.entries(AGENDA_DETAILING).map(([id, title]) => ({ id, title })),
          },
        ],
      },
    },
  });

// El cliente eligio cuando agendar: pasa a asesor
async function responderAgendaDetailing(from, id) {
  const cuando = AGENDA_DETAILING[id];
  if (!cuando) return sendMainMenu(from);
  setSession(from, { agenda: cuando });
  return pasarAAsesor(from, `Detailing: quiere agendar ${cuando}`);
}

/* ------------------------------------------------------------------ */
/*  Marcas y modelos (edita aqui para agregar o quitar)                */
/*  Cada lista admite maximo 10 filas, titulo de hasta 24 caracteres.  */
/* ------------------------------------------------------------------ */

const MARCAS = [
  { id: "tesla", nombre: "Tesla", modelos: ["Tesla Model 3", "Tesla Model Y"] },
  { id: "deepal", nombre: "Deepal", modelos: ["Deepal S07", "Deepal S05"] },
  { id: "geely", nombre: "Geely", modelos: [] },
  { id: "byd", nombre: "Byd", modelos: ["Byd Yuan Plus", "Byd Yuan UP"] },
  { id: "mazda", nombre: "Mazda", modelos: ["Mazda CX5", "Mazda CX30", "Mazda 3"] },
  { id: "ford", nombre: "Ford", modelos: ["Ford Territory"] },
];

const ID_OTRA_MARCA = "marca_otra";

const sendBrandList = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "🚘 ¿De qué marca es tu vehículo?" },
      footer: { text: "Toca el botón para elegir" },
      action: {
        button: "Ver marcas",
        sections: [
          {
            title: "Marcas",
            rows: [
              ...MARCAS.map((m) => ({ id: `marca_${m.id}`, title: m.nombre })),
              { id: ID_OTRA_MARCA, title: "Otra marca" },
            ],
          },
        ],
      },
    },
  });

const sendModelList = (to, marca) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: `🚗 ¿Qué modelo ${marca.nombre} tienes?` },
      footer: { text: "Toca el botón para elegir" },
      action: {
        button: "Ver modelos",
        sections: [
          {
            title: `Modelos ${marca.nombre}`,
            rows: [
              ...marca.modelos.map((nombre, i) => ({ id: `modelo_${marca.id}_${i}`, title: nombre })),
              { id: `modelo_${marca.id}_otro`, title: "Otro modelo" },
            ],
          },
        ],
      },
    },
  });

/* ------------------------------------------------------------------ */
/*  Estado de cada conversacion (en memoria)                           */
/*  Se pierde si Railway reinicia el servicio; no pasa nada grave,     */
/*  el cliente simplemente vuelve a empezar desde el menu.             */
/* ------------------------------------------------------------------ */

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas
const sessions = new Map();

function getSession(from) {
  const s = sessions.get(from);
  if (!s) return null;
  if (Date.now() - s.t > SESSION_TTL_MS) {
    sessions.delete(from);
    return null;
  }
  return s;
}

function setSession(from, data) {
  const s = { ...(sessions.get(from) || {}), ...data, t: Date.now() };
  sessions.set(from, s);
  return s;
}

// Limpieza periodica para que el mapa no crezca sin limite
setInterval(() => {
  const ahora = Date.now();
  for (const [k, s] of sessions) if (ahora - s.t > SESSION_TTL_MS) sessions.delete(k);
}, 60 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/*  Logica del bot                                                     */
/* ------------------------------------------------------------------ */

async function responderServicio(from, id) {
  await sendText(from, descripciones[id]);

  if (id === "servicio_4") {
    setSession(from, { servicio: id, estado: "arq_ciudad", marca: null, modelo: null, ciudad: null, lugar: null, medidas: null });
    return sendCiudadArqList(from);
  }

  if (SERVICIOS_CON_VEHICULO.has(id)) {
    setSession(from, { servicio: id, estado: "marca", marca: null, modelo: null });
    return sendBrandList(from);
  }

  setSession(from, { servicio: id, estado: "listo", marca: null, modelo: null });
  return sendFollowUp(from);
}

/* ------------------------------------------------------------------ */
/*  PPF (servicio 2): que desea proteger                               */
/* ------------------------------------------------------------------ */

const PPF_TOTAL_TEXTO = `🛡️ *Full PPF – Protección Total*

Este servicio protege completamente tu vehículo:
🚗 Pintura
🖤 Piano Black
💡 Partes Acrílicas

✅ Película PPF Premium
✅ Corte de precisión en plotter
✅ Garantía de 10 años
✅ Instalación profesional`;

// Opciones del menu (titulo de fila: maximo 24 caracteres)
const PPF_OPCIONES = {
  ppf_total: "Protección Total",
  ppf_pintura: "Pintura Completa",
  ppf_piano: "Piano Black",
  ppf_acrilicas: "Partes Acrílicas",
};

// Si el cliente escribe el numero en vez de tocar la lista
const PPF_POR_NUMERO = { 1: "ppf_total", 2: "ppf_pintura", 3: "ppf_piano", 4: "ppf_acrilicas" };

const sendPPFMenu = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "Ahora indícame qué deseas proteger:" },
      footer: { text: "Toca el botón para elegir" },
      action: {
        button: "Ver opciones",
        sections: [
          {
            title: "PPF",
            rows: Object.entries(PPF_OPCIONES).map(([id, title]) => ({ id, title })),
          },
        ],
      },
    },
  });

// Precios de Piano Black por modelo. Para agregar un modelo, copia un bloque y cambia la llave
// (la llave se compara sin mayusculas, tildes, espacios ni guiones).
const PIANO_BLACK = {
  "mazda cx-30": {
    nombre: "Mazda CX-30",
    precio: "$900.000 COP",
    piezas: 17,
    detallePiezas: `
1. Triángulos puertas delanteras — 2
2. Parales de las puertas — 4
3. LS de las puertas — 2
4. LS del spoiler — 2
5. Spoiler — 1
6. Pantalla — 1
7. Consola central — 1
8. Módulos elevavidrios — 4
    `,
    imagen: "https://res.cloudinary.com/ryidlaom/image/upload/v1792783553/cx30.jpg",
  },

  "mazda cx-5": {
    nombre: "Mazda CX-5",
    precio: "$800.000 COP",
    piezas: 14,
    detallePiezas: `
1. Triángulos puertas delanteras — 2
2. Parales de las puertas — 6
3. Pantalla — 1
4. Consola central — 1
5. Módulos elevavidrios — 4
    `,
    imagen: "https://res.cloudinary.com/ryidlaom/image/upload/v1792783553/mazdacx5.jpg",
  },

  "mazda 3": {
    nombre: "Mazda 3",
    precio: "$400.000 COP",
    piezas: 10,
    detallePiezas: `
1. Triángulos puertas delanteras — 2
2. Parales de las puertas — 2
3. Pantalla — 1
4. Consola central — 1
5. Módulos elevavidrios — 4
    `,
    imagen: "https://res.cloudinary.com/ryidlaom/image/upload/v1792783553/mazda3.jpg",
  },

  "tesla model 3": {
    nombre: "Tesla Model 3",
    precio: "$850.000 COP",
    piezas: null,
    detallePiezas: `
1. Farolas
2. Triángulos de espejos
3. Espejos
4. Parales laterales
5. Tapa del cargador
6. Pantallas — 2
    `,
    imagen: "https://res.cloudinary.com/ryidlaom/image/upload/v1792783556/teslamodel3.jpg",
  },

  "tesla model y": {
    nombre: "Tesla Model Y",
    precio: "$850.000 COP",
    piezas: null,
    detallePiezas: `
1. Farolas
2. Triángulos de espejos
3. Espejos
4. Parales laterales
5. Tapa del cargador
6. Pantallas — 2
    `,
    imagen: "https://res.cloudinary.com/ryidlaom/image/upload/v1792783556/teslamodely.jpg",
  },

  "ford territory": {
    nombre: "Ford Territory",
    precio: "$1.100.000 COP",
    piezas: 16,
    detallePiezas: `
1. Piano black inferior farolas — 2
2. Espejos — 2
3. Parales de las puertas — 8
4. LS del tapabaúl — 2
5. Pantalla — 1
6. Consola central — 1
    `,
    imagen: "https://res.cloudinary.com/ryidlaom/image/upload/v1792783553/fordterritory.jpg",
  },

  "deepal s05": {
    nombre: "Deepal S05",
    precio: "$800.000 COP",
    piezas: 9,
    detallePiezas: `
1. Triángulo puertas delanteras — 2
2. Espejos — 2
3. Parales de las puertas — 2
4. LS del spoiler — 2
5. Pantalla — 1
    `,
    imagen: "https://res.cloudinary.com/ryidlaom/image/upload/v1792783553/s05.jpg",
  },

  "deepal s07": {
    nombre: "Deepal S07",
    precio: "$1.000.000 COP",
    piezas: 11,
    detallePiezas: `
1. Triángulo puertas delanteras — 2
2. Espejos — 2
3. Parales de las puertas — 2
4. Ventana lateral trasera — 2
5. LS del spoiler — 2
6. Pantalla — 1
    `,
    imagen: "https://res.cloudinary.com/ryidlaom/image/upload/v1792783554/s07.jpg",
  },

  "byd yuan up": {
    nombre: "BYD Yuan UP",
    precio: "$900.000 COP",
    piezas: 14,
    detallePiezas: `
1. Parales panorámico — 2
2. Espejos — 2
3. Parales de las puertas — 4
4. LS de las puertas — 2
5. LS del spoiler — 2
6. Pantallas — 2
    `,
    imagen: "https://res.cloudinary.com/ryidlaom/image/upload/v1792783557/yuanup.jpg",
  },

  "byd yuan plus": {
    nombre: "BYD Yuan Plus",
    precio: "$1.300.000 COP",
    piezas: 23,
    detallePiezas: `
1. Triángulos de los espejos — 2
2. Espejos — 2
3. Parales de las puertas — 4
4. LS de las puertas — 2
5. LS spoiler — 2
6. Pantallas — 2
7. Consola central — 1
8. Módulos elevavidrios — 4
9. Parales internos en piano black de puertas — 4
    `,
    imagen: "https://res.cloudinary.com/ryidlaom/image/upload/v1792783556/yuanplus.jpg",
  },
};

// Minusculas, sin tildes, espacios ni signos: "Mazda CX-30" y "mazda cx30" quedan iguales
const normalizar = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

const PIANO_BLACK_INDEX = new Map(
  Object.entries(PIANO_BLACK).map(([llave, datos]) => [normalizar(llave), datos])
);

// Pasa la conversacion a un asesor y deja el aviso en los logs
async function pasarAAsesor(from, motivo) {
  const s = getSession(from) || {};
  console.log(
    `ASESOR: cliente ${from} | ${motivo} | servicio: ${NOMBRE_SERVICIO[s.servicio] || "-"} | vehiculo: ${s.vehiculo || "-"}`
  );
  setSession(from, { estado: "listo" });
  await sendText(
    from,
    "👤 Perfecto, un asesor te escribirá en breve para ayudarte. Si tienes alguna pregunta, escríbela aquí. 😊"
  );
  return sendVolverMenu(from);
}

// El cliente eligio una opcion del menu PPF
async function responderPPF(from, id) {
  const s = getSession(from) || {};

  if (id === "ppf_total") {
    setSession(from, { estado: "listo" });
    await sendText(from, PPF_TOTAL_TEXTO);
    return sendFollowUp(from);
  }

  if (id === "ppf_pintura") return pasarAAsesor(from, "PPF: Pintura Completa");
  if (id === "ppf_acrilicas") return pasarAAsesor(from, "PPF: Partes Acrilicas");

  if (id === "ppf_piano") {
    const datos = PIANO_BLACK_INDEX.get(normalizar(s.vehiculo));
    // Modelo que no esta en la lista de precios: lo atiende un asesor
    if (!datos) return pasarAAsesor(from, `PPF: Piano Black (modelo sin precio: ${s.vehiculo || "-"})`);

    setSession(from, { estado: "listo" });
    console.log(`PIANO BLACK: cliente ${from} | ${datos.nombre} | ${datos.precio}`);

    const detalle =
      `🖤 *Piano Black – ${datos.nombre}*\n\n` +
      `💰 Precio: *${datos.precio}*\n` +
      (datos.piezas ? `🔧 Piezas: ${datos.piezas}\n` : "") +
      `\nDetalle de piezas:\n${datos.detallePiezas.trim()}`;

    // Imagen con el detalle como texto; si la imagen falla, enviamos el detalle igual
    const enviada = await sendImage(from, datos.imagen, detalle);
    if (!enviada) await sendText(from, detalle);
    return sendFollowUp(from);
  }

  return sendMainMenu(from);
}

// Cuando ya tenemos marca y modelo (o el cliente escribio otro modelo): cerramos el flujo
async function finalizarVehiculo(from) {
  const s = getSession(from);
  if (!s) return sendMainMenu(from);

  // Evita repetir la marca ("Byd Yuan UP" en vez de "Byd · Byd Yuan UP")
  const modeloYaTraeMarca = s.marca && s.modelo && s.modelo.toLowerCase().startsWith(s.marca.toLowerCase());
  const vehiculo = (modeloYaTraeMarca ? s.modelo : [s.marca, s.modelo].filter(Boolean).join(" ")) || "No indicado";
  console.log(`Solicitud: cliente ${from} | servicio: ${NOMBRE_SERVICIO[s.servicio]} | vehiculo: ${vehiculo}`);

  // Desde aqui el asesor toma la conversacion: cualquier mensaje del cliente se registra y el bot no responde
  setSession(from, { estado: "listo", vehiculo });

  // Polarizado vehicular: confirmamos y mostramos planes y videos, luego pasa a asesor
  if (s.servicio === "servicio_1") {
    await sendText(from, `✅ ¡Perfecto! Anoté tu vehículo: *${vehiculo}*.`);
    return enviarPlanesPolarizado(from, vehiculo);
  }

  // Detailing: mostramos los servicios y preguntamos cuando quiere agendar
  if (s.servicio === "servicio_5") {
    setSession(from, { estado: "detailing" });
    await sendText(from, `✅ ¡Perfecto! Anoté tu vehículo: *${vehiculo}*.`);
    await sendText(from, TEXTO_DETAILING);
    return sendAgendaDetailingList(from);
  }

  // Antiatraco: mostramos las peliculas y preguntamos cual le gusto
  if (s.servicio === "servicio_3") {
    setSession(from, { estado: "antiatraco" });
    await sendText(from, `✅ ¡Perfecto! Anoté tu vehículo: *${vehiculo}*.`);
    return enviarPeliculasAntiatraco(from, vehiculo);
  }

  // PPF: preguntamos que desea proteger
  if (s.servicio === "servicio_2") {
    setSession(from, { estado: "ppf" });
    await sendText(from, `✅ ¡Perfecto! Anoté tu vehículo: *${vehiculo}*.`);
    return sendPPFMenu(from);
  }

  await sendText(
    from,
    `✅ ¡Perfecto! Esto es lo que anoté:\n\n• Servicio: ${NOMBRE_SERVICIO[s.servicio]}\n• Vehículo: ${vehiculo}\n\nSi tienes alguna pregunta específica, escríbela aquí y un asesor te responderá. 😊`
  );
  return sendFollowUp(from);
}

async function handleInteractive(from, id) {
  if (servicios_ids.has(id)) return responderServicio(from, id);
  if (id === ID_VIDEO_ANTIATRACO) return responderVideoAntiatraco(from);
  if (id === ID_ANTIATRACO_OTRO) {
    setSession(from, { pelicula: null, estado: "antiatraco" });
    return sendAntiatracoList(from);
  }
  if (id === ID_ANTIATRACO_ASESOR) return antiatracoAAsesor(from);
  if (id?.startsWith("video_")) return responderVideo(from, id);
  if (id?.startsWith("plan_")) return responderPlan(from, id);
  if (id?.startsWith("film_")) return responderPelicula(from, id);
  if (id?.startsWith("agenda_")) return responderAgendaDetailing(from, id);

  // Arquitectonico: ciudad y lugar
  if (id === ID_ARQ_CIUDAD_OTRA) {
    setSession(from, { estado: "arq_ciudad_texto" });
    return sendText(from, "✍️ Escríbeme tu ciudad, por favor.");
  }
  if (CIUDADES_ARQ[id]) {
    setSession(from, { ciudad: CIUDADES_ARQ[id] });
    return arqPedirLugar(from);
  }
  if (id === ID_ARQ_LUGAR_OTRO) {
    setSession(from, { estado: "arq_lugar_texto" });
    return sendText(from, "✍️ Escríbeme dónde lo quieres aplicar, por favor.");
  }
  if (LUGARES_ARQ[id]) {
    setSession(from, { lugar: LUGARES_ARQ[id] });
    return arqPedirMedidas(from);
  }
  if (id?.startsWith("ppf_")) return responderPPF(from, id);
  if (id === "asesor") return sendText(from, MSG_ASESOR);

  // Eligio una marca
  if (id === ID_OTRA_MARCA) {
    setSession(from, { estado: "texto_vehiculo", marca: null, modelo: null });
    return sendText(from, "✍️ Escríbeme la marca y el modelo de tu vehículo, por favor.");
  }
  if (id?.startsWith("marca_")) {
    const marca = MARCAS.find((m) => `marca_${m.id}` === id);
    if (marca) {
      setSession(from, { marca: marca.nombre, modelo: null });
      if (marca.modelos.length === 0) {
        setSession(from, { estado: "texto_modelo" });
        return sendText(from, `✍️ Escríbeme el modelo de tu ${marca.nombre}, por favor.`);
      }
      setSession(from, { estado: "modelo" });
      return sendModelList(from, marca);
    }
  }

  // Eligio un modelo
  if (id?.startsWith("modelo_")) {
    const [, marcaId, indice] = id.split("_");
    const marca = MARCAS.find((m) => m.id === marcaId);
    if (marca) {
      if (indice === "otro") {
        setSession(from, { marca: marca.nombre, estado: "texto_modelo" });
        return sendText(from, `✍️ Escríbeme el modelo de tu ${marca.nombre}, por favor.`);
      }
      const modelo = marca.modelos[Number(indice)];
      if (modelo) {
        setSession(from, { marca: marca.nombre, modelo });
        return finalizarVehiculo(from);
      }
    }
  }

  // "volver" u otro: reiniciamos
  sessions.delete(from);
  return sendMainMenu(from);
}

const servicios_ids = new Set(Object.keys(descripciones));
const SALUDOS = /^(hola|buenas|buenos dias|buenos días|buenas tardes|buenas noches|menu|menú|inicio)$/i;

async function handleText(from, texto) {
  // Un saludo o "menu" siempre reinicia
  if (SALUDOS.test(texto)) {
    sessions.delete(from);
    return sendMainMenu(from);
  }

  const s = getSession(from);

  // Viendo el menu PPF: un numero del 1 al 4 elige la opcion; cualquier otro texto pasa a un asesor
  if (s?.estado === "ppf") {
    if (/^[1-4]$/.test(texto)) return responderPPF(from, PPF_POR_NUMERO[texto]);
    return pasarAAsesor(from, `escribio en el menu PPF: ${texto.slice(0, 200)}`);
  }

  // Arquitectonico: el texto sirve como respuesta libre en cada paso
  if (s?.estado === "arq_ciudad" || s?.estado === "arq_ciudad_texto") {
    setSession(from, { ciudad: texto.slice(0, 80) });
    return arqPedirLugar(from);
  }
  if (s?.estado === "arq_lugar" || s?.estado === "arq_lugar_texto") {
    setSession(from, { lugar: texto.slice(0, 80) });
    return arqPedirMedidas(from);
  }
  if (s?.estado === "arq_medidas") return arqFinalizar(from, texto);

  // Detailing: cualquier texto en vez de elegir de la lista pasa a un asesor
  if (s?.estado === "detailing") {
    return pasarAAsesor(from, `escribio en detailing: ${texto.slice(0, 200)}`);
  }

  // Viendo las peliculas antiatraco: cualquier texto pasa a un asesor
  if (s?.estado === "antiatraco") {
    return pasarAAsesor(from, `escribio en peliculas antiatraco (${s.pelicula || "sin plan"}): ${texto.slice(0, 200)}`);
  }

  // Esperando que escriba el vehiculo completo (eligio "Otra marca")
  if (s?.estado === "texto_vehiculo") {
    setSession(from, { marca: texto.slice(0, 80), modelo: null });
    return finalizarVehiculo(from);
  }

  // Esperando que escriba el modelo (eligio "Otro modelo" o una marca sin lista)
  if (s?.estado === "texto_modelo") {
    setSession(from, { modelo: texto.slice(0, 80) });
    return finalizarVehiculo(from);
  }

  // Estaba viendo una lista y escribio texto en vez de tocar: lo tomamos como el dato libre
  if (s?.estado === "marca") {
    setSession(from, { marca: texto.slice(0, 80), modelo: null });
    return finalizarVehiculo(from);
  }
  if (s?.estado === "modelo") {
    setSession(from, { modelo: texto.slice(0, 80) });
    return finalizarVehiculo(from);
  }

  // Ya termino el flujo: el mensaje es una pregunta para el asesor, no reenviamos el menu
  if (s?.estado === "listo") {
    console.log(`Mensaje de ${from} para el asesor: ${texto.slice(0, 200)}`);
    return;
  }

  // Sin conversacion activa: numero del 1 al 5 = opcion del menu; otro texto = menu
  if (/^[1-5]$/.test(texto)) return responderServicio(from, `servicio_${texto}`);
  return sendMainMenu(from);
}

async function handleIncoming(message) {
  const from = message.from;

  if (message.type === "interactive") {
    const reply = message.interactive.button_reply || message.interactive.list_reply;
    return handleInteractive(from, reply?.id);
  }

  if (message.type === "text") {
    return handleText(from, (message.text?.body || "").trim());
  }

  // Imagenes, audios, etc.
  const s = getSession(from);
  if (s?.estado === "listo") {
    console.log(`Archivo (${message.type}) de ${from} para el asesor`);
    return;
  }
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

    const phoneId = value?.metadata?.phone_number_id;
    for (const message of messages) {
      console.log("Mensaje recibido de", message.from, "tipo:", message.type);
      contexto.run({ phoneId }, () =>
        handleIncoming(message).catch((e) => console.error("Error manejando mensaje:", e))
      );
    }
  } catch (e) {
    console.error("Error procesando webhook:", e);
  }
});

/* ------------------------------------------------------------------ */
/*  Paginas legales que pide Meta para publicar la app                 */
/*  /privacidad  /terminos  /eliminar-datos                            */
/* ------------------------------------------------------------------ */

const NEGOCIO = process.env.NEGOCIO_NOMBRE || "Alfa Polarizados";
const CONTACTO = process.env.CONTACTO_EMAIL || "alfapolarizados@gmail.com";
const FECHA_LEGAL = "29 de octubre de 2026";

const paginaLegal = (titulo, cuerpo) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo} - ${NEGOCIO}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px 18px 60px;line-height:1.6;color:#222}
h1{font-size:26px}h2{font-size:18px;margin-top:28px}small{color:#666}a{color:#0a66c2}</style></head>
<body><h1>${titulo}</h1><small>${NEGOCIO} · Última actualización: ${FECHA_LEGAL}</small>${cuerpo}</body></html>`;

app.get("/privacidad", (_req, res) =>
  res.type("html").send(
    paginaLegal(
      "Política de privacidad",
      `<p>${NEGOCIO} (“nosotros”) atiende consultas de clientes por WhatsApp mediante un asistente automático. Esta política explica qué datos tratamos y cómo, conforme a la Ley 1581 de 2012 de Colombia y sus normas reglamentarias.</p>
<h2>1. Datos que recogemos</h2>
<p>Cuando nos escribes por WhatsApp tratamos: tu número de teléfono, el nombre de tu perfil de WhatsApp, el contenido de tus mensajes y la información que nos das para cotizar (por ejemplo marca y modelo del vehículo, ciudad, tipo de lugar y medidas de vidrios).</p>
<h2>2. Para qué los usamos</h2>
<p>Usamos estos datos únicamente para responder tus consultas, preparar cotizaciones, agendar servicios y hacer seguimiento de tu solicitud por parte de un asesor. No los usamos para fines distintos ni los vendemos a terceros.</p>
<h2>3. Con quién los compartimos</h2>
<p>Los mensajes se transmiten a través de la plataforma WhatsApp Business de Meta Platforms, que actúa como proveedor del servicio de mensajería y se rige por sus propias políticas. También pueden acceder a ellos los asesores de ${NEGOCIO} que atienden tu caso y los proveedores de infraestructura que alojan nuestro sistema. No compartimos tus datos con terceros para publicidad.</p>
<h2>4. Conservación</h2>
<p>Conservamos tus datos el tiempo necesario para atender tu solicitud y cumplir obligaciones legales. Después los eliminamos o anonimizamos.</p>
<h2>5. Tus derechos</h2>
<p>Puedes conocer, actualizar, rectificar y solicitar la supresión de tus datos, o revocar tu autorización, escribiendo a <a href="mailto:${CONTACTO}">${CONTACTO}</a>. Para eliminar tus datos consulta <a href="/eliminar-datos">las instrucciones de eliminación</a>.</p>
<h2>6. Seguridad</h2>
<p>Aplicamos medidas razonables para proteger tu información contra acceso no autorizado, pérdida o alteración.</p>
<h2>7. Contacto</h2>
<p>Responsable del tratamiento: ${NEGOCIO}. Correo: <a href="mailto:${CONTACTO}">${CONTACTO}</a>.</p>`
    )
  )
);

app.get("/terminos", (_req, res) =>
  res.type("html").send(
    paginaLegal(
      "Condiciones del servicio",
      `<p>Al escribir al WhatsApp de ${NEGOCIO} aceptas estas condiciones.</p>
<h2>1. Servicio</h2>
<p>El asistente automático ofrece información sobre nuestros servicios (polarizado, películas de seguridad, protección de pintura, detailing y otros) y recoge los datos necesarios para que un asesor te contacte. La información mostrada es de referencia.</p>
<h2>2. Cotizaciones y precios</h2>
<p>Los precios y condiciones finales los confirma un asesor. Una conversación con el asistente no constituye una oferta vinculante ni una reserva.</p>
<h2>3. Uso adecuado</h2>
<p>Te pedimos usar el canal de forma respetuosa y no enviar contenido ilegal, ofensivo o engañoso.</p>
<h2>4. Datos personales</h2>
<p>El tratamiento de tus datos se describe en nuestra <a href="/privacidad">política de privacidad</a>.</p>
<h2>5. Cambios</h2>
<p>Podemos actualizar estas condiciones. La versión vigente estará siempre en esta página.</p>
<h2>6. Contacto</h2>
<p><a href="mailto:${CONTACTO}">${CONTACTO}</a></p>`
    )
  )
);

app.get("/eliminar-datos", (_req, res) =>
  res.type("html").send(
    paginaLegal(
      "Eliminación de datos de usuario",
      `<p>Si quieres que eliminemos los datos que conservamos de tus conversaciones con ${NEGOCIO}, sigue estos pasos:</p>
<ol>
<li>Envía un correo a <a href="mailto:${CONTACTO}?subject=Eliminar%20mis%20datos">${CONTACTO}</a> con el asunto “Eliminar mis datos”.</li>
<li>Indica el número de WhatsApp desde el que nos escribiste.</li>
<li>Eliminaremos tus datos de nuestros registros en un plazo máximo de 15 días hábiles y te confirmaremos por el mismo medio.</li>
</ol>
<p>También puedes escribirnos por WhatsApp pidiendo la eliminación de tus datos. Los mensajes que permanezcan en tu propia aplicación de WhatsApp debes borrarlos tú desde tu dispositivo.</p>
<p>Más información en nuestra <a href="/privacidad">política de privacidad</a>.</p>`
    )
  )
);

/* ------------------------------------------------------------------ */
/*  Conectar WhatsApp por QR (Embedded Signup v4 + coexistencia)       */
/*  Abrir:  https://TU-DOMINIO/conectar?key=TU_ADMIN_KEY               */
/* ------------------------------------------------------------------ */

function adminOk(req) {
  const clave = req.query.key || req.get("x-admin-key");
  if (!ADMIN_KEY || !clave) return false;
  const a = Buffer.from(String(clave));
  const b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get("/conectar", (req, res) => {
  if (!adminOk(req)) return res.status(401).send("No autorizado. Abre /conectar?key=TU_ADMIN_KEY");
  if (!FB_APP_ID || !ES_CONFIG_ID) {
    return res.status(500).send("Faltan las variables FB_APP_ID y ES_CONFIG_ID en Railway.");
  }
  const cfg = JSON.stringify({ appId: FB_APP_ID, configId: ES_CONFIG_ID, version: GRAPH_VERSION, key: String(req.query.key) });
  res.type("html").send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar WhatsApp</title>
<style>
 body{font-family:system-ui,sans-serif;background:#f4f6f8;margin:0;display:grid;place-items:center;min-height:100vh}
 .card{background:#fff;max-width:460px;padding:32px;border-radius:16px;box-shadow:0 4px 24px #0001;text-align:center}
 button{background:#25d366;color:#fff;border:0;border-radius:10px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer}
 button:disabled{opacity:.5;cursor:default} #estado{margin-top:20px;font-size:15px;white-space:pre-line}
 .ok{color:#128c3e}.error{color:#c0392b} ol{text-align:left;font-size:14px;color:#555}
</style></head><body><div class="card">
<h2>Conectar WhatsApp al bot</h2>
<ol><li>Ten abierta la app <b>WhatsApp Business</b> en tu celular.</li>
<li>Pulsa el botón y sigue los pasos de Meta.</li>
<li>Escanea el QR desde WhatsApp Business y mantén la app abierta.</li></ol>
<button id="btn" onclick="conectar()">Conectar WhatsApp</button>
<div id="estado"></div></div>
<script>
const CFG=${cfg.replace(/</g,"\\u003c")};
let code=null,waba=null,enviado=false,evento=null;
const est=(t,c)=>{const e=document.getElementById("estado");e.textContent=t;e.className=c||""};
window.fbAsyncInit=function(){FB.init({appId:CFG.appId,autoLogAppEvents:true,xfbml:true,version:CFG.version})};
(function(d,s,id){if(d.getElementById(id))return;var j=d.createElement(s);j.id=id;j.src="https://connect.facebook.net/es_LA/sdk.js";d.head.appendChild(j)})(document,"script","facebook-jssdk");

window.addEventListener("message",(ev)=>{
  if(!ev.origin||!ev.origin.endsWith("facebook.com"))return;
  try{const d=JSON.parse(ev.data);
    if(d.type==="WA_EMBEDDED_SIGNUP"){
      evento={event:d.event,data:d.data||null};
      if(d.data&&d.data.waba_id)waba=d.data.waba_id;
      if(d.event==="CANCEL")est("Cancelaste el proceso.","error");
      enviarSiListo();
    }}catch(e){}
});

function conectar(){
  if(typeof FB==="undefined"){est("El SDK de Facebook aún no carga. Espera un momento.","error");return}
  code=null;waba=null;enviado=false;evento=null;
  est("Abriendo Meta...");
  FB.login(function(r){
    if(r.authResponse&&r.authResponse.code){code=r.authResponse.code;est("Finalizando conexión...");enviarSiListo()}
    else est("No se completó el inicio de sesión.","error");
  },{config_id:CFG.configId,response_type:"code",override_default_response_type:true,extras:{}});
}

async function enviarSiListo(){
  if(enviado||!code)return;
  if(!waba)await new Promise(r=>setTimeout(r,2500));
  enviado=true;
  try{
    const r=await fetch("/conectar/finalizar",{method:"POST",headers:{"Content-Type":"application/json","x-admin-key":CFG.key},body:JSON.stringify({code,waba_id:waba,evento})});
    const j=await r.json();
    est(j.mensaje,j.ok?"ok":"error");
  }catch(e){est("Error de red: "+e.message,"error")}
}
</script></body></html>`);
});

app.post("/conectar/finalizar", async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ ok: false, mensaje: "No autorizado." });
  const { code, waba_id: wabaRecibido, evento } = req.body || {};
  if (!code) return res.status(400).json({ ok: false, mensaje: "Falta el código del registro." });
  console.log(`CONECTAR: evento de Meta: ${JSON.stringify(evento || null)} | waba_id recibido: ${wabaRecibido || "no"}`);
  if (!FB_APP_ID || !APP_SECRET) {
    return res.status(500).json({ ok: false, mensaje: "Faltan FB_APP_ID o APP_SECRET en Railway." });
  }

  try {
    const g = (path) => `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;

    // 1) Cambiar el codigo por un token de la cuenta recien conectada
    const canjear = async (extra) => {
      const r = await fetch(
        g(`oauth/access_token?client_id=${encodeURIComponent(FB_APP_ID.trim())}&client_secret=${encodeURIComponent(APP_SECRET.trim())}&code=${encodeURIComponent(code)}${extra}`)
      );
      return r.json();
    };
    // Un codigo se puede canjear una sola vez; el segundo intento solo se hace si el primero
    // fallo por la URL de redireccionamiento (codigos obtenidos con el SDK de JavaScript).
    let tok = await canjear("");
    const errMsg = (t) => `${t?.error?.message || ""}`;
    if (!tok.access_token && (tok?.error?.error_subcode === 36008 || /redirect_uri/i.test(errMsg(tok)))) {
      console.log("CONECTAR: reintentando el canje con redirect_uri vacio");
      tok = await canjear("&redirect_uri=");
    }
    if (!tok.access_token) {
      console.error("CONECTAR: fallo el canje del codigo:", JSON.stringify(tok));
      const e = tok?.error || {};
      return res.json({
        ok: false,
        mensaje: `Meta rechazó el código.\nMotivo: ${e.message || "desconocido"}\n(código ${e.code ?? "?"}${e.error_subcode ? " / subcódigo " + e.error_subcode : ""})`,
      });
    }
    const auth = { Authorization: `Bearer ${tok.access_token}` };

    // 2) Cuentas de WhatsApp (WABA) que se acaban de compartir con tu app.
    //    Si la pagina no recibio el aviso de Meta, las buscamos con debug_token.
    let wabaIds = wabaRecibido ? [String(wabaRecibido)] : [];
    if (!wabaIds.length) {
      const dbgRes = await fetch(
        g(`debug_token?input_token=${encodeURIComponent(tok.access_token)}&access_token=${encodeURIComponent(FB_APP_ID + "|" + APP_SECRET)}`)
      );
      const dbg = await dbgRes.json();
      const scopes = dbg?.data?.granular_scopes || [];
      const ws = scopes.find((x) => x.scope === "whatsapp_business_management") ||
        scopes.find((x) => x.scope === "whatsapp_business_messaging");
      wabaIds = (ws?.target_ids || []).map(String);
      console.log(`CONECTAR: WABA encontradas con debug_token: ${JSON.stringify(wabaIds)}`);
      if (!wabaIds.length) console.error("CONECTAR: debug_token sin WABA:", JSON.stringify(dbg));
    }
    if (!wabaIds.length) {
      return res.json({
        ok: false,
        mensaje: "Meta no compartió ninguna cuenta de WhatsApp con la app. Repite el proceso y revisa que aceptas todos los permisos.",
      });
    }

    // 3) Suscribir tu app a cada cuenta para que lleguen los mensajes al webhook
    const lineas = [];
    let todoOk = true;
    for (const wabaId of wabaIds) {
      const subRes = await fetch(g(`${encodeURIComponent(wabaId)}/subscribed_apps`), { method: "POST", headers: auth });
      const sub = await subRes.json();
      if (!subRes.ok) {
        todoOk = false;
        console.error(`CONECTAR: fallo subscribed_apps (${wabaId}):`, JSON.stringify(sub));
        lineas.push(`❌ No se pudo suscribir la cuenta ${wabaId}. Revisa los logs de Railway.`);
        continue;
      }
      const numRes = await fetch(g(`${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`), { headers: auth });
      const num = await numRes.json();
      const nums = num?.data || [];
      console.log(`CONECTAR OK: waba ${wabaId} | numeros: ${JSON.stringify(nums)}`);
      if (!nums.length) lineas.push(`Cuenta ${wabaId}: conectada (sin números visibles aún, la sincronización puede tardar).`);
      for (const n of nums) lineas.push(`Número: ${n.display_phone_number} | ID: ${n.id}`);
    }

    return res.json({
      ok: todoOk,
      mensaje: `${todoOk ? "✅ ¡Conectado!" : "⚠️ Conexión incompleta"}\n${lineas.join("\n")}\n\nEscríbele "hola" a ese número desde otro celular para probar el bot.`,
    });
  } catch (e) {
    console.error("CONECTAR: error:", e);
    return res.json({ ok: false, mensaje: "Error inesperado. Revisa los logs de Railway." });
  }
});

app.get("/", (_req, res) => res.send("Bot de WhatsApp funcionando ✅"));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Servidor escuchando en el puerto ${PORT}`));
}

module.exports = { handleIncoming, sessions };
