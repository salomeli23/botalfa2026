# Bot de WhatsApp con menú interactivo

Bot en Node.js que usa la Cloud API de Meta. Muestra un menú con botones, una lista de opciones y responde según lo que elija el usuario.

## 1. Instalar

```bash
npm install
cp .env.example .env
```

Abre `.env` y completa:

| Variable | Dónde se obtiene |
|---|---|
| `WHATSAPP_TOKEN` | developers.facebook.com → tu app → WhatsApp → API Setup (para producción, crea un token permanente con un Usuario del sistema) |
| `PHONE_NUMBER_ID` | Misma pantalla de API Setup |
| `VERIFY_TOKEN` | Un texto que inventes tú |
| `APP_SECRET` | Configuración de la app → Básica → Clave secreta |

## 2. Ejecutar en local

```bash
npm start
```

En otra terminal, expón el puerto con ngrok:

```bash
ngrok http 3000
```

## 3. Configurar el webhook en Meta

1. En tu app: **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL:** `https://TU-URL-DE-NGROK/webhook`
3. **Verify token:** el mismo `VERIFY_TOKEN` de tu `.env`.
4. Guarda y, en **Webhook fields**, suscríbete a **messages**.

## 4. Probar

Escríbele "hola" al número del bot desde tu WhatsApp. Debe responder con el menú de 3 botones. El botón "Más opciones" abre la lista.

## Personalizar

- Textos de respuesta: objeto `respuestas` en `server.js`.
- Botones: función `sendMainMenu` (máx. 3 botones, título de hasta 20 caracteres).
- Lista: función `sendListMenu` (hasta 10 filas en total).

## Para dejarlo en producción

Sube el proyecto a un servicio con HTTPS fijo (Render, Railway, Fly.io o un VPS) y cambia la Callback URL del webhook por la URL definitiva. Ya no necesitas ngrok.

## Recuerda

- Solo puedes escribir libremente dentro de las 24 horas siguientes al último mensaje del cliente. Fuera de ese plazo debes usar plantillas aprobadas por Meta.
- No subas tu `.env` a GitHub.
