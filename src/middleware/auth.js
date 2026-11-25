const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");
const { ownsMeeting } = require("../services/AccessScope");

const ROLES = ["super_admin", "admin", "manager", "advisor", "consultant", "viewer"];
const TENANT_WIDE_ROLES = ["super_admin", "admin", "manager", "viewer"];
const WRITE_ROLES = ["super_admin", "admin", "manager", "advisor", "consultant"];
const TEAM_ADMIN_ROLES = ["super_admin", "admin"];

/**
 * The advisor behind a login token, or null if it is missing, invalid, expired or has no membership in its tenant.
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

    const row = await pool.query(
        `SELECT ut.tenant_id, ut.role FROM user_tenants ut
         WHERE ut.user_id = $1 AND ut.tenant_id = COALESCE($2::int, (SELECT tenant_id FROM users WHERE id = $1))`,
        [decoded.id, Number.isInteger(decoded.tenant_id) ? decoded.tenant_id : null]
    );
    const membership = row.rows[0];
    if (!membership) return null;
    return { id: decoded.id, email: decoded.email, tenantId: membership.tenant_id, role: membership.role };
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
 * True when the token belongs to a non-viewer advisor who can see the meeting room: the same rule as
 * requireTenantMeeting, for places that hand out moderator powers (socket join, EnableX moderator token).
 */
async function canModerate(token, uuid) {
    const user = await userFromToken(token);
    if (!user || !WRITE_ROLES.includes(user.role)) return false;
    const { rows } = await pool.query(
        `SELECT 1 FROM meetings WHERE uuid = $1 AND tenant_id = $2 AND ${ownsMeeting("$3")}`,
        [uuid, user.tenantId, scopeOwner(user)]
    );
    return rows.length > 0;
}

const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: "You do not have permission to do this" });
    }
    next();
};

const scopeOwner = (user) => (TENANT_WIDE_ROLES.includes(user.role) ? null : user.id);

module.exports = { verifyToken, userFromToken, canModerate, bearer, requireRole, scopeOwner, ROLES, WRITE_ROLES, TEAM_ADMIN_ROLES };
