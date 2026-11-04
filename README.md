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

## Panel de conversaciones y MCP para Claude

### Panel `/panel`

Abre `https://TU-APP.up.railway.app/panel` e ingresa tu `ADMIN_KEY`. Desde ahí puedes:

- Ver en tiempo real todas las conversaciones. Cada mensaje indica quién lo escribió: 👤 cliente, 🤖 bot, 📱 teléfono (lo que respondes desde la app WhatsApp Business), 💻 panel o ✨ Claude.
- Ver primero, con la etiqueta **asesor**, a los clientes que pidieron hablar con un asesor, junto con el motivo. Cuando los atiendas, pulsa **Marcar atendido**.
- Responder desde el panel. El mensaje sale por el número del negocio y también aparece en tu celular.

### MCP para Claude `/mcp`

Claude puede listar las conversaciones, leerlas, buscar mensajes, responder a los clientes y marcarlos como atendidos.

- **Claude (web, escritorio o móvil):** ve a Configuración → Conectores → *Agregar conector personalizado* y usa como URL `https://TU-APP.up.railway.app/mcp/TU_MCP_KEY`.
- **Claude Code:**
  ```bash
  claude mcp add --transport http alfa-whatsapp https://TU-APP.up.railway.app/mcp --header "Authorization: Bearer TU_MCP_KEY"
  ```

La clave forma parte de la URL, así que trátala como una contraseña.

### Variables nuevas en Railway

| Variable | Para qué sirve |
|---|---|
| `DATABASE_URL` | En Railway, *New → Database → PostgreSQL*. Luego, en el servicio del bot, agrega `DATABASE_URL = ${{Postgres.DATABASE_URL}}`. Sin esta variable el historial vive en memoria y se borra en cada despliegue. |
| `MCP_KEY` | Clave larga que inventas tú. Sin ella el MCP queda desactivado. |
| `ADMIN_KEY` | La misma clave de `/conectar`. También protege el panel. |

### Ver en el panel lo que respondes desde el celular

Si conectaste el número con `/conectar` en modo coexistencia, ve a developers.facebook.com → tu app → **WhatsApp → Configuration → Webhook fields** y suscríbete también a **`smb_message_echoes`**. Sin esa suscripción, lo que escribas desde la app WhatsApp Business no se verá en el panel.

### Ventana de 24 horas

El panel y Claude solo pueden enviar texto libre si el cliente escribió en las últimas 24 horas. Fuera de ese plazo, el panel oculta la caja de respuesta y Claude recibe un aviso. Para retomar el contacto hay que usar una plantilla aprobada por Meta.

## Recuerda

- Solo puedes escribir libremente dentro de las 24 horas siguientes al último mensaje del cliente. Fuera de ese plazo debes usar plantillas aprobadas por Meta.
- No subas tu `.env` a GitHub.
