// ocr-service.js
const { createWorker } = require('tesseract.js');

/**
 * Extrai o texto de uma imagem usando OCR.
 * @param {Buffer} imageBuffer O buffer da imagem a ser processada.
 * @returns {Promise<string>} O texto extraído da imagem.
 */
async function readTextFromImage(imageBuffer) {
    // console.log('Iniciando o processo de OCR...');
    const worker = await createWorker('por'); // 'por' para o idioma português

    try {
        // 1. Reconhece o texto na imagem
        const { data: { text } } = await worker.recognize(imageBuffer);
        // console.log('Texto extraído com sucesso.');
        return text;
    } catch (error) {
        console.error("Erro durante o reconhecimento de texto (OCR):", error);
        return "Não foi possível ler o texto da imagem.";
    } finally {
        // 2. É MUITO IMPORTANTE terminar o worker para libertar a memória.
        await worker.terminate();
        // console.log('Worker do OCR finalizado.');
    }
}

module.exports = { readTextFromImage };
