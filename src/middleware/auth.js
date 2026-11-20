const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");

/**
 * The advisor behind a login token, or null if it is missing, invalid, expired or has no tenant.
 * Shared by the HTTP middleware below and the socket join (which has no Express request).
 */
async function userFromToken(token) {
    if (!token) return null;
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return null;
    }

    let tenantId = decoded.tenant_id;
    if (!Number.isInteger(tenantId)) {
        const row = await pool.query("SELECT tenant_id FROM users WHERE id = $1", [decoded.id]);
        tenantId = row.rows[0]?.tenant_id;
        if (!Number.isInteger(tenantId)) return null;
    }
    return { id: decoded.id, email: decoded.email, tenantId, exp: decoded.exp };
}

/** The bearer token from an Authorization header, if any. */
function bearer(header) {
    const value = header || "";
    return value.startsWith("Bearer ") ? value.slice(7) : null;
}

const verifyToken = async (req, res, next) => {
    const token = bearer(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Missing token" });

    let user;
    try {
        user = await userFromToken(token);
    } catch (err) {
        return res.status(500).json({ error: "Failed to resolve session" });
    }
    if (!user) return res.status(401).json({ error: "Invalid or expired token" });

    req.user = user;
    next();
};

/**
 * True when the token belongs to an advisor of the tenant that owns the meeting room: the same rule as
 * requireTenantMeeting, for places that hand out moderator powers (socket join, EnableX moderator token).
 */
async function canModerate(token, uuid) {
    const user = await userFromToken(token);
    if (!user) return false;
    const { rows } = await pool.query("SELECT tenant_id FROM meetings WHERE uuid = $1", [uuid]);
    return rows[0]?.tenant_id === user.tenantId;
}

module.exports = { verifyToken, userFromToken, canModerate, bearer };
