// comprovante_handler.js

const { MessageMedia } = require('whatsapp-web.js');
const pdf = require('pdf-parse');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');

// Importe suas dependências de serviço aqui
const pool = require('./db');
const { salvarComprovante } = require('./comprovante-service');
const { readTextFromImage } = require('./ocr-service');
const { isNull } = require('util');

// Esta função é chamada quando o bot recebe uma mensagem que pode ser parte do fluxo de comprovante.
async function handleComprovanteMessage({ msg, session, userSessions, pendingMedia }) {
    const userId = msg.from;
    const messageBody = msg.body.trim();
    const nomeContato = msg._data.notifyName;

    try {
        // ETAPA 1: Usuário envia a mídia primeiro
        // if (msg.hasMedia && messageBody.toLowerCase() == '!ping') {
        if (msg.hasMedia && session) {
            // console.log(`[COMPROVANTE] Mídia recebida de ${userId}. Armazenando...`);
            const attachmentData = await msg.downloadMedia();
            if (!attachmentData) throw new Error("Falha ao baixar a mídia.");

            pendingMedia.set(userId, attachmentData);
            userSessions.set(userId, { lastMessageTimestamp: Date.now(), state: 'awaiting_proof_data' });
            // await msg.reply('✅ Comprovante recebido. Agora, por favor, envie os dados do cliente (Ex: CPF: 123.123.123-12, Juros mensal: 150).');
            await msg.reply('✅ Comprovante recebido! Agora, envie os dados do cliente. É obrigatório o *CPF* e pelo menos um destes:\n\n- Juros Mensal:\n- Juros Diaria:\n- Abatimento:\n- Quitacao:\n- Parcela:\n\n- Ex: `CPF: 123.456.789-00,\n- ABATIMENTO: 250`.');
            return { handled: true }; // Indica que a mensagem foi tratada
        }

        // ETAPA 2: Usuário envia o texto com os dados após a mídia
        if (session && session.state === 'awaiting_proof_data' && messageBody.includes(':')) {
            const attachmentData = pendingMedia.get(userId);
            if (!attachmentData) {
                // userSessions.delete(userId);
                await msg.reply(`Olá *${nomeContato}*! \nOcorreu um erro, o comprovante não foi encontrado. Por favor, envie o arquivo novamente.`);
                return { handled: true };
            }

            // console.log(`[COMPROVANTE] Dados recebidos de ${userId}. Combinando com mídia pendente.`);

            let connection;
            try {
                const dadosDoCliente = parseMessageData(messageBody);
                const { CPF: cpf, 'JUROS MENSAL': juros_mensal, 'JUROS DIARIA': juros_diaria, 'ABATIMENTO': abatimento, 'QUITACAO': quitacao, 'PARCELA': parcela, 'OBS': obs } = dadosDoCliente;

                if (!cpf) {
                    return msg.reply(`⚠️ Olá *${nomeContato}*! Parece que o CPF não foi informado. Para que eu possa continuar, preciso que você o envie junto com os outros dados.\n\nO formato deve ser este: \n\`CPF: 123.456.789-00\``);
                }

                if (
                    
                    juros_mensal == null &&
                    juros_diaria == null &&
                    abatimento == null &&
                    quitacao == null &&
                    quitacao == null &&
                    parcela == null 
                ) {
                    return msg.reply(`❌ Olá *${nomeContato}*! \nÉ obrigatório fornecer ao menos um dos seguintes valores:\n\n- JUROS MENSAL:\n- JUROS DIARIA:\n- ABATIMENTO:\n- QUITACAO:\n- PARCELA:`);
                }

                connection = await pool.getConnection();
                const resultado = await verificarClienteExiste(cpf);
                if (!resultado.existe) {
                    return msg.reply(`❌ Olá *${nomeContato}*! \nCPF: *${cpf}* não encontrado no sistema.`);
                }

                await msg.reply(`🛠️ Processando comprovante...\nNome: *${resultado.nome_cliente}*`);
                const fileBuffer = Buffer.from(attachmentData.data, 'base64');
                let textoExtraido = '';

                if (attachmentData.mimetype.startsWith('image/')) {
                    textoExtraido = await readTextFromImage(fileBuffer);
                } else if (attachmentData.mimetype === 'application/pdf') {
                    textoExtraido = (await pdf(fileBuffer)).text;
                } else {
                    return msg.reply(`❌ Olá *${nomeContato}*! \nTipo de arquivo não suportado. Envie uma imagem ou PDF.`);
                }

                if (!textoExtraido || textoExtraido.trim() === '' ) {
                    return msg.reply(`❌ Olá *${nomeContato}*! \nNão consegui extrair texto do arquivo. Tente um com melhor qualidade.`);
                }

                console.debug(`TextoExtraido: "${textoExtraido}"`);
                const dadosComprovante = parseComprovanteText(textoExtraido);

                const dadosFormatados = JSON.stringify(dadosComprovante, null, 2);
                console.debug("dadosComprovante:", dadosComprovante);

                // if (dadosComprovante.valor === null|| dadosComprovante.data === null) {
                //     return msg.reply(`❌ Olá *${nomeContato}*! \nNão consegui extrair texto do arquivo. Tente um com melhor qualidade.`);
                // }

                let resposta = `✅ Olá *${nomeContato}*! \nDados extraídos do comprovante:\n\n👤 *Nome:* ${dadosComprovante.nome || 'Não encontrado'}\n💰 *Valor:* R$ ${dadosComprovante.valor || 'Não encontrado'}\n📅 *Data:* ${dadosComprovante.data || 'Não encontrada'}`;
                await msg.reply(resposta);

                const uploadedFile = {
                    name: attachmentData.filename || `${uuidv4()}.${mime.extension(attachmentData.mimetype)}`,
                    data: fileBuffer,
                    mimetype: attachmentData.mimetype
                };

                const result = await salvarComprovante(resultado.id_solicitacao, uploadedFile, dadosComprovante.data, juros_diaria, juros_mensal, dadosComprovante.valor, dadosComprovante.nome, abatimento, quitacao, parcela, obs);

                if (result.success) {
                    await msg.reply(`✅ Olá *${nomeContato}*! \n Comprovante processado com sucesso!`);
                    pendingMedia.delete(userId);
                    // userSessions.delete(userId);
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
        // userSessions.delete(userId);
        pendingMedia.delete(userId);
        return { handled: true };
    }

    return { handled: false }; // Indica que a mensagem não foi tratada por este fluxo
}


// --- FUNÇÕES AUXILIARES (movidas para cá) ---

// function parseComprovanteText(text) {
//     const data = { valor: null, nome: null, data: null };
//     const valorPatterns = [/VALOR\s*:\s*([\d.,]+)/i, /R\$\s+([\d.,]+)/i, /Valor\s*[:\s\n]*R\$\s*([\d.,]+)/i, /Valor\s+R\$\s*([\d.,]+)/i, /Valor\s*da\s*Transferência\s*[:\s\n]*R\$\s*([\d.,]+)/i, /VALOR\s*[:\s\n]*R\$\s*([\d.,]+)/i, /(?:\n|^)\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:\n|$)/, /R\$\s*([\d.,]+)/];
//     const nomePatterns = [/\d{4}\s+\d{4}\s+\d{10}-\d\s*\n([A-ZÀ-Ú\s]+)/i, /\n([A-ZÀ-Ú\s]+)\nVALOR/i, /dados da conta debitada\s*[\n\s]*nome\s+([A-Za-zÀ-ú\s]+)/i, /Dados\s+de\s+quem\s+pagou\s*[\n\s]*Nome:\s*([A-Za-zÀ-ú\s]+)/i, /Quem\s*pagou\s*[\n\s]*Nome\s+([A-Za-zÀ-ú\s]+)/i, /(?:\n|^)\s*De\s*\n([\s\S]+?)\n\s*CPF:/i, /Origem\s*[\n\s]*Nome\s+([A-Za-zÀ-ú\s]+)/i, /De\s*[\n:]\s*([A-Za-zÀ-ú\s]+)/, /Pagador\s*[:\n]\s*([A-Za-zÀ-ú\s]+)/i, /Nome\s*do\s*Pagador\s*[:\n]\s*([A-Za-zÀ-ú\s]+)/i];
//     const dataPatterns = [/(\d{2}\/[A-Z]{3}\/\d{4})/i, /realizado em\s*(\d{2}\/\d{2}\/\d{4})/i, /(\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4})/i, /(\d{1,2}\/[a-z]{3}\/\d{4})/i, /(\d{1,2}\s+[A-ZÇ-ú]+\s+\d{4})/i, /(\d{2}\/\d{2}\/\d{4})/, /Data\s*da\s*Transação\s*[:\n\s]*(\d{2}\/\d{2}\/\d{4})/i, /Realizada\s*em\s*(\d{2}\/\d{2}\/\d{4})/i];

//     function findMatch(patterns, text) {
//         for (const pattern of patterns) {
//             const match = text.match(pattern);
//             if (match && match[1]) return match[1].replace(/(\r\n|\n|\r)/gm, " ").trim();
//         }
//         return null;
//     }

//     data.valor = findMatch(valorPatterns, text);
//     let nomeBruto = findMatch(nomePatterns, text);
//     if (nomeBruto) {
//         data.nome = nomeBruto.replace(/CPF$/i, '').replace(/Instituição NU PAGAMENTOS/i, '').trim();
//     }
//     data.data = normalizeDate(findMatch(dataPatterns, text));
//     return data;
// }

async function verificarClienteExiste(clientName) {
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            SELECT c.nome AS nome_cliente, s.id AS id_solicitacao FROM clientes c
                LEFT JOIN solicitacao s ON s.id_cliente = c.id
            WHERE REGEXP_REPLACE(c.cpf, '[^0-9]', '') = ? `;

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

// function normalizeDate(dateStr) {
//     if (!dateStr) return null;
//     const monthMap = { 'janeiro': '01', 'jan': '01', 'fevereiro': '02', 'fev': '02', 'março': '03', 'mar': '03', 'abril': '04', 'abr': '04', 'maio': '05', 'mai': '05', 'junho': '06', 'jun': '06', 'julho': '07', 'jul': '07', 'agosto': '08', 'ago': '08', 'setembro': '09', 'set': '09', 'outubro': '10', 'out': '10', 'novembro': '11', 'nov': '11', 'dezembro': '12', 'dez': '12' };
//     const lowerDateStr = dateStr.toLowerCase();
//     let match = lowerDateStr.match(/(\d{1,2})\s+(?:de\s+)?([a-zç]+)\s+(?:de\s+)?(\d{4})/);
//     if (match) {
//         const month = monthMap[match[2]];
//         if (month) return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
//     }
//     match = lowerDateStr.match(/(\d{1,2})\/([a-z]{3})\/(\d{4})/);
//     if (match) {
//         const month = monthMap[match[2]];
//         if (month) return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
//     }
//     match = lowerDateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
//     if (match) return `${match[3]}-${match[2]}-${match[1]}`;
//     return dateStr;
// }

function parseMessageData(textBody) {
     // NOVA FUNÇÃO AUXILIAR: Específica para limpar CPF
     function limparCPF(cpfStr) {
        if (!cpfStr || typeof cpfStr !== 'string') return null;
        // Remove tudo que não for um dígito (pontos, hífens, espaços, etc.)
        return cpfStr.replace(/[^\d]/g, '');
    }
    const data = {};
    // Converte todo o texto para maiúsculas no início.
    const lines = textBody.toUpperCase().split('\n');

    for (const line of lines) {
        const parts = line.split(':');
        if (parts.length > 1) { // Garante que há uma chave e um valor
            const key = parts[0].trim();
            // Pega o resto da linha como valor, caso o valor tenha ':'
            const valueStr = parts.slice(1).join(':').trim();

            if (key) { // Evita criar chaves vazias
                // ESTA É A LÓGICA CRÍTICA:
                // Se valueStr for um número, converte para Number.
                // Senão, mantém como texto (que já está em maiúsculas).
                // const finalValue = !isNaN(valueStr) && valueStr.trim() !== '' ? Number(valueStr) : valueStr;
                // data[key] = finalValue;
                if (key === 'CPF') {
                    // Se a chave é 'CPF', usa a função de limpeza de CPF
                    data[key] = limparCPF(valueStr);
                } else {
                    // Para todas as outras chaves, usa a lógica anterior
                    const finalValue = !isNaN(valueStr) && valueStr.trim() !== '' ? Number(valueStr) : valueStr;
                    data[key] = finalValue;
                }
            }
        }
    }
    return data;
}


/**
 * Analisa o texto extraído de um comprovante para extrair valor, nome do pagador e data.
 * @param {string} text O texto bruto extraído do comprovante.
 * @returns {{valor: number|null, nome: string|null, data: string|null}} Um objeto com os dados extraídos e normalizados.
 */
function parseComprovanteText(text) {

    // --- 1. FUNÇÕES AUXILIARES ---

    function findMatch(patterns, textToSearch) {
        for (const pattern of patterns) {
            const match = textToSearch.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
        return null;
    }

    function normalizeValor(valorStr) {
        if (!valorStr) return null;
        const cleanedStr = valorStr.replace(/\./g, '').replace(',', '.');
        return parseFloat(cleanedStr);
    }

    function normalizeDate(dateStr) {
        if (!dateStr) return null;
    
        let cleanedDateStr = dateStr.toUpperCase();
    
        // **LÓGICA ESSENCIAL PARA CORREÇÃO DE OCR**
        // Separa a data em partes (ex: "O6", "OUT", "2025")
        const parts = cleanedDateStr.split(' ');
        if (parts.length >= 3) {
            // Corrige apenas a primeira parte (o dia), trocando O por 0 e S por 5
            parts[0] = parts[0].replace(/O/g, '0').replace(/S/g, '5');
            // Remonta a string de data, agora corrigida. Ex: "06 OUT 2025"
            cleanedDateStr = parts.join(' ');
        }
    
        const months = {
            'JANEIRO': '01', 'FEVEREIRO': '02', 'MARÇO': '03', 'ABRIL': '04', 'MAIO': '05', 'JUNHO': '06',
            'JULHO': '07', 'AGOSTO': '08', 'SETEMBRO': '09', 'OUTUBRO': '10', 'NOVEMBRO': '11', 'DEZEMBRO': '12',
            'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06',
            'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12'
        };
    
        // Tenta corresponder a "DD de [Mês por extenso] de AAAA" (Mercado Pago)
        let match = cleanedDateStr.toLowerCase().match(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/);
        if (match) {
            const day = match[1].padStart(2, '0');
            const month = months[match[2]];
            const year = match[3];
            if (day && month && year) return `${year}-${month}-${day}`;
        }
    
        // Tenta corresponder a "DD MMM AAAA" (Nubank, Pan)
        match = cleanedDateStr.match(/(\d{2})\s+([A-Z]{3})\s+(\d{4})/);
        if (match) {
            const day = match[1];
            const month = months[match[2]];
            const year = match[3];
            if (day && month && year) return `${year}-${month}-${day}`;
        }
    
        // Tenta corresponder a "DD/MMM/AAAA" (PicPay)
        match = cleanedDateStr.match(/(\d{2})\/([A-Z]{3})\/(\d{4})/);
        if (match) {
            const day = match[1];
            const month = months[match[2]];
            const year = match[3];
            if (day && month && year) return `${year}-${month}-${day}`;
        }
        
        // Tenta corresponder a "DD/MM/AAAA" (Genérico)
        match = cleanedDateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (match) {
            return `${match[3]}-${match[2]}-${match[1]}`;
        }
    
        return null;
    }

    // --- 2. PADRÕES REGEX ---

    const valorPatterns = [
        /Pix enviado\s*R\$\s*([\d.,]+)/i, 
        /Valor pago\s*R\$\s*([\d.,]+)/i,
        /R\$\s*([\d.,]+)/i,
        /Valor\s+R\$\s*([\d.,]+)/i,            // Nubank
        /Pix enviado\s*R\$\s*([\d.,]+)/i,       // Inter
        /Valor pago\s*R\$\s*([\d.,]+)/i,        // Pan
        /Valor da transferência\s*R\$\s*([\d.,]+)/i, // BV
        /Valor\s+Data\s+R\$\s+([\d.,]+)/i,     // Caixa (PDF Texto)
        /VALOR\s*[:\s\n]*R\$\s*([\d.,]+)/i,      // Genérico
        /R\$\s*([\d.,]+)/i,                    // Mais Genérico (Mercado Pago)
    ];

    const nomePatterns = [
        /Dados do pagador\s+De\s+([\s\S]+?)\s+CPF/i,
        /Quem pagou\s+Nome\s+([\s\S]+?)\s+CPF\/CNPJ/i,
        // ... seus outros padrões
        /QUEM TRANSFERIU\s+Nome\s+([\s\S]+?)\s+CPF\/CNPJ/i,
        /Dados\s+do\s+pagad[oe]r\s+Nome\s+([\s\S]+?)\s+CPF/i,
        /\*\s+De\s+([\s\S]+?)\s+CPF/i,
        /Origem[\s\S]*?Nome\s+([\s\S]+?)\s+Instituição/i,
        /Quem pagou[\s\S]*?Nome\s+([A-ZÀ-Ú\s]+)/i,
        /Realizado por[\s\S]*?\n([A-ZÀ-Ú\s]+)\n\*{3}/i,
        /QUEM TRANSFERIU\s+Nome\s+([\s\S]+?)\s+CPF\/CNPJ/i,
        /Dados\s+do\s+pagad[oe]r\s+Nome\s+([\s\S]+?)\s+CPF/i,
        /\*\s+De\s+([\s\S]+?)\s+CPF/i,                                  // Mercado Pago
        /Dados\s+do\s+pagador\s+Nome\s+([\s\S]+?)\s+CPF/i,             // Caixa / Sicredi
        /Origem[\s\S]*?Nome\s+([\s\S]+?)\s+Instituição/i,               // Nubank
        /Quem pagou[\s\S]*?Nome\s+([A-ZÀ-Ú\s]+)/i,                      // Inter
        /Realizado por\s*(?:\n[A-Z]{2})?\n([A-Za-zÀ-ú\s]+)\n\*{3}/i,     // Pan (com iniciais)
        /De\s+([\s\S]+?)\n\*{3}/i,                                     // PicPay (De... ***)
        /(?:\n|^)\s*De\s*\n([\s\S]+?)\n\s*(?:CPF|CNPJ):/i,             // Padrão genérico
        /Pagador\s*[:\n]\s*([A-Za-zÀ-ú\s]+)/i,                         // Padrão genérico
    ];

    const dataPatterns = [
        // **PADRÃO FINAL E MAIS ROBUSTO PARA O BANCO INTER**
        /Data do pagamento[\s\S]*?(\d{2}\/\d{2}\/\d{4})/i,
        
        // Seus outros padrões de fallback
        /(\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4})/i,
        /(\d{2}\/[a-z]{3}\/\d{4})/i,
        /(\d{2}\/\d{2}\/\d{4})/,

        /(\d{1,2}\s+[A-Z]{3}\s+\d{4})/i,
        /([A-Z0-9]{2}\s+[A-Z]{3}\s+\d{4})/i,                          // Nubank (com erro OCR "OS SET" ou "O6 OUT")
        /Data\/Hora\s+(\d{2}\/\d{2}\/\d{4})/i,                        // Caixa (PDF Texto)
        /Realizada em\s+(\d{2}\/\d{2}\/\d{4})/i,                      // Sicredi
        /(\d{2}\/\d{2}\/\d{4})/,                                      // Genérico (deve ser o último

    ];

    // --- 3. EXTRAÇÃO E DEPURAÇÃO ---

    const rawValor = findMatch(valorPatterns, text);
    const rawNome = findMatch(nomePatterns, text);
    const rawData = findMatch(dataPatterns, text);

    // **FERRAMENTA DE DEPURAÇÃO CRUCIAL**
    // Esta linha mostrará no seu terminal exatamente o que o Regex da data capturou.
    console.log("DEBUG: String de data capturada (rawData):", rawData);

    // Limpeza final do nome
    let nomeLimpo = rawNome;
    if (nomeLimpo) {
        nomeLimpo = nomeLimpo.replace(/\s+/g, ' ').trim();
    }
    
    return {
        valor: normalizeValor(rawValor),
        nome: nomeLimpo,
        data: normalizeDate(rawData)
    };
}

// // --- Exemplo de uso ---
// const textoExemplo = "Juros mensal: R$100,00";
// const juros = extrairInteiro(textoExemplo);
// console.log(juros); // Saída: 100

module.exports = { handleComprovanteMessage };
