const { pool } = require('../config/db');

const VALID_STATUSES = ['Active', 'Pending', 'Completed'];
const VALID_DEAL_STAGES = ['inquiry', 'tour', 'offer', 'closed'];

function validateId(id) {
    const n = parseInt(id, 10);
    if (isNaN(n) || n <= 0) throw new Error('Invalid client ID');
    return n;
}

const ClientService = {
    async getAll() {
        const res = await pool.query('SELECT * FROM clients ORDER BY id DESC');
        return res.rows;
    },

    async getById(id) {
        const cid = validateId(id);
        const res = await pool.query('SELECT * FROM clients WHERE id = $1', [cid]);
        return res.rows[0] || null;
    },

    async findByEmail(email) {
        const target = email ? String(email).trim().toLowerCase() : '';
        if (!target) return null;
        const res = await pool.query(
            'SELECT * FROM clients WHERE LOWER(email) = $1 ORDER BY id DESC LIMIT 1',
            [target]
        );
        return res.rows[0] || null;
    },

    async create(createdBy, { name, email, phone, city, status, deal_stage, lead_source, assigned_advisor_id, last_meeting }) {
        const res = await pool.query(
            `INSERT INTO clients
             (name, email, phone, city, status, deal_stage, lead_source, assigned_advisor_id, last_meeting, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                name,
                email,
                phone || null,
                city || null,
                VALID_STATUSES.includes(status) ? status : 'Active',
                VALID_DEAL_STAGES.includes(deal_stage) ? deal_stage : 'inquiry',
                lead_source || null,
                assigned_advisor_id || null,
                last_meeting || null,
                createdBy || null,
            ]
        );
        return res.rows[0];
    },

    async update(id, { name, email, phone, city, status, deal_stage, lead_source, assigned_advisor_id, last_meeting }) {
        const cid = validateId(id);
        const res = await pool.query(
            `UPDATE clients SET
                name                = COALESCE($2, name),
                email               = COALESCE($3, email),
                phone               = COALESCE($4, phone),
                city                = COALESCE($5, city),
                status              = COALESCE($6, status),
                deal_stage          = COALESCE($7, deal_stage),
                lead_source         = COALESCE($8, lead_source),
                assigned_advisor_id = COALESCE($9, assigned_advisor_id),
                last_meeting        = COALESCE($10, last_meeting),
                updated_at          = NOW()
             WHERE id = $1
             RETURNING *`,
            [
                cid,
                name ?? null,
                email ?? null,
                phone ?? null,
                city ?? null,
                status ?? null,
                deal_stage ?? null,
                lead_source ?? null,
                assigned_advisor_id ?? null,
                last_meeting ?? null,
            ]
        );
        return res.rows[0] || null;
    },

    async remove(id) {
        const cid = validateId(id);
        const res = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING id', [cid]);
        return res.rows[0] || null;
    },
};

module.exports = ClientService;
