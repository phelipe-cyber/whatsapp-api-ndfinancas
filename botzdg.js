// server.js

// --- DEPENDÊNCIAS ---
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const http = require('http');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const path = require('path');
const axios = require('axios');

// --- SUAS DEPENDÊNCIAS DE SERVIÇO ---

const { handleComprovanteMessage } = require('./processa_comprovante');

const { handleCadastroMessage } = require('./cadastro_cliente');

// --- CONFIGURAÇÃO DO SERVIDOR ---
const port = process.env.PORT || 8000;
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// --- MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/", express.static(path.join(__dirname, "/")));

// --- VARIÁVEIS GLOBAIS DOS BOTS ---
const clientIds = ['BOT-ADM', 'BOT-COMPROVANTE'];
const clients = new Map();
const userSessions = new Map(); // Gerenciador de estado da conversa
const pendingMedia = new Map(); // NOVO: Mapa para guardar mídias pendentes
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 horas

// =========================================================
// ===== FLUXO DE CADASTRO =====
// =========================================================
const registrationSteps = [
    // { key: 'comprovanteResidencia', question: '1/10: Por favor, envie seu *comprovante de residência* atualizado (água, luz, fatura de cartão, etc.).', type: 'media' },
    // { key: 'videoResidencia', question: '2/10: Ótimo. Agora, envie um *vídeo da sua residência* (interno e externo).', type: 'media' },
    // { key: 'contratoLocacao', question: '3/10: Se você mora de aluguel, envie o *contrato de locação*. Caso contrário, digite "não tenho".', type: 'any' },
    // { key: 'documentoPessoal', question: '4/10: Envie uma foto do seu *documento* (RG, CPF ou CNH).', type: 'media' },
    // { key: 'selfieComDocumento', question: '5/10: Perfeito. Agora, envie uma *selfie segurando o mesmo documento* ao lado do seu rosto.', type: 'media' },
    // { key: 'comprovanteRenda', question: '6/10: Envie seu *comprovante de renda* atualizado (os 3 últimos holerites, se for CLT).', type: 'media' },
    // { key: 'dadosTrabalho', question: '7/10: Informe os *dados de onde você trabalha* (setor, horário, telefone, endereço e tempo de serviço).', type: 'text' },
    { key: 'nomeCompleto', question: '1/4: Nome Completo.', type: 'text' },
    { key: 'cep', question: '2/4: Para o endereço, por favor, digite seu *CEP* (apenas números).', type: 'text' },
    { key: 'numeroCasa', question: '3/4: Qual o *número* da sua residência?', type: 'text' },
    { key: 'complemento', question: '4/4: Para finalizar, digite o *complemento* (se houver). Caso não tenha, digite "Nenhum".', type: 'text' }
];

// =========================================================
// ===== ROTAS DA API =====
// =========================================================
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: __dirname });
});

// Suas rotas /send-message e /send-media continuam aqui...
// ...
// Rota para enviar mensagem de texto
app.post('/send-message', [
    body('clientId').notEmpty().withMessage('O clientId é obrigatório'),
    body('number').notEmpty().withMessage('O número (number) é obrigatório'),
    body('message').notEmpty().withMessage('A mensagem (message) é obrigatória')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ status: false, message: errors.mapped() });
    }

    const { clientId, number, message } = req.body;

    const selectedClient = clients.get(clientId);
    if (!selectedClient || selectedClient.connectionStatus !== 'Conectado') {
        return res.status(400).json({
            status: false,
            message: `Cliente '${clientId}' não encontrado ou não está conectado.`
        });
    }

    try {
        // Sua lógica original para formatar números brasileiros foi mantida
        let formattedNumber = number.replace(/\D/g, '');
        if (!formattedNumber.startsWith("55")) {
            formattedNumber = "55" + formattedNumber;
        }
        const numberDDD = formattedNumber.substr(2, 2);
        let finalNumber;
        if (parseInt(numberDDD) <= 30) {
            finalNumber = `${formattedNumber.substring(0, 4)}${formattedNumber.substring(4)}@c.us`;
        } else {
            finalNumber = `${formattedNumber}@c.us`;
        }

        const response = await selectedClient.sendMessage(finalNumber, message);
        res.status(200).json({
            status: true,
            message: `Mensagem enviada com sucesso pelo bot '${clientId}'`,
            response: response
        });
    } catch (err) {
        console.error(`[${clientId}] Erro ao enviar mensagem:`, err);
        res.status(500).json({ status: false, message: 'Falha ao enviar mensagem', error: err.message });
    }
});




// =========================================================
// ===== LÓGICA DO WHATSAPP E SOCKET.IO =====
// =========================================================

function broadcastStateUpdate(id) {
    const clientInstance = clients.get(id);
    if (clientInstance) {
        io.emit('bot_state_update', {
            id: id,
            connectionStatus: clientInstance.connectionStatus,
            botState: clientInstance.botState
        });
    }
}

