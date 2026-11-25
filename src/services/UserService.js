const bcrypt = require("bcrypt");
const { pool } = require("../config/db");

const UserService = {
    async register(tenantId, { name, email, phone, password, project_ids }, role) {
        const hash = await bcrypt.hash(password, 10);
        const res = await pool.query(
            `WITH u AS (
                INSERT INTO users (name, email, phone, password_hash, project_ids, tenant_id) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, name, email, phone, project_ids, tenant_id
             ), m AS (
                INSERT INTO user_tenants (user_id, tenant_id, role) SELECT id, tenant_id, $7 FROM u
             )
             SELECT u.*, $7::varchar AS role FROM u`,
            [name, email, phone, hash, project_ids || {}, tenantId, role]
        );
        return res.rows[0];
    },

    async findByEmail(email) {
        const res = await pool.query(
            `SELECT u.*, ut.role, json_build_object('slug', t.slug, 'name', t.name, 'deck_origin', t.deck_origin) AS tenant
             FROM users u JOIN tenants t ON t.id = u.tenant_id
             LEFT JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = u.tenant_id
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
