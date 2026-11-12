const bcrypt = require("bcrypt");
const { pool } = require("../config/db");

const UserService = {
    async register(tenantId, { name, email, phone, password, project_ids }) {
        const hash = await bcrypt.hash(password, 10);
        const res = await pool.query(
            "INSERT INTO users (name, email, phone, password_hash, project_ids, tenant_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, phone, project_ids, tenant_id",
            [name, email, phone, hash, project_ids || {}, tenantId]
        );
        return res.rows[0];
    },

    async findByEmail(email) {
        const res = await pool.query(
            `SELECT u.*, json_build_object('slug', t.slug, 'name', t.name, 'deck_origin', t.deck_origin) AS tenant
             FROM users u JOIN tenants t ON t.id = u.tenant_id
             WHERE u.email = $1`,
            [email]
        );
        return res.rows[0] || null;
    },

    async getProjectIds(userId) {
        const res = await pool.query("SELECT project_ids FROM users WHERE id = $1", [userId]);
        return res.rows[0]?.project_ids || {};
    },

    async verifyPassword(plaintext, hash) {
        return bcrypt.compare(plaintext, hash);
    },
};

module.exports = UserService;
