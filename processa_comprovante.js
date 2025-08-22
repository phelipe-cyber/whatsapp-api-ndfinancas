// comprovante_handler.js

const { MessageMedia } = require('whatsapp-web.js');
const pdf = require('pdf-parse');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');

// Importe suas dependências de serviço aqui
const pool = require('./db');
const { salvarComprovante } = require('./comprovante-service');
const { readTextFromImage } = require('./ocr-service');

// Esta função é chamada quando o bot recebe uma mensagem que pode ser parte do fluxo de comprovante.
async function handleComprovanteMessage({ msg, session, userSessions, pendingMedia }) {
    const userId = msg.from;
    const messageBody = msg.body.trim();
    const nomeContato = msg._data.notifyName;

    try {
        // ETAPA 1: Usuário envia a mídia primeiro
        if (msg.hasMedia && messageBody.toLowerCase() == '!ping') {
            console.log(`[COMPROVANTE] Mídia recebida de ${userId}. Armazenando...`);
            const attachmentData = await msg.downloadMedia();
            if (!attachmentData) throw new Error("Falha ao baixar a mídia.");

            pendingMedia.set(userId, attachmentData);
            userSessions.set(userId, { lastMessageTimestamp: Date.now(), state: 'awaiting_proof_data' });
            await msg.reply('✅ Comprovante recebido. Agora, por favor, envie os dados do cliente (Ex: Nome: Cliente Teste, Juros mensal: 150).');
            return { handled: true }; // Indica que a mensagem foi tratada
        }

        // ETAPA 2: Usuário envia o texto com os dados após a mídia
        if (session && session.state === 'awaiting_proof_data' && messageBody.includes(':')) {
            const attachmentData = pendingMedia.get(userId);
            if (!attachmentData) {
                userSessions.delete(userId);
                await msg.reply(`Olá *${nomeContato}*! \nOcorreu um erro, o comprovante não foi encontrado. Por favor, envie o arquivo novamente.`);
                return { handled: true };
            }

            console.log(`[COMPROVANTE] Dados recebidos de ${userId}. Combinando com mídia pendente.`);

            let connection;
            try {
                const dadosDoCliente = parseMessageData(messageBody);
                const { NOME: nomeCliente, 'JUROS MENSAL': juros_mensal, 'JUROS DIARIA': juros_diaria } = dadosDoCliente;

                if (!nomeCliente || !juros_mensal) {
                    return msg.reply(`❌ Olá *${nomeContato}*! \nDados incompletos. Forneça ao menos NOME e JUROS MENSAL no formato "CHAVE: VALOR".`);
                }

                connection = await pool.getConnection();
                const resultado = await verificarClienteExiste(nomeCliente);
                if (!resultado.existe) {
                    return msg.reply(`❌ Olá *${nomeContato}*! \nCliente *${nomeCliente}* não encontrado no sistema.`);
                }

                await msg.reply(`🛠️ Processando comprovante...`);
                const fileBuffer = Buffer.from(attachmentData.data, 'base64');
                let textoExtraido = '';

                if (attachmentData.mimetype.startsWith('image/')) {
                    textoExtraido = await readTextFromImage(fileBuffer);
                } else if (attachmentData.mimetype === 'application/pdf') {
                    textoExtraido = (await pdf(fileBuffer)).text;
                } else {
                    return msg.reply(`❌ Olá *${nomeContato}*! \nTipo de arquivo não suportado. Envie uma imagem ou PDF.`);
                }

                if (!textoExtraido) {
                    return msg.reply(`❌ Olá *${nomeContato}*! \nNão consegui extrair texto do arquivo. Tente um com melhor qualidade.`);
                }

                const dadosComprovante = parseComprovanteText(textoExtraido);
                let resposta = `*✅ Olá *${nomeContato}*! \nDados extraídos do comprovante:*\n\n👤 *Nome:* ${dadosComprovante.nome || 'Não encontrado'}\n💰 *Valor:* R$ ${dadosComprovante.valor || 'Não encontrado'}\n📅 *Data:* ${dadosComprovante.data || 'Não encontrada'}`;
                await msg.reply(resposta);

                const uploadedFile = {
                    name: attachmentData.filename || `${uuidv4()}.${mime.extension(attachmentData.mimetype)}`,
                    data: fileBuffer,
                    mimetype: attachmentData.mimetype
                };

                const result = await salvarComprovante(resultado.id_solicitacao, uploadedFile, dadosComprovante.data, juros_diaria, juros_mensal, dadosComprovante.valor);

                if (result.success) {
                    await msg.reply(`✅ Olá *${nomeContato}*! \n Comprovante *${nomeCliente}* processado com sucesso!`);
                    pendingMedia.delete(userId);
                    userSessions.delete(userId);
                } else {
                    throw new Error(result.error || 'Falha ao salvar o comprovante.');
                }
            } catch (error) {
                console.error('Erro ao processar comprovante conversacional:', error);
                await msg.reply(`❌ Olá *${nomeContato}*! \nOcorreu um erro geral ao processar sua solicitação.`);
            } finally {
                if (connection) connection.release();
            }
            return { handled: true };
        }
        } catch (error) {
        console.error(`[ERRO NO COMPROVANTE] Usuário ${userId}:`, error);
        await msg.reply("❌ Olá *${nomeContato}*! \nOcorreu um erro inesperado durante o processamento do comprovante. A sessão foi encerrada.");
        userSessions.delete(userId);
        pendingMedia.delete(userId);
        return { handled: true };
    }

    return { handled: false }; // Indica que a mensagem não foi tratada por este fluxo
}


