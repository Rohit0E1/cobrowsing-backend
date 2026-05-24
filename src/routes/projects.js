const express = require("express");
const { pool } = require("../config/db");
const { verifyToken } = require("../middleware/auth");
const UserService = require("../services/UserService");

const router = express.Router();

const FALLBACK_PROJECTS = [
    {
        id: "premium-showcase",
        name: "Luxury Portfolio Spotlight",
        slides: [
            "/newSlides/Welcome.html",
            "/newSlides/Slide-7.html",
            "/newSlides/Slide-Trust.html",
            "/newSlides/Slide-Portfolio.html",
            "/newSlides/Slide-2.html",
            "/newSlides/locationMapSlide1.html",
            "/newSlides/Slide-3.html",
            "/newSlides/Slide-3-2.html",
            "/newSlides/Slide-4.html",
            "/newSlides/howToReach.html",
            "/newSlides/Slide-Ultimate.html",
            "/newSlides/Slide-Marriott.html",
            "/newSlides/Slide-Helipad.html",
            "/newSlides/Slide-6.html",
            "/newSlides/Slide-9.html",
            "/newSlides/Slide-5.html",
            "/newSlides/Slide-10.html",
            "/newSlides/Slide-14.html",
            "/newSlides/Slide-13.html",
            "/newSlides/Slide-Retail.html",
            "/newSlides/Slide-Airbnb.html",
            "/newSlides/Slide-18.html",
            "/newSlides/Slide-Quiz.html",
            "/newSlides/plotViewer.html",
            "/newSlides/Slide-BuyNow.html",
            "/newSlides/Slide-PaymentSchedule.html",
            "/newSlides/Slide-Thanks.html",
        ],
    },
];

router.get("/", verifyToken, async (req, res) => {
    try {
        const projectsRes = await pool.query("SELECT * FROM projects ORDER BY id DESC");
        const projects = projectsRes.rows.length > 0 ? projectsRes.rows : FALLBACK_PROJECTS;
        const roles = await UserService.getProjectIds(req.user.id);
        res.json({ projects, roles });
    } catch (err) {
        
        res.status(500).json({ error: "Failed to load projects" });
    }
});

module.exports = router;