const createClient = (id) => {
    console.log(`[${id}] Preparando cliente...`);
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: id }),
        puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.botState = 'inactive';
    client.connectionStatus = 'Offline';
    clients.set(id, client);

    client.on('qr', (qr) => {
        client.connectionStatus = 'Aguardando QR Code';
        qrcode.toDataURL(qr, (err, url) => {
            if (err) return console.error(`[${id}] Erro ao gerar QR Code:`, err);
            io.emit('qr_code', { id: id, url: url });
            broadcastStateUpdate(id);
        });
    });

    client.on('ready', () => {
        client.connectionStatus = 'Conectado';
        client.botState = 'active';
        broadcastStateUpdate(id);
    });

    // ===== LÓGICA DE MENSAGENS ATUALIZADA =====
    client.on('message', async msg => {
        const clientInstance = clients.get(id);
        if (clientInstance.botState !== 'active' || (await msg.getChat()).isGroup) return;

        const userId = msg.from;
        const nomeContato = msg._data.notifyName;
        const now = Date.now();
        const messageBody = msg.body.trim();
        console.log(`\n--- Nova Mensagem de ${nomeContato} ---`);
        console.log(`Conteúdo: "${messageBody}"`);

        // --- LÓGICA DE MENU (se não for parte do fluxo de comprovante) ---
        const session = userSessions.get(userId);
        console.log('1. Sessão encontrada no início:', session);
        const isNewConversation = !session || (now - session.lastMessageTimestamp > SESSION_TIMEOUT_MS);
        console.log('2. O resultado de "isNewConversation" é:', isNewConversation);

        if (messageBody.toLowerCase() === '!cancelar') {
            if (session) {
                userSessions.delete(userId);
                await msg.reply('✅ Ação cancelada.');
            } else {
                await msg.reply('Não há uma ação em andamento para cancelar.');
            }
            return;
        }

        // --- LÓGICA 1: FLUXO DE CADASTRO (MAIOR PRIORIDADE) ---
        if (session && (session.state === 'registering' || session.state === 'confirming_address')) {
            // Passa o controle para o manipulador de cadastro
            await handleCadastroMessage({ msg, session, userSessions, registrationSteps });
            return; // Finaliza o processamento aqui
        }

        if (isNewConversation && messageBody.toLowerCase() == '!ping') {
            console.log('3. LÓGICA: Entrou no bloco de NOVA CONVERSA.');
            const textMenu = `Olá *${nomeContato}*! 👋\n\nBem-vindo ao nosso atendimento.\n\n*Responda com o número da opção desejada:*\n\n*1* - Saber mais sobre o empréstimo\n*2* - Enviar Comprovante\n*3* - Finalizar Conversa\n*4* - Solicitar Empréstimo`;
            await client.sendMessage(userId, textMenu);
            userSessions.set(userId, { lastMessageTimestamp: now, state: 'menu' });
            console.log('4. Sessão criada/atualizada. Finalizando processamento para esta mensagem.');
            return;
        }

        if (session) {
            console.log('5. LÓGICA: Entrou no bloco de CONVERSA ATIVA.');
            session.lastMessageTimestamp = now;
            userSessions.set(userId, session);
            console.log('6. Timestamp atualizado com sucesso.');

        }

        // --- LÓGICA 2: FLUXO DE COMPROVANTE ---
        const comprovanteResult = await handleComprovanteMessage({ msg, session, userSessions, pendingMedia });
        if (comprovanteResult.handled) {
            return; // Se o manipulador de comprovante tratou a mensagem, finaliza aqui
        }

        if (session && messageBody === '1') {
            const textMenu = `*EXPLICATIVO SOBRE O EMPRÉSTIMO*\n\n*VOCÊ JÁ PEGA DINHEIRO A JUROS COM ALGUÉM?💰*\n⚠️ *LEIA COM ATENÇÃO!* ⚠️\nOlá *${nomeContato}*!\nTrabalhamos da seguinte forma:\nEmpréstimo - valor inicial R$500,00.\n*(SUJEITO A ANÁLISE).*\n*LEIA COM ATENÇÃO*\nOlá,\nEntão, trabalhamos da seguinte forma:\n*PARA VALORES SUPERIORES A 2MIL, NECESSÁRIO UMA GARANTIA NO DOBRO DO VALOR*\n• O juros é de 30%, caso você pegue 1000 no próximo mês você pagará 1300 ou o juros + quanto vc quiser abater da dívida...\n• Se vc pegar só o juros você continuará devendo 1000 e o juros permanecerá de 300.\n• Se você mandar algum valor a mais do seu juros mensal, abatemos no capital.\nSeu Juros mensal ficará conforme o valor do seu Capital.\n*O dia de atraso no pagamento custa R$ 50.*\nSe o seu dia é dia 13 e vc só paga dia 15, vc tem que pegar R$ 100 *a mais* da sua parcela.\n*CASO SEU VENCIMENTO CAIA NO FINAL DE SEMANA OU FERIADO, DEVERÁ EFETUAR O PAGAMENTO NORMALMENTE.*\n*CLT (com registro na carteira de trabalho)*\n- Preciso dos seguintes dados:\n* Comprovante de residência atualizado em seu nome. *(ÁGUA, LUZ, TELEFONE OU FATURA DE CARTÃO DE CRÉDITO)*\n* Vídeo da Residência interno e externo!\n* Contrato de Locação de imóvel (caso more de aluguel);\n* Documento *(RG, CPF OU CNH)*;\n* Documento com foto em uma *SELF*.\n* Ter no mínimo *TRÊS* meses de registro em carteira e enviar o comprovante de renda atualizado *(OS TRÊS ÚLTIMOS HOLERITES)*.\n* Todos os dados de onde você trabalha (*setor, horário, telefone e endereço, tempo de serviço*).\n*OBS: LEMBRANDO QUE NÃO TRABALHAMOS COM PARCELAS, SOMENTE COM JUROS! ENTÃO FIQUEM ATENTOS A TODAS INFORMAÇÕES !!!!!!*\n*ATENÇÃO!*\n🚨 *Após a análise dos documentos, marcaremos a visita na sua residência e no seu serviço (a visita serve para você tirar suas dúvidas e assinar um termo de responsabilidade).* 🚨\n*Caso não pague ou não responda o escritório, o setor de cobrança será acionado automaticamente e você será obrigado a deixar algum objeto eletrônico como forma de garantia. Após efetuar o pagamento, devolveremos o objeto.*\n*Se não estiver de acordo, basta não dar continuidade.*`;

            await client.sendMessage(userId, textMenu);
            const foto = MessageMedia.fromFilePath('./images/selfdocumento.jpeg');
            client.sendMessage(userId, foto)

        } else if (session && messageBody === '2') {
            await msg.reply(`Ok, *${nomeContato}*! 👍\n\nPara começar, basta me enviar a imagem ou PDF do comprovante.`);
        } else if (session && messageBody === '3' || messageBody.toLowerCase() === '!finalizar') {
            userSessions.delete(userId);
            await msg.reply(`✅ Olá *${nomeContato}*, sua conversa foi finalizada.`);
        } else if (session && messageBody === '4') {
            const firstStep = registrationSteps[0];
            await msg.reply(`Ok, vamos iniciar seu cadastro. Você pode digitar \`!cancelar\` a qualquer momento para parar.\n\n${firstStep.question}`);
            userSessions.set(userId, {
                lastMessageTimestamp: now,
                state: 'registering',
                step: 0,
                collectedData: {}
            });
        }


    });

    client.on('disconnected', (reason) => {
        client.connectionStatus = 'Offline';
        client.botState = 'inactive';
        broadcastStateUpdate(id);
    });

    client.initialize().catch(err => {
        console.error(`[${id}] Falha na inicialização automática:`, err);
        client.connectionStatus = 'Falha';
        broadcastStateUpdate(id);
    });
};

