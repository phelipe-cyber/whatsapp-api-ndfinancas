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
 * @param {number} id_solicitacao O ID da solicitação relacionada.
 * @param {number} valor_pago O ID da solicitação relacionada.
 * @param {number} juros_diaria O ID da solicitação relacionada.
 * @param {number} juros_mensal O ID da solicitação relacionada.
 * @param {object} uploadedFile O objeto do arquivo vindo do express-fileupload.
 * @param {string} usuario O nome do usuário que está enviando.
 * @param {string} dt_pgto A data do pagamento no formato 'YYYY-MM-DD'.
 * @returns {Promise<object>} Um objeto indicando sucesso ou falha.
 */
async function salvarComprovante(id_solicitacao, uploadedFile, dt_pgto, juros_diaria, juros_mensal, valor_pago, comprovanteNome,abatimento,quitacao,parcela,obs) {
    let connection;
    try {
        //console.log('salvarComprovante Juros_mensal:', juros_mensal);

        // --- 1. Gerar o nome do arquivo e o timestamp ---
        const dataComprovante = new Date();
        const dataComprovanteFormatada = formatDateTime(dataComprovante);
        const timestampParaNome = dataComprovanteFormatada.replace(/ /g, '_').replace(/:/g, '-');
        const extensao = path.extname(uploadedFile.name);
        const nomeOriginal = path.basename(uploadedFile.name, extensao);

        const nomeComprovante = `${id_solicitacao}_${timestampParaNome}_${nomeOriginal}${extensao}`;
        const caminhoRemotoFTP = `/teste_comprovante/${nomeComprovante}`;

        // --- 2. Fazer o upload para o servidor FTP ---
        //console.log(`Iniciando upload para o FTP: ${caminhoRemotoFTP}`);
        const fileStream = Readable.from(uploadedFile.data);
        const ftpResult = await uploadToFTP(fileStream, caminhoRemotoFTP);

        if (!ftpResult.success) {
            // Se o upload para o FTP falhar, lança um erro para interromper o processo.
            throw new Error(`Falha no upload para o FTP: ${ftpResult.error}`);
        }
        //console.log("Upload para o FTP concluído com sucesso.");

        // --- 3. Inserir o registro no banco de dados ---
        //console.log("Inserindo registro no banco de dados...");
        connection = await pool.getConnection();
        const sql = `
            INSERT INTO comprovantes
            (id_solicitacao, comprovante, comprovante_nome, usuario, dt_pgto, data_comprovante,valor_total,juros_mensal,juros_diaria,abatimento,quitacao,parcela,obs)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [id_solicitacao,
                        nomeComprovante,
                         comprovanteNome, 
                         1,
                        dt_pgto,
                        dataComprovanteFormatada,
                        valor_pago || null,
                        juros_mensal || null,
                        juros_diaria || null,
                        abatimento || null,
                        quitacao || null,
                        parcela || null,
                        obs || null];

        await connection.execute(sql, values);

        // const sqlUpdate = `
        //     UPDATE valor_pago
        //     SET valor_pago = ?
        //     WHERE id_solicitacao = ?;
        // `;
        
        // const valuesUpdate = [
        //     valor_pago || null,  // primeiro o valor a atualizar
        //     id_solicitacao       // depois o id da linha que será atualizada
        // ];
        
        // await connection.execute(sqlUpdate, valuesUpdate);
    
        //console.log("Registro inserido no banco de dados com sucesso.");

        await connection.commit(); // Confirma a transação
        //console.log("Transação confirmada com sucesso.");

        return { success: true, filename: nomeComprovante };

    } catch (error) {
        console.error("Erro no processo de salvar comprovante:", error);
        // TODO: Implementar lógica de rollback (ex: deletar arquivo do FTP se o DB falhar)
        if (connection) {
            await connection.rollback(); // Desfaz a transação em caso de erro
            //console.log("Transação desfeita (rollback).");
        }
        return { success: false, error: error.message };
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

module.exports = { salvarComprovante };
