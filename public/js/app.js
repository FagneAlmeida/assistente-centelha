function startApp() {
    const auth = firebase.auth();
    const db = firebase.firestore();
    const { serverTimestamp } = firebase.firestore.FieldValue;
    
const config = {
    whatsappNumber: "5567999271603",
    // MUDANÇA AQUI: URL atualizada para o Firebase Functions
    backendApiUrl: "https://us-central1-oficina-fg-motos.cloudfunctions.net/callGemini",
    officeAddress: "Av. Fabio Zahran, 6628, Vila Carvalho, Campo Grande-MS",
    googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=Oficina+FG+Motos+Av.+Fabio+Zahran+6628"
};    
    const systemPrompt = `Você é a Centelha, uma assistente virtual especialista em motocicletas da "Oficina FG Motos". Sua personalidade é amigável, técnica e eficiente. Seu objetivo é coletar NOME, MODELO DA MOTO e o PROBLEMA. RESPONDA SEMPRE EM FORMATO JSON VÁLIDO com a seguinte estrutura: {"responseText": "Sua resposta conversacional para o usuário.", "conversationState": "STATE", "extractedData": { "name": "...", "moto": "...", "problem": "..." }, "quickReplies": ["Opção 1", "Opção 2"]}. REGRAS: 1. 'conversationState': Mude o estado: ASKING_FOR_DATA, READY_FOR_DIAGNOSIS, GENERAL_QUESTION, PROVIDING_LOCATION. 2. 'extractedData': Preencha com os dados da MENSAGEM MAIS RECENTE. Se o usuário disser "Meu nome é [NOME]", extraia APENAS o [NOME] para o campo "name". Se o usuário disser apenas um nome, use-o diretamente. Mantenha os dados já coletados. 3. 'quickReplies': Ofereça sugestões ÚTEIS. 4. 'responseText': Seja claro. Peça um dado de cada vez. 5. NUNCA use markdown. 6. Se o usuário perguntar o endereço, responda com as informações da oficina, use o conversationState "PROVIDING_LOCATION" e na responseText inclua o texto: "Nosso endereço é: ${config.officeAddress}. [BUTTON:Ver no Mapa|${config.googleMapsUrl}]". 7. Fale exclusivamente em Português do Brasil. INFORMAÇÕES DA OFICINA: WhatsApp: ${config.whatsappNumber}. Horário: Segunda a Sexta, das 8h às 18h.`;

    const elements = {
        chatInput: document.getElementById('chat-input'), sendBtn: document.getElementById('send-btn'),
        chatMessages: document.getElementById('chat-messages'), chatWindow: document.getElementById('chat-window'),
        newChatBtn: document.getElementById('new-chat-btn'), quickRepliesContainer: document.getElementById('quick-replies-container'),
        modal: { container: document.getElementById('confirmation-modal'), text: document.getElementById('modal-text'), cancelBtn: document.getElementById('cancel-btn'), confirmBtn: document.getElementById('confirm-btn') }
    };

    let appState = {
        isAuthReady: false, userId: null, chatId: null, isThinking: false,
        conversationHistory: [], customerData: { name: '', moto: '', problem: '', preAnalysis: '' },
        unsubscribe: null, 
        appId: typeof __app_id !== 'undefined' ? __app_id : 'centelha-e931b',
        renderedMessageIds: new Set()
    };
    
    function toggleThinking(isThinking) {
        appState.isThinking = isThinking;
        elements.chatInput.disabled = isThinking;
        elements.sendBtn.disabled = isThinking;
        elements.chatInput.placeholder = isThinking ? "Centelha está pensando..." : "Digite sua mensagem...";
        const typingIndicator = document.querySelector('.typing-indicator-container');
        if (typingIndicator) typingIndicator.remove();
        if (isThinking) {
            const indicatorHTML = `<div class="w-full flex justify-start typing-indicator-container chat-message"><div class="bg-gray-700 text-gray-800 p-3 rounded-2xl rounded-bl-lg max-w-sm"><div class="typing-indicator"><span></span><span></span><span></span></div></div></div>`;
            elements.chatMessages.insertAdjacentHTML('beforeend', indicatorHTML);
            scrollToBottom();
        } else {
            elements.chatInput.focus();
        }
    }
    
    function addMessageToUI(sender, text, messageId) {
        if (messageId && appState.renderedMessageIds.has(messageId)) return;
        if (messageId) appState.renderedMessageIds.add(messageId);

        const typingIndicator = document.querySelector('.typing-indicator-container');
        if (typingIndicator) typingIndicator.remove();

        const messageContainer = document.createElement('div');
        messageContainer.className = `w-full flex chat-message ${sender === 'user' ? 'justify-end' : 'justify-start'}`;
        
        const buttonRegex = /\[BUTTON:([^|]+)\|([^\]]+)\]/g;
        const copyButtonRegex = /\[COPYBUTTON:([^|]+)\|([^\]]+)\]/g;
        let sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        let htmlText = sanitizedText
            .replace(buttonRegex, (match, buttonText, url) => {
                const safeUrl = url.trim();
                if (safeUrl.startsWith('https://') || safeUrl.startsWith('http://')) {
                    // CORREÇÃO: Removido encodeURI() daqui. A URL já vem corretamente codificada
                    // da função generateWhatsAppLink(). Aplicar a codificação novamente causava o problema de "double encoding".
                    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="chat-action-button bg-gradient-to-br from-yellow-400 to-orange-500 text-white">${buttonText}</a>`;
                }
                console.warn('Attempt to render button with invalid URL was blocked:', safeUrl);
                return `[Botão com link inválido]`;
            })
            .replace(copyButtonRegex, (match, buttonText, textToCopy) => `<button data-copytext="${textToCopy.replace(/"/g, '&quot;')}" class="chat-action-button bg-gray-600 text-white">${buttonText}</button>`);

        const messageBubble = sender === 'user'
            ? `<div class="bg-gradient-to-br from-yellow-400 to-orange-500 text-white p-3 rounded-2xl rounded-br-lg max-w-md shadow-md"><p>${htmlText}</p></div>`
            : `<div class="bg-gray-700 text-gray-100 p-3 rounded-2xl rounded-bl-lg max-w-md shadow-md"><p>${htmlText}</p></div>`;
        
        messageContainer.innerHTML = messageBubble;
        elements.chatMessages.appendChild(messageContainer);
        scrollToBottom();
    }

    function renderQuickReplies(replies = []) {
        elements.quickRepliesContainer.innerHTML = '';
        if (!replies || replies.length === 0) return;
        replies.forEach(reply => {
            const button = document.createElement('button');
            button.textContent = reply;
            button.className = "px-3 py-1.5 bg-gray-700 text-gray-200 rounded-full text-sm hover:bg-gray-600 transition-colors";
            button.onclick = () => { elements.chatInput.value = reply; handleSend(); };
            elements.quickRepliesContainer.appendChild(button);
        });
    }
    
    function scrollToBottom() { elements.chatWindow.scrollTop = elements.chatWindow.scrollHeight; }
    
    function showModal(text, onConfirm) {
        elements.modal.text.textContent = text;
        elements.modal.container.classList.remove('hidden');
        elements.modal.container.classList.add('flex');
        const newConfirmBtn = elements.modal.confirmBtn.cloneNode(true);
        elements.modal.confirmBtn.parentNode.replaceChild(newConfirmBtn, elements.modal.confirmBtn);
        elements.modal.confirmBtn = newConfirmBtn;
        elements.modal.confirmBtn.onclick = () => { onConfirm(); hideModal(); };
    }

    function hideModal() {
        elements.modal.container.classList.add('hidden');
        elements.modal.container.classList.remove('flex');
    }
    
    async function saveMessage(sender, text) {
        if (!appState.isAuthReady || !appState.chatId || !db) return null;
        try {
            const messagesColRef = db.collection(`artifacts/${appState.appId}/users/${appState.userId}/chats/${appState.chatId}/messages`);
            const docRef = await messagesColRef.add({ 
                sender, 
                text, 
                createdAt: serverTimestamp() 
            });
            return docRef.id;
        } catch (error) {
            console.error("Erro ao salvar mensagem:", error);
            return null;
        }
    }
    
    function listenToMessages() {
        if (appState.unsubscribe) appState.unsubscribe();
        const messagesColRef = db.collection(`artifacts/${appState.appId}/users/${appState.userId}/chats/${appState.chatId}/messages`);
        const q = messagesColRef.orderBy("createdAt");

        appState.unsubscribe = q.onSnapshot((snapshot) => {
            elements.chatMessages.innerHTML = '';
            appState.renderedMessageIds.clear();
            appState.conversationHistory = [];

            snapshot.docs.forEach(doc => {
                const data = doc.data();
                const messageId = doc.id;
                let textForUI = data.text;
                let textForHistory = data.text;

                if (data.sender === 'assistant') {
                    try {
                        const parsed = JSON.parse(data.text);
                        textForUI = parsed.responseText || data.text;
                        textForHistory = JSON.stringify(parsed);
                    } catch (e) { /* Ignora se o JSON for inválido, exibe o texto bruto */ }
                }
                
                addMessageToUI(data.sender, textForUI, messageId);
                appState.conversationHistory.push({
                    role: data.sender === 'user' ? 'user' : 'model',
                    parts: [{ text: textForHistory }]
                });
            });

            const lastMessage = appState.conversationHistory[appState.conversationHistory.length - 1];
            if (lastMessage && lastMessage.role === 'user' && !appState.isThinking) {
                handleConversation();
            } else if (lastMessage && lastMessage.role === 'model') {
                toggleThinking(false);
                try {
                    const lastResponse = JSON.parse(lastMessage.parts[0].text);
                    renderQuickReplies(lastResponse.quickReplies || []);
                } catch(e) {
                    renderQuickReplies([]);
                }
            }
        }, (error) => {
            console.error("Erro ao ouvir mensagens:", error);
            addMessageToUI('assistant', 'Não foi possível carregar o histórico. Por favor, atualize a página.', 'error-load');
            toggleThinking(false);
        });
    }
    
    async function createNewChat() {
        if (!appState.isAuthReady || !db) return;
        if (appState.unsubscribe) appState.unsubscribe();
        toggleThinking(true);
        appState.conversationHistory = [];
        appState.customerData = { name: '', moto: '', problem: '', preAnalysis: '' };
        try {
            const chatsColRef = db.collection(`artifacts/${appState.appId}/users/${appState.userId}/chats`);
            const newChatRef = await chatsColRef.add({ 
                createdAt: serverTimestamp(), 
                userId: appState.userId 
            });
            appState.chatId = newChatRef.id;
            
            listenToMessages();
            await startConversation();
            
        } catch (error) {
            console.error("Erro ao criar novo chat:", error);
            toggleThinking(false);
            addMessageToUI('assistant', 'Ocorreu um erro ao iniciar uma nova conversa. Por favor, recarregue a página.', 'err-new-chat');
        }
    }
    
    async function callBackendAPI(payload) {
        if (!auth.currentUser) {
            throw new Error("Usuário não autenticado. Impossível chamar o backend.");
        }

        const idTokenValue = await auth.currentUser.getIdToken();

        const response = await fetch(config.backendApiUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idTokenValue}`
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Erro na chamada ao backend. Status: ${response.status}`, {
                url: config.backendApiUrl,
                responseBody: errorBody
            });
            throw new Error(`API Error: ${response.status} - ${errorBody}`);
        }
        return response.json();
    }

    async function getDiagnosis() {
        toggleThinking(true);
        const diagnosisPrompt = `Baseado nos dados coletados, forneça um diagnóstico preliminar para o cliente. CLIENTE: ${appState.customerData.name}, MOTO: ${appState.customerData.moto}, PROBLEMA: ${appState.customerData.problem}. Forneça 2 ou 3 causas comuns. NÃO use formatação. Ao final, inclua OBRIGATORIAMENTE este aviso: "Lembre-se, ${appState.customerData.name}, que esta é uma análise inicial. Para um diagnóstico preciso e seguro, o ideal é trazer sua ${appState.customerData.moto} para nossos mecânicos avaliarem aqui na oficina."`;
        
        try {
            const responseJson = await callBackendAPI({ history: [{ role: 'user', parts: [{ text: diagnosisPrompt }] }], systemPrompt });
            appState.customerData.preAnalysis = responseJson.responseText.trim();
            await saveMessage('assistant', JSON.stringify(responseJson));
            setTimeout(generateWhatsAppLink, 500);
        } catch (error) {
            console.error("Erro no Diagnóstico:", error);
            let errorMsgText = 'Não consegui gerar um diagnóstico agora, mas não se preocupe. Vamos avançar para o atendimento com nossa equipe.';
            if (error.message && error.message.includes('429')) {
                errorMsgText = "Opa! Parece que estamos com muita demanda no momento. Não consegui gerar a pré-análise, mas já preparei seu contato para a equipe.";
            }
            const errorMsg = { responseText: errorMsgText };
            await saveMessage('assistant', JSON.stringify(errorMsg));
            generateWhatsAppLink();
        }
    }
    
    async function generateWhatsAppLink() {
        const introText = "Olá! Vim através da assistente Centelha.";
        const summary = `\n\n*Resumo do Atendimento:*\n- *Cliente:* ${appState.customerData.name}\n- *Moto:* ${appState.customerData.moto}\n- *Problema:* ${appState.customerData.problem}`;
        const preAnalysisSection = appState.customerData.preAnalysis ? `\n\n*Pré-Análise da Centelha:*\n${appState.customerData.preAnalysis}` : '';
        const fullText = introText + summary + preAnalysisSection;
        const encodedText = encodeURIComponent(fullText);
        const whatsappUrl = `https://wa.me/${config.whatsappNumber}?text=${encodedText}`;
        const transferMessage = { responseText: `Obrigado pelas informações! Para agilizar seu atendimento, preparei um resumo. Clique no botão para enviar no WhatsApp ou copie o texto. [BUTTON:Falar com a Equipe|${whatsappUrl}] [COPYBUTTON:Copiar Resumo|${fullText}]` };
        await saveMessage('assistant', JSON.stringify(transferMessage));
    }

    async function handleConversation() {
        toggleThinking(true);
        renderQuickReplies([]);
        try {
            if (appState.conversationHistory.length === 0) {
                throw new Error("Tentativa de chamar a IA com histórico vazio.");
            }
            const jsonResponse = await callBackendAPI({ history: appState.conversationHistory, systemPrompt });
            
            if (jsonResponse.extractedData) {
                appState.customerData = { ...appState.customerData, ...jsonResponse.extractedData };
            }
            
            await saveMessage('assistant', JSON.stringify(jsonResponse));
            
            const allDataCollected = appState.customerData.name && appState.customerData.moto && appState.customerData.problem;
            if (jsonResponse.conversationState === 'READY_FOR_DIAGNOSIS' && allDataCollected) {
                setTimeout(getDiagnosis, 500);
            }
        } catch (error) {
            console.error("Erro na Conversa:", error);
            let errorMsgText = "Desculpe, tive um pequeno curto-circuito aqui. Poderia repetir sua última mensagem, por favor?";
            
            if (error.message && error.message.includes('429')) {
                errorMsgText = "Opa! Parece que estamos com muita demanda no momento. Por favor, aguarde um pouco e tente novamente.";
            } else if (error.message && (error.message.includes('500') || error.message.includes('API Error'))) {
                errorMsgText = "Desculpe, estou com um problema técnico para processar sua solicitação. A equipe já foi notificada. Tente novamente em alguns instantes.";
            }

            const errorMsg = { responseText: errorMsgText };
            await saveMessage('assistant', JSON.stringify(errorMsg));
        }
    }
    
    async function handleSend() {
        const userInput = elements.chatInput.value.trim();
        if (userInput === '' || appState.isThinking) return;
        
        const textToSave = userInput;
        elements.chatInput.value = '';
        renderQuickReplies([]);
        
        await saveMessage('user', textToSave);
    }
    
    async function startConversation() {
        const welcomeMessage = {
            responseText: "Olá! Sou a Centelha, sua assistente da Oficina FG Motos. Para começarmos, qual é o seu nome?",
            quickReplies: ["Meu nome é...", "Qual o endereço?"]
        };
        await saveMessage('assistant', JSON.stringify(welcomeMessage));
    }

    function attachEventListeners() {
        elements.sendBtn.addEventListener('click', handleSend);
        elements.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
        elements.newChatBtn.addEventListener('click', () => { showModal("Tem certeza que deseja iniciar uma nova conversa?", createNewChat); });
        elements.modal.cancelBtn.addEventListener('click', hideModal);
        elements.chatMessages.addEventListener('click', (e) => {
            const target = e.target.closest('button[data-copytext]');
            if (target) {
                const textArea = document.createElement("textarea");
                textArea.value = target.dataset.copytext;
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    document.execCommand('copy');
                    target.textContent = 'Copiado!';
                    setTimeout(() => { target.textContent = 'Copiar Resumo'; }, 2000);
                } catch (err) {
                    console.error('Fallback: Oops, unable to copy', err);
                }
                document.body.removeChild(textArea);
            }
        });
    }
    
    lucide.createIcons();
    attachEventListeners();
    
    try {
        console.log("Aplicação Firebase pronta.");

        auth.onAuthStateChanged(async (user) => {
            if (user) {
                if (!appState.isAuthReady) {
                    console.log("Usuário autenticado com UID:", user.uid);
                    appState.userId = user.uid;
                    appState.isAuthReady = true;
                    await createNewChat();
                }
            } else {
                console.log("Nenhum usuário logado. Tentando login anônimo...");
                try {
                    await auth.signInAnonymously();
                    console.log("Login anônimo solicitado. Aguardando confirmação...");
                } catch (error) {
                    console.error("Falha crítica ao tentar login anônimo:", error);
                    addMessageToUI('assistant', 'Não foi possível iniciar uma sessão segura. Verifique sua conexão e recarregue a página.', 'err-auth');
                }
            }
        });
    } catch (error) {
        console.error("Falha crítica na inicialização do Firebase:", error);
        addMessageToUI('assistant', 'Erro de conexão com nossos sistemas. Por favor, recarregue a página.', 'err-firebase-init');
    }
}

window.onload = startApp;
