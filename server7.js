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
      action: { buttons: [{ type: "reply", reply: { id: "volver", title: "Ver servicios" } }] },
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
          { type: "reply", reply: { id: "volver", title: "Ver servicios" } },
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
  servicio_4:
    "🏢 *Polarizado Arquitectónico*\n\nCuéntame por favor:\n• Si es para casa, oficina o local\n• Cantidad aproximada de ventanas o metros\n• Ciudad y barrio",
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

  return sendText(
    from,
    `¡Excelente elección! 🙌 Anoté tu interés en el plan *${plan.nombre}*. El asesor te dará todos los detalles en breve. 😊`
  );
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
/*  Peliculas antiatraco (servicio 3)                                  */
/*  Se envian en el orden de este objeto.                              */
/*  Titulo de fila de la lista: maximo 24 caracteres.                  */
/* ------------------------------------------------------------------ */

const PELICULAS_ANTIATRACO = {
  film_500: {
    nombre: "500 Micras Antiatraco",
    url: "https://res.cloudinary.com/ryidlaom/image/upload/v1792786189/WhatsApp_Image_2026-10-23_at_2.59.26_PM_1.jpg",
  },
  film_700: {
    nombre: "700 Micras Antiatraco",
    url: "https://res.cloudinary.com/ryidlaom/image/upload/v1792786188/WhatsApp_Image_2026-10-23_at_2.59.26_PM.jpg",
  },
  film_1000: {
    nombre: "1000 Micras Antiatraco",
    url: "https://res.cloudinary.com/ryidlaom/image/upload/v1792786187/WhatsApp_Image_2026-10-23_at_2.59.25_PM_2.jpg",
  },
  film_1200: {
    nombre: "1200 Micras Antiatraco",
    url: "https://res.cloudinary.com/ryidlaom/image/upload/v1792786188/WhatsApp_Image_2026-10-23_at_2.59.25_PM_1.jpg",
  },
  film_1700: {
    nombre: "1700 Micras Antiatraco",
    url: "https://res.cloudinary.com/ryidlaom/image/upload/v1792786188/WhatsApp_Image_2026-10-23_at_2.59.25_PM.jpg",
  },
};

// Segundos de espera entre las imagenes y la pregunta de cual pelicula le gusto
const ESPERA_PREGUNTA_ANTIATRACO_MS = 10000;

const sendAntiatracoList = (to) =>
  sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "😊 ¿Cuál película de seguridad te gustó más?" },
      footer: { text: "Toca el botón para elegir" },
      action: {
        button: "Ver películas",
        sections: [
          {
            title: "Películas antiatraco",
            rows: Object.entries(PELICULAS_ANTIATRACO).map(([id, p]) => ({ id, title: p.nombre })),
          },
        ],
      },
    },
  });

// Envia las peliculas y, pasados 10 segundos, pregunta cual le gusto
async function enviarPeliculasAntiatraco(from, vehiculo) {
  await sendText(from, "🛡️ Estas son nuestras *películas de seguridad Antiatraco*. Mira las opciones 👇");
  for (const p of Object.values(PELICULAS_ANTIATRACO)) await sendImage(from, p.url, p.nombre);

  console.log(`ANTIATRACO: cliente ${from} vio las peliculas (${vehiculo})`);

  await new Promise((resolve) => setTimeout(resolve, ESPERA_PREGUNTA_ANTIATRACO_MS));

  // Si el cliente escribio algo, eligio o reinicio mientras esperabamos, no repetimos la pregunta
  if (getSession(from)?.estado !== "antiatraco") return;
  return sendAntiatracoList(from);
}

// El cliente eligio una pelicula de la lista: pasa a asesor
async function responderPelicula(from, id) {
  const p = PELICULAS_ANTIATRACO[id];
  if (!p) return sendMainMenu(from);

  setSession(from, { pelicula: p.nombre, estado: "listo" });
  const s = getSession(from);
  console.log(`ANTIATRACO ELEGIDA: cliente ${from} | pelicula: ${p.nombre} | vehiculo: ${s.vehiculo || "-"}`);
  console.log(`ASESOR: cliente ${from} | eligio ${p.nombre} | vehiculo: ${s.vehiculo || "-"}`);

  await sendText(
    from,
    `¡Excelente elección! 🙌 Anoté tu interés en la película *${p.nombre}*.\n\n👤 Un asesor te escribirá en breve para darte todos los detalles. Si tienes alguna pregunta, escríbela aquí. 😊`
  );
  return sendVolverMenu(from);
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
  if (id?.startsWith("video_")) return responderVideo(from, id);
  if (id?.startsWith("plan_")) return responderPlan(from, id);
  if (id?.startsWith("film_")) return responderPelicula(from, id);
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

  // Viendo las peliculas antiatraco: cualquier texto pasa a un asesor
  if (s?.estado === "antiatraco") {
    return pasarAAsesor(from, `escribio en peliculas antiatraco: ${texto.slice(0, 200)}`);
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

    for (const message of messages) {
      console.log("Mensaje recibido de", message.from, "tipo:", message.type);
      handleIncoming(message).catch((e) => console.error("Error manejando mensaje:", e));
    }
  } catch (e) {
    console.error("Error procesando webhook:", e);
  }
});

app.get("/", (_req, res) => res.send("Bot de WhatsApp funcionando ✅"));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Servidor escuchando en el puerto ${PORT}`));
}

module.exports = { handleIncoming, sessions };
