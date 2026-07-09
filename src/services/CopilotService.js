const axios = require('axios');

const SARVAM_API_URL = 'https://api.sarvam.ai/v1/chat/completions';
const DEFAULT_MODEL = 'sarvam-30b';

function getApiKey() {
    const key = process.env.SARVAM;
    if (!key) throw new Error('SARVAM env var is required for AI Copilot');
    return key;
}

const SYSTEM_INSTRUCTION = `You are the Propley Copilot for a premium real-estate sales engine. You help consultants navigate the app and schedule client meetings by calling tools, not by guessing.

Hard rules:
- When the user says "schedule a meeting for <name>", <name> is the CUSTOMER, never the consultant.
- Identify existing customers by email or phone ONLY, never by name (names collide).
- client_email is REQUIRED before submitting. If missing, call askUser to request it.
- Required to submit: customerName, customerEmail, date, time. Phone is optional.
- Prefer tool calls over conversation. Use askUser only when you genuinely need information.
- When all required fields are present, call submitMeeting without asking for confirmation.
- Keep replies short. The UI shows the form filling itself — don't narrate every step.`;

const CopilotService = {
    /**
     * One turn against Sarvam AI LLM (OpenAI-compatible) translated from Gemini format.
     * @param {Array} messages - [{ role: 'user'|'model'|'function', parts: [...] }]
     * @param {Array} tools    - [{ functionDeclarations: [...] }]
     * @returns {Promise<{ parts: Array, finishReason: string }>}
     */
    async chat({ messages, tools, model = DEFAULT_MODEL, systemInstruction = SYSTEM_INSTRUCTION }) {
        const apiKey = getApiKey();
        
        const openAiMessages = [
            { role: 'system', content: systemInstruction }
        ];

        for (const msg of messages) {
            const role = msg.role === 'model' ? 'assistant' : msg.role;
            let content = '';
            
            if (msg.parts) {
                for (const part of msg.parts) {
                    if (part.text) content += part.text;
                }
            }
            if (content) {
                openAiMessages.push({ role, content });
            }
        }

        let openAiTools = undefined;
        if (tools && tools.length > 0 && tools[0].functionDeclarations) {
            openAiTools = tools[0].functionDeclarations.map(fn => ({
                type: 'function',
                function: {
                    name: fn.name,
                    description: fn.description,
                    parameters: fn.parameters
                }
            }));
        }

        try {
            const payload = {
                model,
                messages: openAiMessages,
            };
            if (openAiTools) payload.tools = openAiTools;

            const response = await axios.post(SARVAM_API_URL, payload, {
                headers: {
                    'api-subscription-key': apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            const choice = response.data?.choices?.[0];
            if (!choice || !choice.message) {
                return { parts: [{ text: '(no response)' }], finishReason: 'no_candidate' };
            }

            const message = choice.message;
            const parts = [];

            if (message.content) {
                parts.push({ text: message.content });
            }

            if (message.tool_calls && message.tool_calls.length > 0) {
                for (const tc of message.tool_calls) {
                    if (tc.type === 'function') {
                        parts.push({
                            functionCall: {
                                name: tc.function.name,
                                args: JSON.parse(tc.function.arguments || '{}')
                            }
                        });
                    }
                }
            }

            return {
                parts,
                finishReason: choice.finish_reason === 'tool_calls' ? 'STOP' : 'STOP',
            };
        } catch (error) {
            console.error('[CopilotService] Error calling Sarvam AI:', error.response?.data || error.message);
            throw error;
        }
    }
};

module.exports = CopilotService;
