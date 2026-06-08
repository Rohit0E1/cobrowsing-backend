const express = require("express");
const { verifyToken } = require("../middleware/auth");
const DashboardService = require("../services/DashboardService");

const router = express.Router();

router.get("/summary", verifyToken, async (_req, res) => {
    try {
        res.json(await DashboardService.summary());
    } catch (err) {
        console.error("[DASHBOARD] summary error:", err);
        res.status(500).json({ error: "Failed to load summary" });
    }
});

router.get("/funnel", verifyToken, async (_req, res) => {
    try {
        res.json(await DashboardService.funnel());
    } catch (err) {
        console.error("[DASHBOARD] funnel error:", err);
        res.status(500).json({ error: "Failed to load funnel" });
    }
});

router.get("/lead-sources", verifyToken, async (_req, res) => {
    try {
        res.json(await DashboardService.leadSources());
    } catch (err) {
        console.error("[DASHBOARD] lead-sources error:", err);
        res.status(500).json({ error: "Failed to load lead sources" });
    }
});

router.get("/cities", verifyToken, async (_req, res) => {
    try {
        res.json(await DashboardService.cities());
    } catch (err) {
        console.error("[DASHBOARD] cities error:", err);
        res.status(500).json({ error: "Failed to load cities" });
    }
});

router.get("/advisors", verifyToken, async (_req, res) => {
    try {
        res.json(await DashboardService.advisors());
    } catch (err) {
        console.error("[DASHBOARD] advisors error:", err);
        res.status(500).json({ error: "Failed to load advisors" });
    }
});

router.get("/meetings", verifyToken, async (_req, res) => {
    try {
        res.json(await DashboardService.meetings());
    } catch (err) {
        console.error("[DASHBOARD] meetings error:", err);
        res.status(500).json({ error: "Failed to load meeting analytics" });
    }
});

router.get("/activities", verifyToken, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        res.json(await DashboardService.activities(limit));
    } catch (err) {
        console.error("[DASHBOARD] activities error:", err);
        res.status(500).json({ error: "Failed to load activities" });
    }
});

router.get("/insights", verifyToken, async (_req, res) => {
    try {
        res.json(await DashboardService.insights());
    } catch (err) {
        console.error("[DASHBOARD] insights error:", err);
        res.status(500).json({ error: "Failed to load insights" });
    }
});

module.exports = router;
