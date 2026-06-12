const express = require('express');
const { verifyToken } = require('../middleware/auth');
const SchedulingService = require('../services/SchedulingService');

const router = express.Router();

// Get all scheduled meetings (scoped to requesting user)
router.get('/', verifyToken, async (req, res) => {
    try {
        const meetings = await SchedulingService.getAll(req.user.id);
        res.json(meetings);
    } catch (err) {
        console.error('[SCHEDULE] getAll error:', err);
        res.status(500).json({ error: 'Failed to fetch scheduled meetings' });
    }
});

// Schedule a meeting
router.post('/', verifyToken, async (req, res) => {
    try {
        const { client_name, client_email, client_phone, client_city, project_id, start_time } = req.body;
        if (!client_name || typeof client_name !== 'string' || !client_name.trim()) {
            return res.status(400).json({ error: 'client_name is required' });
        }
        if (client_name.trim().length > 255) {
            return res.status(400).json({ error: 'client_name too long (max 255)' });
        }
        if (!client_email || typeof client_email !== 'string' || !client_email.trim()) {
            return res.status(400).json({ error: 'client_email is required' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email.trim())) {
            return res.status(400).json({ error: 'client_email is invalid' });
        }
        if (client_phone && String(client_phone).trim().length > 50) {
            return res.status(400).json({ error: 'client_phone too long (max 50)' });
        }
        if (client_city && (typeof client_city !== 'string' || client_city.trim().length > 255)) {
            return res.status(400).json({ error: 'client_city must be a string up to 255 chars' });
        }
        if (project_id !== undefined && project_id !== null && (isNaN(parseInt(project_id, 10)) || parseInt(project_id, 10) <= 0)) {
            return res.status(400).json({ error: 'project_id must be a positive integer' });
        }
        if (!start_time) {
            return res.status(400).json({ error: 'start_time is required' });
        }
        const meeting = await SchedulingService.schedule(req.user.id, {
            client_name: client_name.trim(),
            client_email: client_email.trim().toLowerCase(),
            client_phone: client_phone ? String(client_phone).trim() : null,
            client_city: client_city ? client_city.trim() : null,
            project_id: project_id ? parseInt(project_id, 10) : null,
            start_time
        });
        res.status(201).json(meeting);
    } catch (err) {
        if (err.status === 409 || err.code === "23505") {
            return res.status(409).json({ error: err.message || 'This customer conflicts with an existing client record' });
        }
        const status = err.message && (err.message.includes('future') || err.message.includes('Invalid')) ? 400 : 500;
        if (status === 400) {
            console.warn('[SCHEDULE] rejected:', err.message);
        } else {
            console.error('[SCHEDULE] schedule error:', err);
        }
        res.status(status).json({ error: err.message || 'Failed to schedule meeting' });
    }
});

// Lookup a customer by email or phone (derived from past scheduled_meetings)
router.get('/customers/lookup', verifyToken, async (req, res) => {
    try {
        const { email, phone } = req.query;
        if (!email && !phone) {
            return res.status(400).json({ error: 'email or phone query param required' });
        }
        const match = await SchedulingService.lookupCustomer({ email, phone });
        res.json({ match });
    } catch (err) {
        console.error('[SCHEDULE] lookupCustomer error:', err);
        res.status(500).json({ error: 'Lookup failed' });
    }
});

// Reschedule a meeting
router.put('/:id/reschedule', verifyToken, async (req, res) => {
    try {
        const { start_time } = req.body;
        if (!start_time) return res.status(400).json({ error: 'start_time is required' });
        const meeting = await SchedulingService.reschedule(req.params.id, req.user.id, { start_time });
        if (!meeting) return res.status(404).json({ error: 'Scheduled meeting not found or not authorized' });
        res.json(meeting);
    } catch (err) {
        const status = err.message && (err.message.includes('future') || err.message.includes('Invalid') || err.message.includes('cancelled')) ? 400 : 500;
        if (status === 400) {
            console.warn('[SCHEDULE] reschedule rejected:', err.message);
        } else {
            console.error('[SCHEDULE] reschedule error:', err);
        }
        res.status(status).json({ error: err.message || 'Failed to reschedule meeting' });
    }
});

// Cancel a meeting
router.delete('/:id/cancel', verifyToken, async (req, res) => {
    try {
        const meeting = await SchedulingService.cancel(req.params.id, req.user.id);
        if (!meeting) return res.status(404).json({ error: 'Scheduled meeting not found or not authorized' });
        res.json(meeting);
    } catch (err) {
        console.error('[SCHEDULE] cancel error:', err);
        const status = err.message.includes('already cancelled') ? 400 : 500;
        res.status(status).json({ error: err.message || 'Failed to cancel meeting' });
    }
});

// Get single scheduled meeting
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const meeting = await SchedulingService.getById(req.params.id, req.user.id);
        if (!meeting) return res.status(404).json({ error: 'Not found' });
        res.json(meeting);
    } catch (err) {
        console.error('[SCHEDULE] getById error:', err);
        const status = err.message.includes('Invalid') ? 400 : 500;
        res.status(status).json({ error: err.message || 'Fetch error' });
    }
});

module.exports = router;
