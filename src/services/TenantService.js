const { pool } = require("../config/db");

const TenantService = {
    async getBySlug(slug) {
        const res = await pool.query("SELECT * FROM tenants WHERE slug = $1", [slug]);
        return res.rows[0] || null;
    },

    async listForUser(userId) {
        const res = await pool.query(
            `SELECT t.id, t.slug, t.name, t.deck_origin FROM tenants t
             JOIN user_tenants ut ON ut.tenant_id = t.id
             WHERE ut.user_id = $1 ORDER BY t.name`,
            [userId]
        );
        return res.rows;
    },

    async getForMember(userId, tenantId) {
        const res = await pool.query(
            `SELECT t.id, t.slug, t.name, t.deck_origin FROM tenants t
             JOIN user_tenants ut ON ut.tenant_id = t.id
             WHERE ut.user_id = $1 AND t.id = $2`,
            [userId, tenantId]
        );
        return res.rows[0] || null;
    },

    async addMember(userId, tenantId) {
        await pool.query(
            "INSERT INTO user_tenants (user_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [userId, tenantId]
        );
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
