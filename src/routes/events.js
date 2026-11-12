const express = require("express");
const { verifyToken } = require("../middleware/auth");
const MeetingService = require("../services/MeetingService");
const EventService = require("../services/EventService");
const { requireTenantMeeting } = require("../middleware/meetingAccess");

const router = express.Router();

// Dashboard Stats
router.get("/stats", verifyToken, async (req, res) => {
    try {
        const stats = await EventService.getStats(req.user.tenantId);
        res.json(stats);
    } catch (err) {
        
        res.status(500).json({ error: "Error fetching stats" });
    }
});

// Real-time Activity Stream
router.get("/live-stream", verifyToken, async (req, res) => {
    try {
        const events = await EventService.getLiveStream(req.user.tenantId);
        res.json(events);
    } catch (err) {
        
        res.status(500).json({ error: "Activity load failed" });
    }
});

// Meeting-Specific Activity Log
router.get("/:uuid/activity", verifyToken, requireTenantMeeting, async (req, res) => {
    try {
        const events = await EventService.getActivity(req.meeting.id, req.query.page);
        res.json(events);
    } catch (err) {
        
        res.status(500).json({ error: "Failed to load session logs" });
    }
});

// Record Behavioral Event
router.post("/:uuid/record", async (req, res) => {
    try {
        const meeting = await MeetingService.recoverState(req.params.uuid);
        if (!meeting) return res.status(404).json({ error: "Meeting not found" });
        await EventService.record(meeting.id, req.body);
        res.json({ status: "recorded" });
    } catch (err) {
        
        res.status(500).json({ error: "Record failed" });
    }
});

module.exports = router;
