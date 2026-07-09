const express = require("express");
const { verifyToken } = require("../middleware/auth");
const ClientService = require("../services/ClientService");
const ClientNoteService = require("../services/ClientNoteService");
const ClientActivityService = require("../services/ClientActivityService");

const router = express.Router();

function notePreview(body) {
    const trimmed = String(body).trim();
    return trimmed.length > 72 ? `${trimmed.slice(0, 72)}…` : trimmed;
}

const VALID_STATUSES = ["Active", "Pending", "Completed"];
const VALID_DEAL_STAGES = ["inquiry", "vsv_scheduled", "vsv_done", "offer", "negotiation", "closed_won", "closed_lost"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateClientBody(body, { partial = false } = {}) {
    const { name, email, phone, city, status, deal_stage, win_loss_reason, lead_source, assigned_advisor_id } = body;

    if (!partial || name !== undefined) {
        if (!name || typeof name !== "string" || !name.trim()) {
            return "name is required";
        }
        if (name.trim().length > 255) {
            return "name too long (max 255)";
        }
    }
    if (!partial || email !== undefined) {
        if (!email || typeof email !== "string" || !email.trim()) {
            return "email is required";
        }
        if (!EMAIL_RE.test(email.trim())) {
            return "email is invalid";
        }
    }
    if (phone !== undefined && phone !== null && String(phone).trim().length > 50) {
        return "phone too long (max 50)";
    }
    if (city !== undefined && city !== null && (typeof city !== "string" || city.trim().length > 255)) {
        return "city must be a string up to 255 chars";
    }
    if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
        return "status must be Active, Pending or Completed";
    }
    if (deal_stage !== undefined && deal_stage !== null && !VALID_DEAL_STAGES.includes(deal_stage)) {
        return "deal_stage must be one of: " + VALID_DEAL_STAGES.join(", ");
    }
    if (lead_source !== undefined && lead_source !== null && (typeof lead_source !== "string" || lead_source.trim().length > 255)) {
        return "lead_source must be a string up to 255 chars";
    }
    if (assigned_advisor_id !== undefined && assigned_advisor_id !== null && (typeof assigned_advisor_id !== "string" || assigned_advisor_id.trim().length > 255)) {
        return "assigned_advisor_id must be a string up to 255 chars";
    }
    if (win_loss_reason !== undefined && win_loss_reason !== null && (typeof win_loss_reason !== "string" || win_loss_reason.trim().length > 500)) {
        return "win_loss_reason must be a string up to 500 chars";
    }
    return null;
}

function normalizeBody(body, { partial = false } = {}) {
    const out = {};
    const set = (key, value) => { if (value !== undefined) out[key] = value; };

    if (!partial || body.name !== undefined) set("name", body.name.trim());
    if (!partial || body.email !== undefined) set("email", body.email.trim().toLowerCase());
    if (body.phone !== undefined) set("phone", body.phone ? String(body.phone).trim() : null);
    if (body.city !== undefined) set("city", body.city ? body.city.trim() : null);
    if (body.status !== undefined) set("status", body.status);
    if (body.deal_stage !== undefined) set("deal_stage", body.deal_stage);
    if (body.lead_source !== undefined) set("lead_source", body.lead_source ? body.lead_source.trim() : null);
    if (body.assigned_advisor_id !== undefined) set("assigned_advisor_id", body.assigned_advisor_id ? body.assigned_advisor_id.trim() : null);
    if (body.last_meeting !== undefined) set("last_meeting", body.last_meeting ? String(body.last_meeting).trim() : null);
    if (body.win_loss_reason !== undefined) set("win_loss_reason", body.win_loss_reason ? body.win_loss_reason.trim() : null);
    return out;
}

router.get("/", verifyToken, async (req, res) => {
    try {
        if (req.query.email) {
            const match = await ClientService.findByEmail(req.query.email);
            return res.json({ clients: match ? [match] : [], match: match || null });
        }
        const clients = await ClientService.getAll();
        res.json({ clients });
    } catch (err) {
        console.error("[CLIENTS] getAll error:", err);
        res.status(500).json({ error: "Failed to load clients" });
    }
});

router.post("/", verifyToken, async (req, res) => {
    try {
        const validationError = validateClientBody(req.body);
        if (validationError) return res.status(400).json({ error: validationError });

        const client = await ClientService.create(req.user.id, normalizeBody(req.body));
        res.status(201).json(client);
    } catch (err) {
        console.error("[CLIENTS] create error:", err);
        res.status(500).json({ error: "Failed to create client" });
    }
});

router.get("/:id", verifyToken, async (req, res) => {
    try {
        const client = await ClientService.getById(req.params.id);
        if (!client) return res.status(404).json({ error: "Client not found" });
        res.json(client);
    } catch (err) {
        const status = err.message && err.message.includes("Invalid") ? 400 : 500;
        res.status(status).json({ error: err.message || "Failed to fetch client" });
    }
});

