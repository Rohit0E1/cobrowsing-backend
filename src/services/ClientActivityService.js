const { pool } = require('../config/db');

function validateClientId(id) {
    const n = parseInt(id, 10);
    if (isNaN(n) || n <= 0) throw new Error('Invalid client ID');
    return n;
}

const ClientActivityService = {
    async log(clientId, { type, title = null, description = null, meta = {}, createdBy = null } = {}, client = pool) {
        const cid = validateClientId(clientId);
        if (!type) throw new Error('activity type is required');
        const res = await client.query(
            `INSERT INTO client_activities (client_id, type, title, description, meta, created_by)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)
             RETURNING *`,
            [cid, type, title, description, JSON.stringify(meta || {}), createdBy]
        );
        return res.rows[0];
    },

    async listForClient(clientId) {
        const cid = validateClientId(clientId);
        const res = await pool.query(
            'SELECT * FROM client_activities WHERE client_id = $1 ORDER BY created_at DESC, id DESC',
            [cid]
        );
        return res.rows;
    },
};

module.exports = ClientActivityService;
