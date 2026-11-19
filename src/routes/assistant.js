const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { pool } = require('../config/db');
const KnowledgeService = require('../services/KnowledgeService');

const router = express.Router();

const MAX_TEXT = 4000;
const SESSION_RE = /^[A-Za-z0-9:_-]{1,120}$/;

// One line of an assistant conversation: { sessionId, role: "advisor" | "assistant", text }.
// Saved so a later session can recall it, and indexed (privately, for this advisor) for knowledge search.
router.post('/messages', verifyToken, async (req, res) => {
    const { sessionId, role, text } = req.body ?? {};
    if (typeof sessionId !== 'string' || !SESSION_RE.test(sessionId)) return res.status(400).json({ error: 'sessionId is invalid' });
    if (role !== 'advisor' && role !== 'assistant') return res.status(400).json({ error: 'role must be advisor or assistant' });
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
    try {
        await pool.query(
            'INSERT INTO assistant_messages (user_id, tenant_id, session_id, role, text) VALUES ($1, $2, $3, $4, $5)',
            [req.user.id, req.user.tenantId, sessionId, role, text.trim().slice(0, MAX_TEXT)],
        );
        KnowledgeService.queue(`assistant:${req.user.id}:${sessionId}`);
        res.status(201).json({ ok: true });
    } catch (err) {
        console.error('[ASSISTANT] save failed:', err.message);
        res.status(500).json({ error: 'Could not save the message' });
    }
});

// The advisor's most recent earlier session (not `exclude`, the one in progress), oldest line first.
router.get('/history', verifyToken, async (req, res) => {
    const exclude = typeof req.query.exclude === 'string' ? req.query.exclude : '';
    try {
        const { rows: last } = await pool.query(
            `SELECT session_id, MAX(created_at) AS ended_at FROM assistant_messages
             WHERE user_id = $1 AND session_id <> $2
             GROUP BY session_id ORDER BY ended_at DESC LIMIT 1`,
            [req.user.id, exclude],
        );
        if (!last.length) return res.json({ session: null });
        const { rows } = await pool.query(
            `SELECT role, text, created_at FROM assistant_messages
             WHERE user_id = $1 AND session_id = $2 ORDER BY created_at DESC, id DESC LIMIT 40`,
            [req.user.id, last[0].session_id],
        );
        res.json({
            session: {
                sessionId: last[0].session_id,
                endedAt: last[0].ended_at,
                messages: rows.reverse().map((r) => ({ role: r.role, text: r.text, at: r.created_at })),
            },
        });
    } catch (err) {
        console.error('[ASSISTANT] history failed:', err.message);
        res.status(500).json({ error: 'Could not load earlier conversations' });
    }
});

module.exports = router;
