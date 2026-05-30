const { pool } = require('../config/db');

const VALID_STATUSES = ['active', 'archived'];

function validateId(id) {
    const n = parseInt(id, 10);
    if (isNaN(n) || n <= 0) throw new Error('Invalid project ID');
    return n;
}

const ProjectService = {
    async getAll() {
        const res = await pool.query('SELECT * FROM projects ORDER BY id DESC');
        return res.rows;
    },

    async getById(id) {
        const pid = validateId(id);
        const res = await pool.query('SELECT * FROM projects WHERE id = $1', [pid]);
        return res.rows[0] || null;
    },

    async create({ name, slides, city, status }) {
        const res = await pool.query(
            `INSERT INTO projects (name, slides, city, status)
             VALUES ($1, $2::jsonb, $3, $4)
             RETURNING *`,
            [
                name,
                JSON.stringify(Array.isArray(slides) ? slides : []),
                city || null,
                VALID_STATUSES.includes(status) ? status : 'active',
            ]
        );
        return res.rows[0];
    },

    async update(id, { name, slides, city, status }) {
        const pid = validateId(id);
        const res = await pool.query(
            `UPDATE projects SET
                name   = COALESCE($2, name),
                slides = COALESCE($3::jsonb, slides),
                city   = COALESCE($4, city),
                status = COALESCE($5, status)
             WHERE id = $1
             RETURNING *`,
            [
                pid,
                name ?? null,
                slides !== undefined ? JSON.stringify(slides) : null,
                city ?? null,
                status ?? null,
            ]
        );
        return res.rows[0] || null;
    },

    async remove(id) {
        const pid = validateId(id);
        const res = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING id', [pid]);
        return res.rows[0] || null;
    },
};

module.exports = ProjectService;
