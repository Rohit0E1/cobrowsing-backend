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

const clients = new Map(); // location -> GoogleGenAI

/** A Vertex AI client for one region (VERTEX_PROJECT + VERTEX_CREDENTIAL). */
function vertexClient(location) {
    const project = process.env.VERTEX_PROJECT;
    if (!project) throw new Error('VERTEX_PROJECT env var is required');
    if (!location) throw new Error('A Vertex location is required');
    if (!clients.has(location)) {
        clients.set(location, new GoogleGenAI({
            vertexai: true,
            project,
            location,
            googleAuthOptions: { credentials: loadCredentials() },
        }));
    }
    return clients.get(location);
}

module.exports = { vertexClient };
