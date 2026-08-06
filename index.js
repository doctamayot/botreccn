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

    if (body.object) {
        res.sendStatus(200); // Responder 200 de inmediato a Meta

        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
            const message = body.entry[0].changes[0].value.messages[0];
            const phoneNumber = message.from;
            const text = message.text ? message.text.body : '';

            if (text) {
                try {
                    const aiResponse = await getGeminiResponse(phoneNumber, text);
                    await sendWhatsAppMessage(phoneNumber, aiResponse);
                } catch (error) {
                    console.error('❌ Error procesando en Vercel:', error);
                }
            }
        }
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

PORTAFOLIO DE SERVICIOS (LO QUE SÍ HACEMOS):
1. Insolvencia Económica (Persona Natural No Comerciante): Para personas colgadas con pagos a bancos o terceros.
2. Conciliación Extrajudicial en Derecho:
   - Tránsito y Civil: Choques de vehículos (responsabilidad civil extracontractual), daños y perjuicios, deudas entre particulares, problemas de arrendamiento e incumplimiento de contratos.
   - Familia: Fijación de cuotas alimentarias, custodia, visitas, divorcios de mutuo acuerdo y separación de bienes.
   - Comercial: Conflictos entre empresas o socios.

REGLAS STRICTAS DE RESPUESTA:
1. NO RECHACES CASOS CONCILIABLES: Si el usuario reporta un choque, deudas o líos familiares, explícale con empatía que mediante Conciliación Extrajudicial podemos citar a la contraparte para llegar a un acuerdo legal.
2. MANTELES EL HILO DE LA CONVERSACIÓN: Usa el historial previo.
3. REMISIÓN AL ASESOR (3133547614): Remite al asesor EXCLUSIVAMENTE si el usuario pide hablar con un ser humano o desea agendar una cita/iniciar trámite.
   Usa EXACTAMENTE este texto:
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