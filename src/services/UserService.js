const bcrypt = require("bcrypt");
const { pool } = require("../config/db");

const UserService = {
    async register({ name, email, phone, password, project_ids }) {
        const hash = await bcrypt.hash(password, 10);
        const res = await pool.query(
            "INSERT INTO users (name, email, phone, password_hash, project_ids) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, phone, project_ids",
            [name, email, phone, hash, project_ids || {}]
        );
        return res.rows[0];
    },

    async findByEmail(email) {
        const res = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
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
