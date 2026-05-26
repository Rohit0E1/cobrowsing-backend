const express = require('express');
const { verifyToken } = require('../middleware/auth');
const CopilotService = require('../services/CopilotService');

const router = express.Router();

// Single turn: client posts messages + tools, gets next model output (text and/or functionCall parts).
router.post('/', verifyToken, async (req, res) => {
    try {
        const { messages, tools } = req.body;
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'messages array required' });
        }
        const result = await CopilotService.chat({ messages, tools });
        res.json(result);
    } catch (err) {
        console.error('[COPILOT] chat error:', err);
        res.status(500).json({ error: err.message || 'Copilot turn failed' });
    }
});

module.exports = router;
