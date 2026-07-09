const SpeechToTextService = require('../services/SpeechToTextService');
const TextToSpeechService = require('../services/TextToSpeechService');
const CopilotService = require('../services/CopilotService');

const VAD_SILENCE_MS = parseInt(process.env.VAD_SILENCE_MS, 10) || 400;
const VAD_RMS_THRESHOLD = parseFloat(process.env.VAD_RMS_THRESHOLD) || 300;
const MIN_SPEECH_CHUNKS = parseInt(process.env.VAD_MIN_SPEECH_CHUNKS, 10) || 3;
const MAX_RECORDING_MS = parseInt(process.env.VAD_MAX_RECORDING_MS, 10) || 30000;

const State = Object.freeze({
    IDLE: 'IDLE',
    LISTENING: 'LISTENING',
    PROCESSING: 'PROCESSING',
    SPEAKING: 'SPEAKING',
});

const sessions = new Map();

function createSession(overrides = {}) {
    return {
        state: State.IDLE,
        audioChunks: [],
        speechChunkCount: 0,
        silenceStart: null,
        recordingStart: null,
        language: overrides.language || 'en-IN',
        sampleRate: overrides.sampleRate || 16000,
        silenceMs: overrides.silenceMs || VAD_SILENCE_MS,
        conversationHistory: [],
        bargeInTriggered: false,
        processingAborted: false,
    };
}

function calculateRMS(pcmBuffer) {
    if (!pcmBuffer || pcmBuffer.length < 2) return 0;
    let sum = 0;
    const sampleCount = Math.floor(pcmBuffer.length / 2);
    for (let i = 0; i < pcmBuffer.length - 1; i += 2) {
        const sample = pcmBuffer.readInt16LE(i);
        sum += sample * sample;
    }
    return Math.sqrt(sum / sampleCount);
}

function isSpeech(pcmBuffer) {
    return calculateRMS(pcmBuffer) > VAD_RMS_THRESHOLD;
}

const VOICE_SYSTEM_INSTRUCTION = `You are the Propley Voice Assistant for a premium real-estate sales engine. You are having a spoken conversation with a real-estate consultant or client.

Hard rules:
- Keep responses concise and conversational — they will be spoken aloud via TTS.
- Maximum 2-3 sentences per response. Brevity is critical.
- Do NOT use markdown, bullet points, URLs, or any formatting — plain spoken text only.
- Do NOT use emojis, asterisks, or special characters.
- If the user's speech is unclear or partially transcribed, ask a brief clarifying question.
- Be helpful, warm, and professional. You are a real-estate expert.
- When discussing property details, prices, or schedules, be precise and direct.`;

module.exports = (io, socket) => {

    socket.on('voice:start', (payload = {}) => {
        const existing = sessions.get(socket.id);
        if (existing && existing.state !== State.IDLE) {
            console.log(`[Voice] ${socket.id} already in conversation (${existing.state}), ignoring duplicate start`);
            return;
        }

        const session = createSession({
            language: payload.language,
            sampleRate: payload.sampleRate,
            silenceMs: payload.silenceMs,
        });
        session.state = State.LISTENING;
        session.recordingStart = Date.now();
        sessions.set(socket.id, session);

        console.log(`[Voice] ${socket.id} conversation started (lang=${session.language}, silence=${session.silenceMs}ms)`);
        socket.emit('voice:listening', {});
    });

    socket.on('voice:audio-chunk', (payload = {}) => {
        const session = sessions.get(socket.id);
        if (!session) return;

        const { audio } = payload;
        if (!audio) return;

        const pcmBuffer = Buffer.from(audio, 'base64');

        if (session.state === State.SPEAKING) {
            if (isSpeech(pcmBuffer)) {
                console.log(`[Voice] ${socket.id} BARGE-IN detected`);
                session.bargeInTriggered = true;
                session.state = State.LISTENING;
                session.audioChunks = [pcmBuffer];
                session.speechChunkCount = 1;
                session.silenceStart = null;
                session.recordingStart = Date.now();
                socket.emit('voice:barge-in', {});
                socket.emit('voice:listening', {});
            }
            return;
        }

        if (session.state !== State.LISTENING) return;

        if (session.recordingStart && (Date.now() - session.recordingStart > MAX_RECORDING_MS)) {
            console.log(`[Voice] ${socket.id} max recording duration reached, processing`);
            processUtterance(socket, session);
            return;
        }

        const hasSpeech = isSpeech(pcmBuffer);

        if (hasSpeech) {
            session.audioChunks.push(pcmBuffer);
            session.speechChunkCount++;
            session.silenceStart = null;
        } else {
            session.audioChunks.push(pcmBuffer);

            if (session.speechChunkCount > 0) {
                if (!session.silenceStart) {
                    session.silenceStart = Date.now();
                } else if (Date.now() - session.silenceStart >= session.silenceMs) {
                    console.log(`[Voice] ${socket.id} silence timeout (${session.silenceMs}ms) — end of utterance`);
                    processUtterance(socket, session);
                    return;
                }
            }
            if (session.speechChunkCount === 0 && session.audioChunks.length > 20) {
                session.audioChunks = session.audioChunks.slice(-5);
            }
        }
    });

    socket.on('voice:tts-done', () => {
        const session = sessions.get(socket.id);
        if (!session) return;

        if (session.state === State.SPEAKING) {
            session.state = State.LISTENING;
            session.audioChunks = [];
            session.speechChunkCount = 0;
            session.silenceStart = null;
            session.recordingStart = Date.now();
            console.log(`[Voice] ${socket.id} TTS playback done, returning to listening`);
            socket.emit('voice:listening', {});
        }
    });

    socket.on('voice:stop', () => {
        const session = sessions.get(socket.id);
        if (!session) return;

        console.log(`[Voice] ${socket.id} conversation stopped (was in ${session.state})`);
        session.processingAborted = true;
        session.bargeInTriggered = true;
        session.state = State.IDLE;
        sessions.delete(socket.id);
        socket.emit('voice:ended', {});
    });

    socket.on('disconnect', () => {
        const session = sessions.get(socket.id);
        if (session) {
            session.processingAborted = true;
            session.bargeInTriggered = true;
            sessions.delete(socket.id);
            console.log(`[Voice] ${socket.id} disconnected, session cleaned up`);
        }
    });
};

