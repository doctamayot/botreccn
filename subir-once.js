require('dotenv').config();
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const fs = require('fs');
const path = require('path');

const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

async function subirArchivos() {
    const carpetaDocs = path.join(__dirname, 'documentos');
    const archivos = fs.readdirSync(carpetaDocs).filter(f => f.endsWith('.pdf'));

    console.log("⏳ Subiendo PDFs a Google Gemini...");
    const resultado = [];

    for (const archivo of archivos) {
        const rutaCompleta = path.join(carpetaDocs, archivo);
        const uploadResult = await fileManager.uploadFile(rutaCompleta, {
            mimeType: "application/pdf",
            displayName: archivo,
        });
        
        resultado.push({
            fileData: {
                fileUri: uploadResult.file.uri,
                mimeType: uploadResult.file.mimeType
            }
        });
        console.log(`✅ Subido: ${archivo} -> URI: ${uploadResult.file.uri}`);
    }

    console.log("\n👇 COPIA Y PEGA ESTE ARREGLO EN TU CÓDIGO DE VERCEL 👇\n");
    console.log(JSON.stringify(resultado, null, 2));
}

subirArchivos();