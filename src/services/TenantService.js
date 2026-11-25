const { pool } = require("../config/db");

const TenantService = {
    async getBySlug(slug) {
        const res = await pool.query("SELECT * FROM tenants WHERE slug = $1", [slug]);
        return res.rows[0] || null;
    },

    async listForUser(userId) {
        const res = await pool.query(
            `SELECT t.id, t.slug, t.name, t.deck_origin, ut.role FROM tenants t
             JOIN user_tenants ut ON ut.tenant_id = t.id
             WHERE ut.user_id = $1 ORDER BY t.name`,
            [userId]
        );
        return res.rows;
    },

    async getForMember(userId, tenantId) {
        const res = await pool.query(
            `SELECT t.id, t.slug, t.name, t.deck_origin, ut.role FROM tenants t
             JOIN user_tenants ut ON ut.tenant_id = t.id
             WHERE ut.user_id = $1 AND t.id = $2`,
            [userId, tenantId]
        );
        return res.rows[0] || null;
    },

    async addMember(userId, tenantId, role) {
        await pool.query(
            `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`,
            [userId, tenantId, role]
        );
    },

    async listMembers(tenantId) {
        const res = await pool.query(
            `SELECT u.id, u.name, u.email, u.phone, ut.role FROM users u
             JOIN user_tenants ut ON ut.user_id = u.id
             WHERE ut.tenant_id = $1 ORDER BY u.name`,
            [tenantId]
        );
        return res.rows;
    },

    async setMemberRole(tenantId, userId, role, canTouchSuperAdmin) {
        const res = await pool.query(
            `UPDATE user_tenants ut SET role = $3 FROM users u
             WHERE ut.tenant_id = $1 AND ut.user_id = $2 AND u.id = ut.user_id AND (ut.role <> 'super_admin' OR $4)
             RETURNING u.id, u.name, u.email, u.phone, ut.role`,
            [tenantId, userId, role, canTouchSuperAdmin]
        );
        return res.rows[0] || null;
    },

    async upsert({ slug, name, deck_origin }) {
        const res = await pool.query(
            `INSERT INTO tenants (slug, name, deck_origin) VALUES ($1, $2, $3)
             ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, deck_origin = COALESCE(EXCLUDED.deck_origin, tenants.deck_origin)
             RETURNING *`,
            [slug, name, deck_origin || null]
        );
        return res.rows[0];
    },
};

module.exports = TenantService;