async function processUtterance(socket, session) {
    if (session.speechChunkCount < MIN_SPEECH_CHUNKS) {
        console.log(`[Voice] ${socket.id} too few speech chunks (${session.speechChunkCount}), resuming listening`);
        session.audioChunks = [];
        session.speechChunkCount = 0;
        session.silenceStart = null;
        session.recordingStart = Date.now();
        socket.emit('voice:listening', {});
        return;
    }

    session.state = State.PROCESSING;
    session.processingAborted = false;
    session.bargeInTriggered = false;
    socket.emit('voice:processing', {});

    const audioBuffer = Buffer.concat(session.audioChunks);
    session.audioChunks = [];
    session.speechChunkCount = 0;
    session.silenceStart = null;

    try {
        console.log(`[Voice] ${socket.id} STT: transcribing ${audioBuffer.length} bytes...`);
        const transcript = await SpeechToTextService.transcribe(audioBuffer, {
            sampleRate: session.sampleRate,
            language: session.language,
        });

        if (session.processingAborted) {
            console.log(`[Voice] ${socket.id} processing aborted after STT`);
            return;
        }

        if (!transcript || transcript.trim().length === 0) {
            console.log(`[Voice] ${socket.id} STT returned empty transcript, resuming listening`);
            session.state = State.LISTENING;
            session.recordingStart = Date.now();
            socket.emit('voice:listening', {});
            return;
        }

        console.log(`[Voice] ${socket.id} STT transcript: "${transcript}"`);
        socket.emit('voice:transcript', { text: transcript });

        session.conversationHistory.push({
            role: 'user',
            parts: [{ text: transcript }],
        });

        if (session.conversationHistory.length > 20) {
            session.conversationHistory = session.conversationHistory.slice(-20);
        }

        console.log(`[Voice] ${socket.id} AI: generating response...`);
        const aiResult = await CopilotService.chat({
            messages: session.conversationHistory,
            tools: [],
            systemInstruction: VOICE_SYSTEM_INSTRUCTION,
        });

        if (session.processingAborted) {
            console.log(`[Voice] ${socket.id} processing aborted after AI`);
            return;
        }

        const aiText = aiResult.parts
            .filter((p) => p.text)
            .map((p) => p.text)
            .join(' ')
            .trim();

        if (!aiText) {
            console.log(`[Voice] ${socket.id} AI returned empty response, resuming listening`);
            session.state = State.LISTENING;
            session.recordingStart = Date.now();
            socket.emit('voice:listening', {});
            return;
        }

        session.conversationHistory.push({
            role: 'model',
            parts: [{ text: aiText }],
        });

        console.log(`[Voice] ${socket.id} AI response: "${aiText.substring(0, 100)}..."`);
        socket.emit('voice:ai-text', { text: aiText });

        if (session.bargeInTriggered) {
            console.log(`[Voice] ${socket.id} barge-in occurred before TTS, skipping`);
            return;
        }

        console.log(`[Voice] ${socket.id} TTS: synthesizing...`);
        session.state = State.SPEAKING;

        const sentences = aiText.match(/[^.!?]+[.!?]*(?:\s|$)/g) || [aiText];
        let isFirstAudio = true;

        for (const sentence of sentences) {
            const textToSpeak = sentence.trim();
            if (!textToSpeak) continue;

            if (session.bargeInTriggered || session.processingAborted) {
                console.log(`[Voice] ${socket.id} barge-in/abort during TTS pipelining, skipping remaining`);
                break;
            }

            try {
                const ttsResult = await TextToSpeechService.synthesize(textToSpeak, {
                    language: session.language,
                });

                if (session.bargeInTriggered || session.processingAborted) {
                    break;
                }

                socket.emit('voice:tts-audio', {
                    audio: ttsResult.audio,
                    format: ttsResult.format,
                });
                
                if (isFirstAudio) {
                    console.log(`[Voice] ${socket.id} first TTS chunk sent`);
                    isFirstAudio = false;
                }
            } catch (err) {
                console.error(`[Voice] ${socket.id} TTS error for chunk:`, err.message);
            }
        }

        if (!session.bargeInTriggered && !session.processingAborted) {
            console.log(`[Voice] ${socket.id} all TTS audio sent, waiting for playback completion`);
        }

    } catch (err) {
        console.error(`[Voice] ${socket.id} pipeline error:`, err.message);

        if (!session.processingAborted) {
            socket.emit('voice:error', { message: err.message || 'Voice processing failed' });

            if (sessions.has(socket.id)) {
                session.state = State.LISTENING;
                session.recordingStart = Date.now();
                socket.emit('voice:listening', {});
            }
        }
    }
}
