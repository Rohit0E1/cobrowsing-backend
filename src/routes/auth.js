const express = require("express");
const jwt = require("jsonwebtoken");
const UserService = require("../services/UserService");
const TenantService = require("../services/TenantService");
const { DEFAULT_TENANT_SLUG } = require("../config/db");
const { verifyToken, requireRole, ROLES, TEAM_ADMIN_ROLES } = require("../middleware/auth");
const router = express.Router();

router.post("/register", async (req, res) => {
    const { name, email, phone, password, project_ids } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ status: "error", message: "Name, email, and password are required" });
    }
    try {
        const tenant = await TenantService.getBySlug(DEFAULT_TENANT_SLUG);
        const user = await UserService.register(tenant.id, { name, email, phone, password, project_ids }, "consultant");
        res.status(201).json({ status: "success", data: user });
    } catch (err) {
        if (err.code === "23505") {
            return res.status(409).json({ status: "error", message: "Email already registered" });
        }
        res.status(500).json({ status: "error", message: "Registration failed" });
    }
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ status: "error", message: "Email and password are required" });
    }
    try {
        const user = await UserService.findByEmail(email);
        if (!user) return res.status(401).json({ status: "error", message: "Invalid email or password" });

        const match = await UserService.verifyPassword(password, user.password_hash);
        if (!match) return res.status(401).json({ status: "error", message: "Invalid email or password" });

        const token = jwt.sign({ id: user.id, email: user.email, tenant_id: user.tenant_id }, process.env.JWT_SECRET, { expiresIn: "10h" });
        const { password_hash, ...safeUser } = user;
        res.json({ status: "success", token, user: safeUser });
    } catch (err) {
        
        res.status(500).json({ status: "error", message: "Login failed" });
    }
});

router.get("/tenants", verifyToken, async (req, res) => {
    try {
        const tenants = await TenantService.listForUser(req.user.id);
        res.json({ status: "success", current: req.user.tenantId, tenants });
    } catch (err) {
        res.status(500).json({ status: "error", message: "Failed to load tenants" });
    }
});

router.post("/switch-tenant", verifyToken, async (req, res) => {
    const tenantId = Number(req.body?.tenant_id);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return res.status(400).json({ status: "error", message: "tenant_id is required" });
    }
    try {
        const tenant = await TenantService.getForMember(req.user.id, tenantId);
        if (!tenant) return res.status(403).json({ status: "error", message: "You do not have access to this tenant" });

        const token = jwt.sign({ id: req.user.id, email: req.user.email, tenant_id: tenant.id }, process.env.JWT_SECRET, { expiresIn: "10h" });
        res.json({ status: "success", token, tenant });
    } catch (err) {
        res.status(500).json({ status: "error", message: "Failed to switch tenant" });
    }
});

router.get("/team", verifyToken, requireRole(...TEAM_ADMIN_ROLES, "manager"), async (req, res) => {
    try {
        res.json({ status: "success", members: await TenantService.listMembers(req.user.tenantId) });
    } catch (err) {
        res.status(500).json({ status: "error", message: "Failed to load team" });
    }
});

router.patch("/team/:userId/role", verifyToken, requireRole(...TEAM_ADMIN_ROLES), async (req, res) => {
    const userId = Number(req.params.userId);
    const role = req.body?.role;
    if (!Number.isInteger(userId) || userId <= 0 || !ROLES.includes(role)) {
        return res.status(400).json({ status: "error", message: `role must be one of: ${ROLES.join(", ")}` });
    }
    if (userId === req.user.id) {
        return res.status(400).json({ status: "error", message: "You cannot change your own role" });
    }
    if (role === "super_admin" && req.user.role !== "super_admin") {
        return res.status(403).json({ status: "error", message: "Only a super admin can grant super admin" });
    }
    try {
        const member = await TenantService.setMemberRole(req.user.tenantId, userId, role, req.user.role === "super_admin");
        if (!member) return res.status(404).json({ status: "error", message: "Team member not found" });
        res.json({ status: "success", member });
    } catch (err) {
        res.status(500).json({ status: "error", message: "Failed to update role" });
    }
});

module.exports = router;
