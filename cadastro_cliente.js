// cadastro_handler.js
const axios = require('axios');

// Esta função é chamada quando o bot sabe que o usuário está no meio de um cadastro.
// Ela recebe um objeto com tudo o que precisa para não depender da ordem dos parâmetros.
async function handleCadastroMessage({ msg, session, userSessions, registrationSteps }) {
    const userId = msg.from;
    const messageBody = msg.body.trim();

    try {
        // --- LÓGICA DE CONFIRMAÇÃO DE ENDEREÇO ---
        if (session.state === 'confirming_address') {
            if (messageBody.toLowerCase() === 'sim') {
                session.state = 'registering';
                session.step++;
                const nextStep = registrationSteps[session.step];
                await msg.reply(`Ótimo! *${nomeContato}*! \nAgora, por favor, informe o próximo dado.\n\n${nextStep.question}`);
                userSessions.set(userId, session);
            } else if (messageBody.toLowerCase() === 'não') {
                session.state = 'registering';
                const currentStep = registrationSteps[session.step];
                await msg.reply(`Ok, *${nomeContato}*! \nvamos tentar novamente.\n\n${currentStep.question}`);
                userSessions.set(userId, session);
            } else {
                await msg.reply(`❌ Olá *${nomeContato}*! \nPor favor, responda apenas com "sim" ou "não".`);
            }
            return; // Finaliza aqui
        }

        // --- LÓGICA PRINCIPAL DE CADASTRO ---
        if (session.state === 'registering') {
            const currentStep = registrationSteps[session.step];

            // Lógica especial para o CEP
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
                    session.state = 'confirming_address'; // Muda o estado para aguardar confirmação
                    userSessions.set(userId, session);

                    await msg.reply(`✅ Olá *${nomeContato}*! \nEncontrei este endereço:\n\n${addressString}\n\nEstá correto? Responda com "sim" ou "não".`);
                } catch (error) {
                    console.error(`[ERRO API CEP] Falha ao buscar CEP ${cep}:`, error);
                    await msg.reply(`❌ Olá *${nomeContato}*! \nNão foi possível encontrar o endereço para este CEP. Por favor, verifique e tente novamente.`);
                }
                return; // Finaliza aqui
            }

            // Validação do tipo de mensagem
            const isMedia = msg.hasMedia;
            const isText = !msg.hasMedia;
            const isValidType = (currentStep.type === 'media' && isMedia) || (currentStep.type === 'text' && isText) || currentStep.type === 'any';

            if (!isValidType) {
                return msg.reply(`❌ Olá *${nomeContato}*! \n Resposta inválida. Para esta etapa, envie: *${currentStep.type === 'media' ? 'um arquivo' : 'um texto'}*.`);
            }
            
            // Coleta o dado
            if (isMedia) {
                const attachmentData = await msg.downloadMedia();
                if (!attachmentData) {
                    return msg.reply(`❌ Olá *${nomeContato}*! \nOcorreu um erro ao baixar seu arquivo. Por favor, tente enviá-lo novamente.`);
                }
                session.collectedData[currentStep.key] = attachmentData;
            } else {
                session.collectedData[currentStep.key] = messageBody;
            }

            // Avança para a próxima etapa
            session.step++;

            if (session.step < registrationSteps.length) {
                const nextStep = registrationSteps[session.step];
                await msg.reply(nextStep.question);
                userSessions.set(userId, session);
            } else {
                // Finaliza o cadastro
                await msg.reply('⏳ Finalizando seu cadastro, aguarde um momento...');
                const result = await salvarCadastroCliente(userId, session.collectedData);
                if (result.success) {
                    await msg.reply(`✅ Olá *${nomeContato}*! \nCadastro finalizado com sucesso! Analisaremos seus dados e entraremos em contato em breve.`);
                } else { 
                    throw new Error("Falha ao salvar no banco de dados.");
                }
                userSessions.delete(userId);
            }
        }
    } catch (error) {
        console.error(`[ERRO NO CADASTRO] Usuário ${userId}:`, error);
        await msg.reply(`❌ Olá *${nomeContato}*! \nOcorreu um erro inesperado durante o cadastro. A sessão foi encerrada. Por favor, comece novamente.`);
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
