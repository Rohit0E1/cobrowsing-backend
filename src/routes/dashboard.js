const express = require("express");
const { verifyToken } = require("../middleware/auth");
const DashboardService = require("../services/DashboardService");

const router = express.Router();

function parseTimeRange(req) {
    const { range, from, to } = req.query;
    if (from) {
        const fromDate = new Date(from);
        const toDate = to ? new Date(to) : new Date();
        if (!isNaN(fromDate) && !isNaN(toDate)) {
            toDate.setHours(23, 59, 59, 999);
            return { from: fromDate, to: toDate, label: "custom" };
        }
    }

    const now = new Date();
    const presets = {
        "24h": 1,
        "7d": 7,
        "30d": 30,
        "90d": 90,
        "1y": 365,
    };

    if (range === "all") {
        return { from: null, to: now, label: "all" };
    }

    const days = presets[range] ?? 30;
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - days);
    fromDate.setHours(0, 0, 0, 0);

    return { from: fromDate, to: now, label: range || "30d" };
}

function handle(name, fn) {
    return async (req, res) => {
        try {
            const timeRange = parseTimeRange(req);
            res.json(await fn(req, timeRange));
        } catch (err) {
            console.error(`[DASHBOARD] ${name} error:`, err);
            res.status(500).json({ error: `Failed to load ${name}` });
        }
    };
}

router.get("/summary", verifyToken, handle("summary", (_req, tr) => DashboardService.summary(tr)));
router.get("/funnel", verifyToken, handle("funnel", (_req, tr) => DashboardService.funnel(tr)));
router.get("/lead-sources", verifyToken, handle("lead-sources", (_req, tr) => DashboardService.leadSources(tr)));
router.get("/cities", verifyToken, handle("cities", (_req, tr) => DashboardService.cities(tr)));
router.get("/advisors", verifyToken, handle("advisors", (_req, tr) => DashboardService.advisors(tr)));
router.get("/meetings", verifyToken, handle("meetings", (_req, tr) => DashboardService.meetings(tr)));
router.get("/activities", verifyToken, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const timeRange = parseTimeRange(req);
        res.json(await DashboardService.activities(limit, timeRange));
    } catch (err) {
        console.error("[DASHBOARD] activities error:", err);
        res.status(500).json({ error: "Failed to load activities" });
    }
});
router.get("/insights", verifyToken, handle("insights", (_req, tr) => DashboardService.insights(tr)));

module.exports = router;
