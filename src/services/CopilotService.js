const { GoogleGenAI } = require('@google/genai');
const fs = require('node:fs');

function loadCredentials() {
    const raw = process.env.VERTEX_CREDENTIAL;
    if (!raw) throw new Error('VERTEX_CREDENTIAL env var is required');

    try { return JSON.parse(raw); } catch (_) { /* not inline JSON */ }
    try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch (_) { /* not base64 */ }
    if (fs.existsSync(raw)) return JSON.parse(fs.readFileSync(raw, 'utf8'));
    throw new Error('VERTEX_CREDENTIAL is not valid JSON, base64 JSON, or a readable file path');
}

let _ai = null;
function getAi() {
    if (_ai) return _ai;
    const project = process.env.VERTEX_PROJECT;
    const location = process.env.VERTEX_LOCATION;
    if (!project) throw new Error('VERTEX_PROJECT env var is required');
    if (!location) throw new Error('VERTEX_LOCATION env var is required');
    const credentials = loadCredentials();
    _ai = new GoogleGenAI({
        vertexai: true,
        project,
        location,
        googleAuthOptions: { credentials },
    });
    return _ai;
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