clientIds.forEach(id => createClient(id));

io.on('connection', async (socket) => {
    console.log('Navegador conectado:', socket.id);
    socket.emit('client_list', clientIds);

    for (const [id, clientInstance] of clients.entries()) {
        try {
            const state = await clientInstance.getState();
            if (state === 'CONNECTED') {
                clientInstance.connectionStatus = 'Conectado';
                clientInstance.botState = 'active';
            } else {
                clientInstance.connectionStatus = 'Offline';
                clientInstance.botState = 'inactive';
            }
        } catch (e) {
            clientInstance.connectionStatus = 'Offline';
            clientInstance.botState = 'inactive';
        }
        broadcastStateUpdate(id);
    }

    socket.on('initialize_client', (data) => {
        const clientInstance = clients.get(data.id);
        if (clientInstance && clientInstance.connectionStatus === 'Offline') {
            clientInstance.connectionStatus = 'Inicializando';
            broadcastStateUpdate(data.id);
            clientInstance.initialize();
        }
    });

    socket.on('toggle_bot_state', (data) => {
        const clientInstance = clients.get(data.id);
        if (clientInstance) {
            clientInstance.botState = data.state;
            broadcastStateUpdate(data.id);
        }
    });

    socket.on('disconnect_client', async (data) => {
        const clientInstance = clients.get(data.id);
        if (clientInstance && clientInstance.connectionStatus === 'Conectado') {
            await clientInstance.logout();
        }
    });
});

// =========================================================
// ===== INICIALIZAÇÃO DO SERVIDOR =====
// =========================================================
server.listen(port, () => {
    console.log(`Aplicação rodando na porta: ${port}. Acesse http://localhost:${port}`);
});
