const express = require("express");
const jwt = require("jsonwebtoken");
const UserService = require("../services/UserService");

const router = express.Router();

router.post("/register", async (req, res) => {
    const { name, email, phone, password, project_ids } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ status: "error", message: "Name, email, and password are required" });
    }
    try {
        const user = await UserService.register({ name, email, phone, password, project_ids });
        res.status(201).json({ status: "success", data: user });
    } catch (err) {
        
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

        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "10h" });
        const { password_hash, ...safeUser } = user;
        res.json({ status: "success", token, user: safeUser });
    } catch (err) {
        
        res.status(500).json({ status: "error", message: "Login failed" });
    }
});

module.exports = router;
