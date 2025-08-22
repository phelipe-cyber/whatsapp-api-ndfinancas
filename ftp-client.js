// ftp-client.js
const ftp = require("basic-ftp");
require('dotenv').config();

// Renomeado para 'fileStream' para maior clareza
async function uploadToFTP(fileStream, remoteFileName) { 
    const client = new ftp.Client();
    try {
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: false
        });

        await client.ensureDir("./teste_comprovante");

        // A biblioteca agora recebe o stream, como esperado
        await client.uploadFrom(fileStream, remoteFileName); 

        console.log(`Arquivo ${remoteFileName} enviado com sucesso para o FTP.`);
        return { success: true, filename: remoteFileName };

    } catch (err) {
        console.error("ERRO NO UPLOAD FTP:", err);
        return { success: false, error: err.message };
    } finally {
        if (!client.closed) {
            client.close();
        }
    }
}

module.exports = { uploadToFTP };