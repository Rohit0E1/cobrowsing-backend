require('dotenv').config();
const axios = require('axios');
const key = process.env.SARVAM;


async function test() {
    try {
        const response = await axios.post('https://api.sarvam.ai/chat/completions', {
            model: 'sarvam-1',
            messages: [{role: 'user', content: 'hello'}]
        }, {
            headers: { 'api-subscription-key': key }
        });
        console.log("SUCCESS:", response.data.choices[0].message.content);
    } catch (e) {
        console.error("ERROR 1:", e.response?.data || e.message);
    }
    
    try {
        const response = await axios.post('https://api.sarvam.ai/v1/chat/completions', {
            model: 'sarvam-1',
            messages: [{role: 'user', content: 'hello'}]
        }, {
            headers: { 'api-subscription-key': key }
        });
        console.log("SUCCESS 2:", response.data.choices[0].message.content);
    } catch (e) {
        console.error("ERROR 2:", e.response?.data || e.message);
    }
}
test();
