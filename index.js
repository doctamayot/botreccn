require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Cargar el texto de tus documentos permanentemente desde la carpeta del proyecto
let textoConocimiento = "";
try {
    const rutaArchivo = path.join(__dirname, 'conocimiento', 'base_conocimiento.txt');
    textoConocimiento = fs.readFileSync(rutaArchivo, 'utf8');
    console.log("📚 Base de conocimiento cargada con éxito.");
} catch (err) {
    console.error("⚠️ No se pudo cargar el archivo de conocimiento:", err.message);
}

// Memoria de sesiones e historial de mensajes para evitar duplicados por reintentos de Meta
const sesiones = new Map();
const mensajesProcesados = new Set();

function obtenerOCrearSesion(phoneNumber) {
    if (sesiones.has(phoneNumber)) {
        return sesiones.get(phoneNumber);
    }
    const nuevaSesion = { historial: [] };
    sesiones.set(phoneNumber, nuevaSesion);
    return nuevaSesion;
}

// Webhook para Meta en Vercel Serverless
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object) {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (message && message.text) {
            const messageId = message.id;

            // 🛑 PREVENCIÓN DE MENSAJES DOBLES: Si Meta ya envió este mensaje, lo ignoramos
            if (mensajesProcesados.has(messageId)) {
                return res.sendStatus(200);
            }
            mensajesProcesados.add(messageId);

            // Mantener el Set pequeño para no saturar memoria
            if (mensajesProcesados.size > 100) {
                const primerElemento = mensajesProcesados.values().next().value;
                mensajesProcesados.delete(primerElemento);
            }

            const phoneNumber = message.from;
            const text = message.text.body;

            console.log(`📩 MENSAJE RECIBIDO de ${phoneNumber}: "${text}"`);

            try {
                const aiResponse = await getGeminiResponse(phoneNumber, text);
                await sendWhatsAppMessage(phoneNumber, aiResponse);
            } catch (error) {
                console.error('❌ Error en el flujo:', error.message || error);
            }
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

DOCUMENTACIÓN DE APOYO:
${textoConocimiento}

PORTAFOLIO DE SERVICIOS:
1. Insolvencia Económica (Persona Natural No Comerciante).
2. Conciliación Extrajudicial en Derecho (Tránsito, Civil, Familia, Comercial).
3. Acuerdos de apoyo


REGLAS STRICTAS DE COMPORTAMIENTO:

1. MANEJO DE PREGUNTAS SOBRE REQUISITOS O INFORMACIÓN:
   - Si el usuario dice "Sí", "Quiero saber los requisitos", "¿Qué necesito?" o responde afirmativamente a si desea información:
     LISTA LOS REQUISITOS CLARAMENTE Y EXPLICATIVOS. NUNCA envíes los datos del asesor en este punto.
   - Tras explicar los requisitos o la información, finaliza preguntando: "¿Deseas agendar una cita con nuestro equipo legal para revisar tus deudas a detalle?"

2. REGLA DE ACTIVACIÓN DEL ASESOR (ÚNICA EXCEPCIÓN):
   - Envía los datos del asesor ÚNICAMENTE si el usuario responde "Sí" a la pregunta de AGENDAR CITA, o si escribe frases explícitas como: "quiero agendar", "iniciar trámite", "hablar con un asesor" o "hablar con un humano".

   Al activarse esta condición, envía EXACTAMENTE este texto:
   "Para agendar tu cita y revisar los detalles de tu caso, un asesor de nuestro equipo te atenderá directamente aquí:
   📲 *Contacto:* 3133547614
   🔗 *Enlace directo:* https://wa.me/573133547614"`
    });

    sesion.historial.push({ role: "user", parts: [{ text: userMessage }] });

    const chat = model.startChat({
        history: sesion.historial.slice(0, -1)
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
        console.error('❌ Error enviando a Meta:', error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
}