require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// PEGA AQUÍ EL RESULTADO QUE TE DIO EL SCRIPT 'subir-once.js'
const archivosProcesados = [
  {
    "fileData": {
      "fileUri": "https://generativelanguage.googleapis.com/v1beta/files/86lspjfj8f2r",
      "mimeType": "application/pdf"
    }
  },
  {
    "fileData": {
      "fileUri": "https://generativelanguage.googleapis.com/v1beta/files/t9ezmw194fky",
      "mimeType": "application/pdf"
    }
  },
  {
    "fileData": {
      "fileUri": "https://generativelanguage.googleapis.com/v1beta/files/88h6gxzf74cx",
      "mimeType": "application/pdf"
    }
  }
];

// Memoria volátil en instancia serverless
const sesiones = new Map();

function obtenerOCrearSesion(phoneNumber) {
    if (sesiones.has(phoneNumber)) {
        return sesiones.get(phoneNumber);
    }
    const nuevaSesion = { historial: [] };
    sesiones.set(phoneNumber, nuevaSesion);
    return nuevaSesion;
}

// Webhook para Meta
app.post('/webhook', async (req, res) => {
    const body = req.body;

    // Log para ver qué tipo de evento está enviando Meta
    console.log("📌 Evento recibido de Meta:", JSON.stringify(body, null, 2));

    if (body.object) {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        // Si es un mensaje real de un usuario
        if (message && message.text) {
            const phoneNumber = message.from;
            const text = message.text.body;

            console.log(`📩 PROCESANDO MENSAJE de ${phoneNumber}: "${text}"`);

            try {
                const aiResponse = await getGeminiResponse(phoneNumber, text);
                console.log(`🤖 Respuesta de Gemini generada: "${aiResponse.substring(0, 50)}..."`);

                await sendWhatsAppMessage(phoneNumber, aiResponse);
                console.log(`✅ Mensaje despachado a WhatsApp`);
            } catch (error) {
                console.error('❌ Error en el flujo:', error.message || error);
            }
        } else if (value?.statuses) {
            console.log("ℹ️ Notificación de estado (entrega/lectura). Se ignora.");
        }

        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === process.env.VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

async function getGeminiResponse(phoneNumber, userMessage) {
    const sesion = obtenerOCrearSesion(phoneNumber);

    const model = genAI.getGenerativeModel({ 
        model: "gemini-3.5-flash-lite",
        systemInstruction: `Eres el asistente virtual oficial de "Reconciliemos Colombia", un Centro de Conciliación autorizado.

PORTAFOLIO DE SERVICIOS:
1. Insolvencia Económica (Persona Natural No Comerciante): Para personas colgadas con pagos a bancos o terceros.
2. Conciliación Extrajudicial en Derecho:
   - Tránsito y Civil: Choques de vehículos, daños y perjuicios, deudas entre particulares, arrendamiento e incumplimiento de contratos.
   - Familia: Cuotas alimentarias, custodia, visitas, divorcios de mutuo acuerdo y separación de bienes.
   - Comercial: Conflictos entre empresas o socios.

REGLAS STRICTAS DE COMPORTAMIENTO:

1. PROHIBICIÓN EN RESPUESTAS INFORMATIVAS:
   - NUNCA incluyas el número de teléfono, enlace de WhatsApp ni menciones al asesor en el primer mensaje o cuando estés explicando un servicio.
   - Si el usuario menciona un tema (ej: "Quiero hacer una insolvencia", "Tuve un choque", "¿Cómo funciona?"), LIMÍTATE a explicar en qué consiste el servicio, sus beneficios y cómo podemos ayudarle.
   - Cierra siempre tus explicaciones informativas con una pregunta para continuar la interacción (ej: "¿Te gustaría saber qué requisitos se necesitan para este proceso?" o "¿Tienes alguna duda sobre cómo funciona la insolvencia?").

2. REGLA DE ACTIVACIÓN DEL ASESOR (ÚNICA EXCEPCIÓN):
   - Envía los datos del asesor ÚNICAMENTE si el usuario escribe palabras explícitas de solicitud directa, tales como: "quiero una cita", "agendar", "iniciar trámite", "quiero hablar con un asesor", "hablar con un humano" o responde "sí" cuando le preguntes si desea agendar.
   
   Al activarse esta condición, incluye el siguiente texto exacto:
   "Para agendar tu cita y revisar los detalles de tu caso, un asesor de nuestro equipo te atenderá directamente aquí:
   📲 *Contacto:* 3133547614
   🔗 *Enlace directo:* https://wa.me/573133547614"`
    });

    sesion.historial.push({ role: "user", parts: [{ text: userMessage }] });

    const chat = model.startChat({
        history: [
            { role: "user", parts: [...archivosProcesados, { text: "Usa los PDFs como base de conocimiento principal." }] },
            { role: "model", parts: [{ text: "Entendido. Responderé basándome en los documentos y el portafolio." }] },
            ...sesion.historial.slice(0, -1)
        ]
    });

    const result = await chat.sendMessage(userMessage);
    const botResponse = result.response.text();

    sesion.historial.push({ role: "model", parts: [{ text: botResponse }] });
    return botResponse;
}

async function sendWhatsAppMessage(to, text) {
    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json',
            },
            data: {
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: text },
            },
        });
    } catch (error) {
        console.error('❌ Error al enviar mensaje:', error.response ? error.response.data : error.message);
    }
}

// Exportar para Vercel Serverless
module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Servidor local en puerto ${PORT}`));
}