const express = require('express');
const { verifyToken } = require('../middleware/auth');
const ConnectorService = require('../services/ConnectorService');
const EmailKnowledgeService = require('../services/EmailKnowledgeService');

const router = express.Router();

const handle = (fn) => async (req, res) => {
    try {
        res.json(await fn(req));
    } catch (err) {
        console.error('[CONNECTORS]', err.message);
        res.status(err.status || 502).json({ error: err.status ? err.message : 'Connector request failed' });
    }
};

// Every app and whether it is connected (settings panel).
router.get('/', verifyToken, handle((req) => ConnectorService.list(req.user)));

// The advisor's connector preferences. Declared before /:toolkit so "settings" is not read as an app.
router.get('/settings', verifyToken, handle((req) => ConnectorService.getSettings(req.user)));
router.put(
    '/settings',
    verifyToken,
    handle(async (req) => {
        const before = await ConnectorService.getSettings(req.user);
        const saved = await ConnectorService.saveSettings(req.user, req.body);
        // Email search switched on: index now. Switched off: delete what was indexed.
        if (saved.readEmail && !before.readEmail) EmailKnowledgeService.queueSync(req.user, { force: true });
        if (!saved.readEmail && before.readEmail) await EmailKnowledgeService.forget(req.user);
        return saved;
    }),
);

// Is this app connected for the logged-in advisor?
router.get('/:toolkit', verifyToken, handle((req) => ConnectorService.status(req.user, req.params.toolkit)));

// Start connecting: returns a Composio Connect Link for the advisor to open.
router.post('/:toolkit/connect', verifyToken, handle((req) => ConnectorService.connect(req.user, req.params.toolkit)));

// Disconnect: removes the advisor's connection; the next use shows the Connect card again.
// Google Calendar answers 409 while upcoming presentations' invites live on it; ?force=true goes ahead anyway.
router.delete(
    '/:toolkit',
    verifyToken,
    handle(async (req) => {
        const result = await ConnectorService.disconnect(req.user, req.params.toolkit, { force: req.query.force === 'true' });
        if (req.params.toolkit === 'gmail') {
            // No mailbox, no indexed mail; and reconnecting must not quietly start reading again.
            await ConnectorService.saveSettings(req.user, { readEmail: false });
            await EmailKnowledgeService.forget(req.user);
        }
        return result;
    }),
);

// Run one of the app's tools as the advisor: { tool: "GOOGLECALENDAR_EVENTS_LIST", arguments: {...} }
// Writes come back as resultType "input_required"; resend with { inputResponses, requestState } once the advisor answers.
router.post(
    '/:toolkit/execute',
    verifyToken,
    handle((req) =>
        ConnectorService.execute(req.user, req.params.toolkit, req.body?.tool, req.body?.arguments, {
            inputResponses: req.body?.inputResponses,
            requestState: req.body?.requestState,
        }),
    ),
);

module.exports = router;
