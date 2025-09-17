// cadastro_handler.js
const axios = require('axios');

// Função de delay
const delay = ms => new Promise(res => setTimeout(res, ms));

// Esta função é chamada quando o bot sabe que o usuário está no meio de um cadastro.
async function handleCadastroMessage({ msg, session, userSessions, registrationSteps }) {
    const userId = msg.from;
    const messageBody = msg.body.trim();
    const totalSteps = registrationSteps.length;

    try {
        // --- LÓGICA DE CONFIRMAÇÃO FINAL  ---
        if (session.state === 'final_confirmation') {
            if (messageBody.toLowerCase() === 'sim') {
                await msg.reply('⏳ Confirmado! Salvando o seu cadastro, aguarde um momento...');
                const result = await salvarCadastroCliente(userId, session.collectedData);
                if (result.success) {
                    await msg.reply('✅ Cadastro finalizado com sucesso! Analisaremos os seus dados e entraremos em contato em breve.');
                } else { 
                    throw new Error("Falha ao salvar no banco de dados.");
                }
                userSessions.delete(userId);
            } else if (messageBody.toLowerCase() === 'não') {
                await msg.reply('Ok, vamos recomeçar o cadastro.');
                // Reinicia o fluxo de cadastro
                const firstStep = registrationSteps[0];
                const questionText = firstStep.question.replace(/\d+\/\d+:/, `1/${totalSteps}:`);
                await msg.reply(`Você pode digitar \`!cancelar\` a qualquer momento para parar.\n\n${questionText}`);
                userSessions.set(userId, {
                    lastMessageTimestamp: Date.now(),
                    state: 'registering',
                    step: 0,
                    collectedData: {}
                });
            } else {
                await msg.reply('Por favor, responda apenas com "sim" ou "não".');
            }
            return;
        }

        // --- LÓGICA DE CONFIRMAÇÃO DE ENDEREÇO ---
        if (session.state === 'confirming_address') {
            // ... (código sem alteração)
            if (messageBody.toLowerCase() === 'sim') {
                session.state = 'registering';
                session.step++;
                const nextStep = registrationSteps[session.step];
                const questionText = nextStep.question.replace(/\d+\/\d+:/, `${session.step + 1}/${totalSteps}:`);
                await delay(1500);
                await msg.reply(`Ótimo! Agora, por favor, informe o próximo dado.\n\n${questionText}`);
                userSessions.set(userId, session);
            } else if (messageBody.toLowerCase() === 'não') {
                session.state = 'registering';
                const currentStep = registrationSteps[session.step];
                const questionText = currentStep.question.replace(/\d+\/\d+:/, `${session.step + 1}/${totalSteps}:`);
                await delay(1500);
                await msg.reply(`Ok, vamos tentar novamente.\n\n${questionText}`);
                userSessions.set(userId, session);
            } else {
                await msg.reply('Por favor, responda apenas com "sim" ou "não".');
            }
            return;
        }

        // --- LÓGICA PRINCIPAL DE CADASTRO ---
        if (session.state === 'registering') {
            const currentStep = registrationSteps[session.step];

            // ... (lógica do CEP sem alteração)
            if (currentStep.key === 'cep') {
                const cep = messageBody.replace(/\D/g, '');
                if (cep.length !== 8) {
                    return msg.reply('CEP inválido. Por favor, digite um CEP com 8 números.');
                }
                try {
                    await msg.reply(`Buscando endereço para o CEP ${cep}...`);
                    const response = await axios.get(`https://viacep.com.br/ws/${cep}/json/`, { timeout: 10000 });
                    const address = response.data;
                    if (address.erro) { throw new Error('CEP não encontrado pela API.'); }
                    
                    const addressString = `*Rua:* ${address.logradouro}\n*Bairro:* ${address.bairro}\n*Cidade:* ${address.localidade} - ${address.uf}`;
                    
                    session.collectedData.cep = cep;
                    session.collectedData.partialAddress = address;
                    session.state = 'confirming_address';
                    userSessions.set(userId, session);
                    
                     // Delay antes da pergunta de confirmação
                    await msg.reply(`Encontrei este endereço:\n\n${addressString}\n\nEstá correto? Responda com "sim" ou "não".`);
                } catch (error) {
                    console.error(`[ERRO API CEP] Falha ao buscar CEP ${cep}:`, error);
                    await msg.reply('Não foi possível encontrar o endereço para este CEP. Por favor, verifique e tente novamente.');
                }
                return;
            }
            
            const isMedia = msg.hasMedia;
            const isText = !msg.hasMedia;
            const isValidType = (currentStep.type === 'media' && isMedia) || (currentStep.type === 'text' && isText) || currentStep.type === 'any';

            if (!isValidType) {
                return msg.reply(`❌ Resposta inválida. Para esta etapa, envie: *${currentStep.type === 'media' ? 'um arquivo' : 'um texto'}*.`);
            }
            
            if (isMedia) {
                const attachmentData = await msg.downloadMedia();
                if (!attachmentData) {
                    return msg.reply("❌ Ocorreu um erro ao baixar seu arquivo. Por favor, tente enviá-lo novamente.");
                }
                session.collectedData[currentStep.key] = attachmentData;
            } else {
                session.collectedData[currentStep.key] = messageBody;
            }

            session.step++;

            if (session.step < registrationSteps.length) {
                const nextStep = registrationSteps[session.step];
                const questionText = nextStep.question.replace(/\d+\/\d+:/, `${session.step + 1}/${totalSteps}:`);
                await delay(1500);
                await msg.reply(questionText);
                userSessions.set(userId, session);
            } else {
                // ETAPA FINAL: Monta o resumo e pede a confirmação
                await delay(1500);
                
                let summary = '📝 *Resumo do seu Cadastro*\n\nPor favor, confirme se os dados abaixo estão corretos:\n\n';
                
                for (let i = 0; i < registrationSteps.length; i++) {
                    const step = registrationSteps[i];
                    const data = session.collectedData[step.key];
                    const questionTitle = step.question.substring(step.question.indexOf(':') + 1).trim();
                    
                    summary += `*${i + 1}. ${questionTitle}*\n`;
                    
                    if (step.type === 'media') {
                        summary += `➡️ [Arquivo de Mídia Enviado]\n\n`;
                    } else if (step.key === 'cep') {
                        const addr = session.collectedData.partialAddress;
                        summary += `➡️ ${addr.logradouro}, ${session.collectedData.numeroCasa}, ${session.collectedData.complemento} - ${addr.bairro}, ${addr.localidade} - ${addr.uf}\n\n`;
                        // Pula as próximas duas etapas, pois já foram incluídas aqui
                        i += 2; 
                    } else {
                        summary += `➡️ ${data}\n\n`;
                    }
                }
                summary += 'Se tudo estiver correto, responda com *"sim"*. Se precisar corrigir algo, responda com *"não"* para recomeçar.';

                session.state = 'final_confirmation';
                userSessions.set(userId, session);

                await msg.reply(summary);
            }
        }
    } catch (error) {
        console.error(`[ERRO NO CADASTRO] Usuário ${userId}:`, error);
        await msg.reply("Ocorreu um erro inesperado durante o cadastro. A sessão foi encerrada. Por favor, comece novamente.");
        userSessions.delete(userId);
    }
}

// Função para salvar os dados coletados no banco de dados
async function salvarCadastroCliente(userId, collectedData) {
    console.log(`Salvando cadastro para o usuário: ${userId}`);
    
    const address = collectedData.partialAddress;
    const fullAddress = `${address.logradouro}, ${collectedData.numeroCasa}, ${collectedData.complemento} - ${address.bairro}, ${address.localidade} - ${address.uf}, CEP: ${collectedData.cep}`;
    
    collectedData.enderecoCompleto = fullAddress;
    console.log('Dados finais a serem salvos:', collectedData);
    
    // Aqui você implementa a lógica para salvar no banco de dados e fazer upload dos arquivos
    
    return { success: true };
}

module.exports = { handleCadastroMessage };
