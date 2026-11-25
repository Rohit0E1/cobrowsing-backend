const express = require('express');
const { verifyToken, scopeOwner } = require('../middleware/auth');
const KnowledgeService = require('../services/KnowledgeService');
const EmailKnowledgeService = require('../services/EmailKnowledgeService');

const router = express.Router();

// Meaning search over the tenant's transcripts, meeting notes and client notes, plus the caller's own client
// emails when they turned that on.
// Body: { query: "what did Rahul think of the floor plan", clientId?: 12, limit?: 5 }
router.post('/search', verifyToken, async (req, res) => {
    const { query, clientId, limit } = req.body ?? {};
    if (typeof query !== 'string' || !query.trim() || query.length > 1000) {
        return res.status(400).json({ error: 'query must be a non-empty string under 1000 characters' });
    }
    const client = clientId === undefined || clientId === null ? null : Number(clientId);
    if (client !== null && !Number.isInteger(client)) return res.status(400).json({ error: 'clientId must be an integer' });
    try {
        EmailKnowledgeService.queueSync(req.user); // picks up new client emails; no-op when off or synced recently
        const results = await KnowledgeService.search({
            tenantId: req.user.tenantId,
            userId: req.user.id,
            owner: scopeOwner(req.user),
            query: query.trim(),
            clientId: client,
            limit,
        });
        res.json({ results });
    } catch (err) {
        console.error('[KNOWLEDGE] search failed:', err.message);
        res.status(err.status || 502).json({ error: err.status ? err.message : 'Knowledge search failed' });
    }
});

module.exports = router;