router.put("/:id", verifyToken, async (req, res) => {
    try {
        const validationError = validateClientBody(req.body, { partial: true });
        if (validationError) return res.status(400).json({ error: validationError });

        const client = await ClientService.update(req.params.id, normalizeBody(req.body, { partial: true }), req.user.id);
        if (!client) return res.status(404).json({ error: "Client not found" });
        res.json(client);
    } catch (err) {
        const status = err.message && err.message.includes("Invalid") ? 400 : 500;
        if (status === 500) console.error("[CLIENTS] update error:", err);
        res.status(status).json({ error: err.message || "Failed to update client" });
    }
});

router.delete("/:id", verifyToken, async (req, res) => {
    try {
        const removed = await ClientService.remove(req.params.id);
        if (!removed) return res.status(404).json({ error: "Client not found" });
        res.json({ id: removed.id });
    } catch (err) {
        const status = err.message && err.message.includes("Invalid") ? 400 : 500;
        if (status === 500) console.error("[CLIENTS] delete error:", err);
        res.status(status).json({ error: err.message || "Failed to delete client" });
    }
});

router.get("/:id/activities", verifyToken, async (req, res) => {
    try {
        const activities = await ClientActivityService.listForClient(req.params.id);
        res.json({ activities });
    } catch (err) {
        const status = err.message && err.message.includes("Invalid") ? 400 : 500;
        if (status === 500) console.error("[CLIENTS] activities error:", err);
        res.status(status).json({ error: err.message || "Failed to load activities" });
    }
});

router.get("/:id/notes", verifyToken, async (req, res) => {
    try {
        const notes = await ClientNoteService.listForClient(req.params.id);
        res.json({ notes });
    } catch (err) {
        const status = err.message && err.message.includes("Invalid") ? 400 : 500;
        if (status === 500) console.error("[CLIENTS] notes list error:", err);
        res.status(status).json({ error: err.message || "Failed to load notes" });
    }
});

router.post("/:id/notes", verifyToken, async (req, res) => {
    try {
        const body = req.body && typeof req.body.body === "string" ? req.body.body.trim() : "";
        if (!body) return res.status(400).json({ error: "note body is required" });
        if (body.length > 5000) return res.status(400).json({ error: "note too long (max 5000)" });

        const client = await ClientService.getById(req.params.id);
        if (!client) return res.status(404).json({ error: "Client not found" });

        const author = req.body.author ? String(req.body.author).trim() : (req.user.email || null);
        const note = await ClientNoteService.create(req.params.id, { body, author, createdBy: req.user.id });
        await ClientActivityService.log(req.params.id, {
            type: "note_added",
            title: "Note added",
            description: notePreview(body),
            meta: { note_id: note.id },
            createdBy: req.user.id,
        });
        res.status(201).json(note);
    } catch (err) {
        const status = err.message && err.message.includes("Invalid") ? 400 : 500;
        if (status === 500) console.error("[CLIENTS] note create error:", err);
        res.status(status).json({ error: err.message || "Failed to create note" });
    }
});

router.put("/:id/notes/:noteId", verifyToken, async (req, res) => {
    try {
        const hasBody = req.body && req.body.body !== undefined;
        let body;
        if (hasBody) {
            body = typeof req.body.body === "string" ? req.body.body.trim() : "";
            if (!body) return res.status(400).json({ error: "note body cannot be empty" });
            if (body.length > 5000) return res.status(400).json({ error: "note too long (max 5000)" });
        }
        const author = req.body.author !== undefined ? (req.body.author ? String(req.body.author).trim() : null) : undefined;

        const note = await ClientNoteService.update(req.params.id, req.params.noteId, { body, author });
        if (!note) return res.status(404).json({ error: "Note not found" });
        await ClientActivityService.log(req.params.id, {
            type: "note_updated",
            title: "Note updated",
            description: notePreview(note.body),
            meta: { note_id: note.id },
            createdBy: req.user.id,
        });
        res.json(note);
    } catch (err) {
        const status = err.message && err.message.includes("Invalid") ? 400 : 500;
        if (status === 500) console.error("[CLIENTS] note update error:", err);
        res.status(status).json({ error: err.message || "Failed to update note" });
    }
});

router.delete("/:id/notes/:noteId", verifyToken, async (req, res) => {
    try {
        const removed = await ClientNoteService.remove(req.params.id, req.params.noteId);
        if (!removed) return res.status(404).json({ error: "Note not found" });
        await ClientActivityService.log(req.params.id, {
            type: "note_deleted",
            title: "Note deleted",
            description: notePreview(removed.body),
            meta: { note_id: removed.id },
            createdBy: req.user.id,
        });
        res.json({ id: removed.id });
    } catch (err) {
        const status = err.message && err.message.includes("Invalid") ? 400 : 500;
        if (status === 500) console.error("[CLIENTS] note delete error:", err);
        res.status(status).json({ error: err.message || "Failed to delete note" });
    }
});

module.exports = router;