// --- FUNÇÕES AUXILIARES (movidas para cá) ---

function parseComprovanteText(text) {
    const data = { valor: null, nome: null, data: null };
    const valorPatterns = [/VALOR\s*:\s*([\d.,]+)/i, /R\$\s+([\d.,]+)/i, /Valor\s*[:\s\n]*R\$\s*([\d.,]+)/i, /Valor\s+R\$\s*([\d.,]+)/i, /Valor\s*da\s*Transferência\s*[:\s\n]*R\$\s*([\d.,]+)/i, /VALOR\s*[:\s\n]*R\$\s*([\d.,]+)/i, /(?:\n|^)\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:\n|$)/, /R\$\s*([\d.,]+)/];
    const nomePatterns = [/\d{4}\s+\d{4}\s+\d{10}-\d\s*\n([A-ZÀ-Ú\s]+)/i, /\n([A-ZÀ-Ú\s]+)\nVALOR/i, /dados da conta debitada\s*[\n\s]*nome\s+([A-Za-zÀ-ú\s]+)/i, /Dados\s+de\s+quem\s+pagou\s*[\n\s]*Nome:\s*([A-Za-zÀ-ú\s]+)/i, /Quem\s*pagou\s*[\n\s]*Nome\s+([A-Za-zÀ-ú\s]+)/i, /(?:\n|^)\s*De\s*\n([\s\S]+?)\n\s*CPF:/i, /Origem\s*[\n\s]*Nome\s+([A-Za-zÀ-ú\s]+)/i, /De\s*[\n:]\s*([A-Za-zÀ-ú\s]+)/, /Pagador\s*[:\n]\s*([A-Za-zÀ-ú\s]+)/i, /Nome\s*do\s*Pagador\s*[:\n]\s*([A-Za-zÀ-ú\s]+)/i];
    const dataPatterns = [/(\d{2}\/[A-Z]{3}\/\d{4})/i, /realizado em\s*(\d{2}\/\d{2}\/\d{4})/i, /(\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4})/i, /(\d{1,2}\/[a-z]{3}\/\d{4})/i, /(\d{1,2}\s+[A-ZÇ-ú]+\s+\d{4})/i, /(\d{2}\/\d{2}\/\d{4})/, /Data\s*da\s*Transação\s*[:\n\s]*(\d{2}\/\d{2}\/\d{4})/i, /Realizada\s*em\s*(\d{2}\/\d{2}\/\d{4})/i];

    function findMatch(patterns, text) {
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) return match[1].replace(/(\r\n|\n|\r)/gm, " ").trim();
        }
        return null;
    }

    data.valor = findMatch(valorPatterns, text);
    let nomeBruto = findMatch(nomePatterns, text);
    if (nomeBruto) {
        data.nome = nomeBruto.replace(/CPF$/i, '').replace(/Instituição NU PAGAMENTOS/i, '').trim();
    }
    data.data = normalizeDate(findMatch(dataPatterns, text));
    return data;
}

async function verificarClienteExiste(clientName) {
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            SELECT c.socio AS nome_cliente, s.id AS id_solicitacao
            FROM clientes c
            LEFT JOIN solicitacao s ON s.id_cliente = c.id
            WHERE c.socio = ? LIMIT 1`;
        const [rows] = await connection.execute(sql, [clientName]);
        if (rows.length > 0) {
            return { existe: true, id_solicitacao: rows[0].id_solicitacao, nome_cliente: rows[0].nome_cliente };
        } else {
            return { existe: false, id_solicitacao: null, nome_cliente: null };
        }
    } catch (error) {
        console.error("Erro ao buscar cliente no banco de dados:", error);
        return { existe: false, id_solicitacao: null, nome_cliente: null };
    } finally {
        if (connection) connection.release();
    }
}

function normalizeDate(dateStr) {
    if (!dateStr) return null;
    const monthMap = { 'janeiro': '01', 'jan': '01', 'fevereiro': '02', 'fev': '02', 'março': '03', 'mar': '03', 'abril': '04', 'abr': '04', 'maio': '05', 'mai': '05', 'junho': '06', 'jun': '06', 'julho': '07', 'jul': '07', 'agosto': '08', 'ago': '08', 'setembro': '09', 'set': '09', 'outubro': '10', 'out': '10', 'novembro': '11', 'nov': '11', 'dezembro': '12', 'dez': '12' };
    const lowerDateStr = dateStr.toLowerCase();
    let match = lowerDateStr.match(/(\d{1,2})\s+(?:de\s+)?([a-zç]+)\s+(?:de\s+)?(\d{4})/);
    if (match) {
        const month = monthMap[match[2]];
        if (month) return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
    }
    match = lowerDateStr.match(/(\d{1,2})\/([a-z]{3})\/(\d{4})/);
    if (match) {
        const month = monthMap[match[2]];
        if (month) return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
    }
    match = lowerDateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    return dateStr;
}

function parseMessageData(textBody) {
    const data = {};
    const lines = textBody.toUpperCase().split('\n');
    for (const line of lines) {
        const parts = line.split(':');
        if (parts.length >= 1) {
            const key = parts[0].trim();
            let valueStr = parts.slice(1).join(':').trim();
            valueStr = valueStr.toUpperCase();
            const value = !isNaN(valueStr) && valueStr.trim() !== '' ? Number(valueStr) : valueStr;
            data[key] = value;
        }
    }
    return data;
}

module.exports = { handleComprovanteMessage };
