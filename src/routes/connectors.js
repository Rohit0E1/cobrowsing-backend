const express = require('express');
const { verifyToken } = require('../middleware/auth');
const ConnectorService = require('../services/ConnectorService');

const router = express.Router();

const handle = (fn) => async (req, res) => {
    try {
        res.json(await fn(req));
    } catch (err) {
        console.error('[CONNECTORS]', err.message);
        res.status(err.status || 502).json({ error: err.status ? err.message : 'Connector request failed' });
    }
};

// Is this app connected for the logged-in advisor?
router.get('/:toolkit', verifyToken, handle((req) => ConnectorService.status(req.user, req.params.toolkit)));

// Start connecting: returns a Composio Connect Link for the advisor to open.
router.post('/:toolkit/connect', verifyToken, handle((req) => ConnectorService.connect(req.user, req.params.toolkit)));

// Run one of the app's tools as the advisor: { tool: "GOOGLECALENDAR_EVENTS_LIST", arguments: {...} }
router.post(
    '/:toolkit/execute',
    verifyToken,
    handle((req) => ConnectorService.execute(req.user, req.params.toolkit, req.body?.tool, req.body?.arguments)),
);

module.exports = router;
