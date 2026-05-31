const express = require("express");
const { verifyToken } = require("../middleware/auth");
const ProjectService = require("../services/ProjectService");
const UserService = require("../services/UserService");

const router = express.Router();

const VALID_STATUSES = ["active", "archived"];

function validateProjectBody(body, { partial = false } = {}) {
    const { name, slides, city, status } = body;

    const nameSupplied = name !== undefined;
    if (!partial || nameSupplied) {
        if (!name || typeof name !== "string" || !name.trim()) {
            return "name is required";
        }
        if (name.trim().length > 255) {
            return "name too long (max 255)";
        }
    }
    if (slides !== undefined && !Array.isArray(slides)) {
        return "slides must be an array";
    }
    if (city !== undefined && city !== null && (typeof city !== "string" || city.trim().length > 255)) {
        return "city must be a string up to 255 chars";
    }
    if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
        return "status must be 'active' or 'archived'";
    }
    return null;
}

router.get("/", verifyToken, async (req, res) => {
    try {
        const projects = await ProjectService.getAll();
        const roles = await UserService.getProjectIds(req.user.id);
        res.json({ projects, roles });
    } catch (err) {
        console.error("[PROJECTS] getAll error:", err);
        res.status(500).json({ error: "Failed to load projects" });
    }
});

router.post("/", verifyToken, async (req, res) => {
    try {
        const validationError = validateProjectBody(req.body);
        if (validationError) return res.status(400).json({ error: validationError });

        const project = await ProjectService.create({
            name: req.body.name.trim(),
            slides: req.body.slides,
            city: req.body.city ? req.body.city.trim() : null,
            status: req.body.status,
        });
        res.status(201).json(project);
    } catch (err) {
        console.error("[PROJECTS] create error:", err);
        res.status(500).json({ error: "Failed to create project" });
    }
});

router.get("/:id", verifyToken, async (req, res) => {
    try {
        const project = await ProjectService.getById(req.params.id);
        if (!project) return res.status(404).json({ error: "Project not found" });
        res.json(project);
    } catch (err) {
        const status = err.message && err.message.includes("Invalid") ? 400 : 500;
        res.status(status).json({ error: err.message || "Failed to fetch project" });
    }
});

router.put("/:id", verifyToken, async (req, res) => {
    try {
        const validationError = validateProjectBody(req.body, { partial: true });
        if (validationError) return res.status(400).json({ error: validationError });

        const project = await ProjectService.update(req.params.id, {
            name: req.body.name !== undefined ? req.body.name.trim() : undefined,
            slides: req.body.slides,
            city: req.body.city !== undefined ? (req.body.city ? req.body.city.trim() : null) : undefined,
            status: req.body.status,
        });
        if (!project) return res.status(404).json({ error: "Project not found" });
        res.json(project);
    } catch (err) {
        const status = err.message && err.message.includes("Invalid") ? 400 : 500;
        if (status === 500) console.error("[PROJECTS] update error:", err);
        res.status(status).json({ error: err.message || "Failed to update project" });
    }
});

router.delete("/:id", verifyToken, async (req, res) => {
    try {
        const removed = await ProjectService.remove(req.params.id);
        if (!removed) return res.status(404).json({ error: "Project not found" });
        res.json({ id: removed.id });
    } catch (err) {
        const status = err.message && err.message.includes("Invalid") ? 400 : 500;
        if (status === 500) console.error("[PROJECTS] delete error:", err);
        res.status(status).json({ error: err.message || "Failed to delete project" });
    }
});

module.exports = router;
