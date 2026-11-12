const express = require("express");
const { verifyToken } = require("../middleware/auth");
const MeetingService = require("../services/MeetingService");
const { requireTenantMeeting } = require("../middleware/meetingAccess");

const router = express.Router();

// Create Meeting
router.post("/", verifyToken, async (req, res) => {
    try {
        const meeting = await MeetingService.create(req.user.tenantId, req.user.id, req.body);
        res.json(meeting);
    } catch (err) {
        
        res.status(500).json({ error: "Creation failed" });
    }
});

// All Meetings (Dashboard)
router.get("/all", verifyToken, async (req, res) => {
    try {
        const meetings = await MeetingService.getAll(req.user.tenantId);
        res.json(meetings);
    } catch (err) {
        
        res.status(500).json({ error: "Fetch failed" });
    }
});

// Join Meeting (Participant Metadata)
router.get("/:uuid", async (req, res) => {
    try {
        const meeting = await MeetingService.getWithModerator(req.params.uuid);
        if (!meeting) return res.status(404).json({ error: "Not found" });
        res.json(meeting);
    } catch (err) {
        
        res.status(500).json({ error: "Fetch error" });
    }
});

// Moderator Session Check — any logged-in user in the meeting's tenant may host it
router.get("/:uuid/moderator", verifyToken, requireTenantMeeting, (req, res) => {
    res.json({ status: "authorized", meeting: req.meeting });
});

// Save Meeting Transcript
router.patch("/:uuid/transcript", verifyToken, requireTenantMeeting, async (req, res) => {
    try {
        const { transcript } = req.body;
        if (typeof transcript !== "string") return res.status(400).json({ error: "transcript must be a string" });
        const result = await MeetingService.updateTranscript(req.params.uuid, transcript);
        if (!result) return res.status(404).json({ error: "Not found" });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Update failed" });
    }
});

// Add Meeting Note
router.post("/:uuid/notes", verifyToken, requireTenantMeeting, async (req, res) => {
    try {
        const { note } = req.body;
        if (typeof note !== "string") return res.status(400).json({ error: "note must be a string" });
        const result = await MeetingService.addNote(req.params.uuid, note);
        if (!result) return res.status(404).json({ error: "Not found" });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Failed to add note" });
    }
});

// Edit Meeting Note
router.patch("/:uuid/notes/:noteId", verifyToken, requireTenantMeeting, async (req, res) => {
    try {
        const { note } = req.body;
        if (typeof note !== "string") return res.status(400).json({ error: "note must be a string" });
        const result = await MeetingService.editNote(req.params.uuid, req.params.noteId, note);
        if (!result) return res.status(404).json({ error: "Not found" });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Failed to edit note" });
    }
});

// Delete Meeting Note
router.delete("/:uuid/notes/:noteId", verifyToken, requireTenantMeeting, async (req, res) => {
    try {
        const result = await MeetingService.deleteNote(req.params.uuid, req.params.noteId);
        if (!result) return res.status(404).json({ error: "Not found" });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Failed to delete note" });
    }
});

// Force Reset Selection
router.post("/:uuid/reset", verifyToken, requireTenantMeeting, async (req, res) => {
    try {
        await MeetingService.reset(req.params.uuid);
        res.json({ status: "success" });
    } catch (err) {
        res.status(500).json({ error: "Reset failed" });
    }
});

module.exports = router;
