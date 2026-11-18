const { vertexClient } = require('../config/vertex');

function getAi() {
    if (!process.env.VERTEX_LOCATION) throw new Error('VERTEX_LOCATION env var is required');
    return vertexClient(process.env.VERTEX_LOCATION);
}

const DEFAULT_MODEL = process.env.VERTEX_MODEL || 'gemini-2.5-flash';

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
     * One turn against Vertex Gemini.
     * @param {Array} messages - [{ role: 'user'|'model'|'function', parts: [...] }]
     * @param {Array} tools    - [{ functionDeclarations: [...] }]
     * @returns {Promise<{ parts: Array, finishReason: string }>}
     */
    async chat({ messages, tools, model = DEFAULT_MODEL, systemInstruction = SYSTEM_INSTRUCTION }) {
        const ai = getAi();
        const config = {
            systemInstruction,
        };
        if (tools && tools.length > 0) config.tools = tools;

        const response = await ai.models.generateContent({
            model,
            contents: messages,
            config,
        });
        const candidate = response?.candidates?.[0];
        if (!candidate) {
            return { parts: [{ text: '(no response)' }], finishReason: 'no_candidate' };
        }
        return {
            parts: candidate.content?.parts || [],
            finishReason: candidate.finishReason || 'STOP',
        };
    },
};

module.exports = CopilotService;
