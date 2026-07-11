const express = require("express");
const { verifyToken } = require("../middleware/auth");
const ClientService = require("../services/ClientService");

const router = express.Router();

const VALID_STATUSES = ["Active", "Pending", "Completed"];
const VALID_DEAL_STAGES = ["inquiry", "vsv_scheduled", "vsv_done", "offer", "negotiation", "closed_won", "closed_lost"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateClientBody(body, { partial = false } = {}) {
    const { name, email, phone, city, status, deal_stage, lead_source, assigned_advisor_id } = body;

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
    return `deal_stage must be one of: ${VALID_DEAL_STAGES.join(", ")}`;
    }
    if (lead_source !== undefined && lead_source !== null && (typeof lead_source !== "string" || lead_source.trim().length > 255)) {
        return "lead_source must be a string up to 255 chars";
    }
    if (assigned_advisor_id !== undefined && assigned_advisor_id !== null && (typeof assigned_advisor_id !== "string" || assigned_advisor_id.trim().length > 255)) {
        return "assigned_advisor_id must be a string up to 255 chars";
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

        const { client, reused } = await ClientService.upsertByContact(req.user.id, normalizeBody(req.body));
        res.status(reused ? 200 : 201).json({ ...client, reused });
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

        const client = await ClientService.update(req.params.id, normalizeBody(req.body, { partial: true }));
        if (!client) return res.status(404).json({ error: "Client not found" });
        res.json(client);
    } catch (err) {
        if (err.status === 409 || err.code === "23505") {
            return res.status(409).json({ error: err.message || "A client with this email or phone already exists" });
        }
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

module.exports = router;
