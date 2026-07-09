const axios = require('axios');

const SARVAM_API_URL = 'https://api.sarvam.ai';

function getApiKey() {
    const key = process.env.SARVAM_API_KEY || process.env.SARVAM;
    if (!key) throw new Error('SARVAM_API_KEY env var is required for TTS');
    return key;
}

const TextToSpeechService = {
    async synthesize(text, {
        language = 'en-IN',
        speaker = 'priya',
        pace = 1.05,
    } = {}) {
        if (!text || text.trim().length === 0) {
            throw new Error('Cannot synthesize empty text');
        }

        const apiKey = getApiKey();

        const response = await axios.post(`${SARVAM_API_URL}/text-to-speech`, {
            text,
            target_language_code: language,
            speaker,
            model: 'bulbul:v3',
            pace,
        }, {
            headers: {
                'api-subscription-key': apiKey,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
        });

        const audios = response.data?.audios;
        if (!audios || audios.length === 0) {
            throw new Error('TTS returned no audio content');
        }

        return {
            audio: audios[0],
            format: 'wav',
        };
    },
};

module.exports = TextToSpeechService;
