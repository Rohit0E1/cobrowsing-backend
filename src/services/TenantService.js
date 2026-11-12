const { pool } = require("../config/db");

const TenantService = {
    async getBySlug(slug) {
        const res = await pool.query("SELECT * FROM tenants WHERE slug = $1", [slug]);
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
