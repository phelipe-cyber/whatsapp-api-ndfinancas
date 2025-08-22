// comprovante-service.js
const pool = require('./db');
const { uploadToFTP } = require('./ftp-client');
const path = require('path');
const { Readable } = require('stream');

/**
 * Formata um objeto Date para o formato 'YYYY-MM-DD HH:MM:SS'.
 * @param {Date} date O objeto Date a ser formatado.
 * @returns {string} A data formatada.
 */
function formatDateTime(date) {
    const pad = (num) => num.toString().padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Orquestra o upload de um comprovante para o FTP e o registro no banco de dados.
 * @param {object} params Parâmetros da função.
 * @returns {Promise<object>} Um objeto indicando sucesso ou falha.
 */
async function salvarComprovante({ id_solicitacao, uploadedFile, usuario, dt_pgto, valor_pago, juros_diaria, juros_mensal }) {
    let connection;
    try {
        // --- 1. Gerar o nome do arquivo e o timestamp ---
        const dataComprovante = new Date();
        const dataComprovanteFormatada = formatDateTime(dataComprovante);
        const timestampParaNome = dataComprovanteFormatada.replace(/ /g, '_').replace(/:/g, '-');
        const extensao = path.extname(uploadedFile.name);
        const nomeOriginal = path.basename(uploadedFile.name, extensao);

        const nomeComprovante = `${id_solicitacao}_${timestampParaNome}_${nomeOriginal}${extensao}`;
        const caminhoRemotoFTP = `/teste_comprovante/${nomeComprovante}`;

        // --- 2. Fazer o upload para o servidor FTP ---
        console.log(`Iniciando upload para o FTP: ${caminhoRemotoFTP}`);
        const fileStream = Readable.from(uploadedFile.data);
        const ftpResult = await uploadToFTP(fileStream, caminhoRemotoFTP);

        if (!ftpResult.success) {
            throw new Error(`Falha no upload para o FTP: ${ftpResult.error}`);
        }
        console.log("Upload para o FTP concluído com sucesso.");

        // --- 3. Inserir os registros no banco de dados DENTRO DE UMA TRANSAÇÃO ---
        console.log("Iniciando transação com o banco de dados...");
        connection = await pool.getConnection();
        await connection.beginTransaction(); // Inicia a transação

        // Primeira inserção: comprovantes
        const sql_insert_comprovante = `
            INSERT INTO comprovantes
            (id_solicitacao, comprovante, usuario, dt_pgto, data_comprovante)
            VALUES(?, ?, ?, ?, ?)
        `;
        const values_comprovante = [id_solicitacao, nomeComprovante, usuario, dt_pgto, dataComprovanteFormatada];
        await connection.execute(sql_insert_comprovante, values_comprovante);
        console.log("Registro de comprovante inserido.");

        // Segunda inserção: valor_pago
        const sql_insert_valor_pago = `
            INSERT INTO valor_pago
            (id_solicitacao, valor_pago, atraso_diaria, atraso_parcela, total_atraso, em_aberto, usuario, data_valor_pago)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        `; // CORRIGIDO: 8 placeholders

        // Garante que os valores são 'null' em vez de 'undefined'
        const values_valo_pago = [
            id_solicitacao,
            valor_pago || null,
            juros_diaria || null,
            juros_mensal || null,
            "0.00", // total_atraso
            "0.00", // em_aberto
            usuario,
            dataComprovanteFormatada
        ];
        await connection.execute(sql_insert_valor_pago, values_valo_pago);
        console.log("Registro de valor_pago inserido.");

        await connection.commit(); // Confirma a transação
        console.log("Transação confirmada com sucesso.");

        return { success: true, filename: nomeComprovante };

    } catch (error) {
        console.error("Erro no processo de salvar comprovante:", error);
        if (connection) {
            await connection.rollback(); // Desfaz a transação em caso de erro
            console.log("Transação desfeita (rollback).");
        }
        return { success: false, error: error.message };
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

module.exports = { salvarComprovante };
