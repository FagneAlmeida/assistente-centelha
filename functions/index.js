/**
 * ARQUIVO: index.js (para Firebase Cloud Functions)
 * DESCRIÇÃO:
 * Função 'callGemini' atualizada com configuração de CORS e verificação de
 * segurança para garantir que apenas usuários autenticados possam executá-la.
 * * PONTOS PRINCIPAIS DA ATUALIZAÇÃO:
 * 1. SEGURANÇA REFORÇADA: Adicionado o SDK 'firebase-admin' para verificar o
 * token de autenticação do usuário enviado pelo frontend. Se o token for
 * inválido ou não existir, a função é bloqueada com um erro 403 (Não Autorizado).
 * 2. ORIGEM CORRETA: A URL 'https://centelha-e931b.web.app' permanece na
 * lista de origens permitidas no middleware do CORS.
 * 3. ESTRUTURA MANTIDA: A estrutura de Firebase Function com o corsHandler
 * foi mantida, pois é a abordagem correta para este ambiente.
 */

// 1. Importação dos módulos necessários
const { onRequest } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const fetch = require("node-fetch");
const cors = require('cors');
const admin = require('firebase-admin'); // <-- AJUSTE: Importado o Firebase Admin SDK

// Inicializa o Admin SDK para que ele possa ser usado na função
admin.initializeApp();

// 2. Configuração do middleware CORS
const corsHandler = cors({
    origin: [
        "https://centelha-e931b.web.app",
        "https://fagnealmeida.github.io",
        "https://assistentecentelha.netlify.app",
    ],
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
});

// 3. Definição segura da chave da API Gemini
const geminiApiKey = defineString("GEMINI_API_KEY");

// 4. Definição da Cloud Function 'callGemini'
exports.callGemini = onRequest(
    {
        region: "us-central1",
    },
    (req, res) => {
        corsHandler(req, res, async () => {
            if (req.method !== "POST") {
                return res.status(405).send("Method Not Allowed");
            }

            // AJUSTE: Bloco de verificação de autenticação
            try {
                const idToken = req.headers.authorization?.split('Bearer ')[1];
                if (!idToken) {
                   return res.status(401).send('Unauthorized: No token provided.');
                }
                // Verifica se o token é válido usando o Admin SDK
                await admin.auth().verifyIdToken(idToken);
            } catch (error) {
                console.error("Error verifying auth token:", error);
                return res.status(403).send('Unauthorized: Invalid token.');
            }

            // Se o token for válido, a execução continua...
            try {
                const { history, systemPrompt } = req.body;

                if (!history || !systemPrompt) {
                    return res.status(400).send("Bad Request: 'history' and 'systemPrompt' are required.");
                }

                const payload = {
                    contents: history,
                    systemInstruction: {
                        role: "system",
                        parts: [{ text: systemPrompt }],
                    },
                    generationConfig: {
                        responseMimeType: "application/json",
                    },
                };

                const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey.value()}`;

                const geminiResponse = await fetch(GEMINI_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!geminiResponse.ok) {
                    const errorBody = await geminiResponse.text();
                    console.error("Gemini API Error:", errorBody);
                    return res.status(geminiResponse.status).send(errorBody);
                }

                const responseData = await geminiResponse.json();
                
                if (responseData.candidates && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts[0].text) {
                    const jsonText = responseData.candidates[0].content.parts[0].text;
                    return res.status(200).json(JSON.parse(jsonText));
                } else {
                    console.error("Unexpected response from Gemini API:", responseData);
                    return res.status(500).send("Invalid response from Gemini API.");
                }

            } catch (error) {
                console.error("Internal Function Error:", error);
                return res.status(500).send("Internal Server Error");
            }
        });
    }
);
