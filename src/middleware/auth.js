const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");

const verifyToken = async (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }

    let tenantId = decoded.tenant_id;
    if (!Number.isInteger(tenantId)) {
        try {
            const row = await pool.query("SELECT tenant_id FROM users WHERE id = $1", [decoded.id]);
            tenantId = row.rows[0]?.tenant_id;
        } catch (err) {
            return res.status(500).json({ error: "Failed to resolve session" });
        }
        if (!Number.isInteger(tenantId)) return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.user = { id: decoded.id, email: decoded.email, tenantId };
    next();
};

module.exports = { verifyToken };
