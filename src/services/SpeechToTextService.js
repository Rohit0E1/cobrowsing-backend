const axios = require('axios');
const FormData = require('form-data');

const SARVAM_API_URL = 'https://api.sarvam.ai';

function getApiKey() {
    const key = process.env.SARVAM_API_KEY || process.env.SARVAM;
    if (!key) throw new Error('SARVAM_API_KEY env var is required for STT');
    return key;
}

function pcmToWav(pcmBuffer, sampleRate = 16000, numChannels = 1, bitsPerSample = 16) {
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmBuffer.length;
    const headerSize = 44;
    const wav = Buffer.alloc(headerSize + dataSize);

    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(numChannels, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(byteRate, 28);
    wav.writeUInt16LE(blockAlign, 32);
    wav.writeUInt16LE(bitsPerSample, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(dataSize, 40);
    pcmBuffer.copy(wav, headerSize);

    return wav;
}

const SpeechToTextService = {
    async transcribe(audioBuffer, { sampleRate = 16000, language = 'en-IN' } = {}) {
        if (!audioBuffer || audioBuffer.length === 0) return '';

        const apiKey = getApiKey();
        const wavBuffer = pcmToWav(audioBuffer, sampleRate);

        const form = new FormData();
        form.append('file', wavBuffer, {
            filename: 'audio.wav',
            contentType: 'audio/wav',
        });
        form.append('model', 'saaras:v3');
        form.append('language_code', language);
        form.append('mode', 'transcribe');

        const response = await axios.post(`${SARVAM_API_URL}/speech-to-text`, form, {
            headers: {
                ...form.getHeaders(),
                'api-subscription-key': apiKey,
            },
            timeout: 15000,
        });

        const transcript = response.data?.transcript || '';
        return transcript.trim();
    },
};

module.exports = SpeechToTextService;
