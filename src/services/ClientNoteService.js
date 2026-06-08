const { pool } = require('../config/db');

function validateClientId(id) {
    const n = parseInt(id, 10);
    if (isNaN(n) || n <= 0) throw new Error('Invalid client ID');
    return n;
}

function validateNoteId(id) {
    const n = parseInt(id, 10);
    if (isNaN(n) || n <= 0) throw new Error('Invalid note ID');
    return n;
}

const ClientNoteService = {
    async listForClient(clientId) {
        const cid = validateClientId(clientId);
        const res = await pool.query(
            'SELECT * FROM client_notes WHERE client_id = $1 ORDER BY created_at DESC, id DESC',
            [cid]
        );
        return res.rows;
    },

    async create(clientId, { body, author, createdBy } = {}) {
        const cid = validateClientId(clientId);
        const res = await pool.query(
            `INSERT INTO client_notes (client_id, body, author, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [cid, body, author || null, createdBy || null]
        );
        return res.rows[0];
    },

    async update(clientId, noteId, { body, author } = {}) {
        const cid = validateClientId(clientId);
        const nid = validateNoteId(noteId);
        const res = await pool.query(
            `UPDATE client_notes SET
                body      = COALESCE($3, body),
                author    = COALESCE($4, author),
                updated_at = NOW()
             WHERE id = $1 AND client_id = $2
             RETURNING *`,
            [nid, cid, body ?? null, author ?? null]
        );
        return res.rows[0] || null;
    },

    async remove(clientId, noteId) {
        const cid = validateClientId(clientId);
        const nid = validateNoteId(noteId);
        const res = await pool.query(
            'DELETE FROM client_notes WHERE id = $1 AND client_id = $2 RETURNING *',
            [nid, cid]
        );
        return res.rows[0] || null;
    },
};

module.exports = ClientNoteService;
