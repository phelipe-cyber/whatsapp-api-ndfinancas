// ftp-test.js
const ftp = require("basic-ftp");
require('dotenv').config();

async function testFTPConnection() {
    const client = new ftp.Client();
    // Ativa os logs detalhados para vermos toda a comunicação com o servidor
    client.ftp.verbose = true; 

    console.log("A tentar ligar ao servidor FTP...");

    try {
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: false
        });

        console.log("\n✅ LIGAÇÃO BEM-SUCEDIDA! O utilizador e a senha estão corretos.");

        // Pergunta ao servidor qual é o diretório de trabalho atual
        const currentPath = await client.pwd();
        console.log(`\n📍 Onde você está (PWD): ${currentPath}`);

        // Lista o conteúdo do diretório atual
        const list = await client.list();
        console.log("\n📁 Conteúdo da pasta:");
        list.forEach(item => {
            console.log(`- ${item.name} (${item.type === 1 ? 'Pasta' : 'Ficheiro'})`);
        });

    } catch (err) {
        console.error("\n❌ ERRO NA LIGAÇÃO:", err);
        if (err.code === 530) {
            console.error("--> O código 530 confirma que o utilizador ou a senha estão incorretos.");
        }
    } finally {
        if (!client.closed) {
            client.close();
        }
    }
}

testFTPConnection();