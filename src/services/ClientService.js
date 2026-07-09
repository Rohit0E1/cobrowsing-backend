const { pool } = require('../config/db');
const ClientActivityService = require('./ClientActivityService');

const VALID_STATUSES = ['Active', 'Pending', 'Completed'];
const VALID_DEAL_STAGES = ['inquiry', 'vsv_scheduled', 'vsv_done', 'offer', 'negotiation', 'closed_won', 'closed_lost'];

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
        const client = res.rows[0];
        if (!client) return null;

        const [notesRes, activitiesRes] = await Promise.all([
            pool.query(
                'SELECT * FROM client_notes WHERE client_id = $1 ORDER BY created_at DESC, id DESC',
                [cid]
            ),
            pool.query(
                'SELECT * FROM client_activities WHERE client_id = $1 ORDER BY created_at DESC, id DESC',
                [cid]
            ),
        ]);

        return { ...client, notes: notesRes.rows, activities: activitiesRes.rows };
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

    async create(createdBy, { name, email, phone, city, status, deal_stage, win_loss_reason, lead_source, assigned_advisor_id, last_meeting }) {
        const res = await pool.query(
            `INSERT INTO clients
             (name, email, phone, city, status, deal_stage, win_loss_reason, lead_source, assigned_advisor_id, last_meeting, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
                name,
                email,
                phone || null,
                city || null,
                VALID_STATUSES.includes(status) ? status : 'Active',
                VALID_DEAL_STAGES.includes(deal_stage) ? deal_stage : 'inquiry',
                win_loss_reason || null,
                lead_source || null,
                assigned_advisor_id || null,
                last_meeting || null,
                createdBy || null,
            ]
        );
        const created = res.rows[0];
        await ClientActivityService.log(created.id, {
            type: 'client_created',
            title: 'Lead created',
            description: `${created.name} added to pipeline`,
            meta: { deal_stage: created.deal_stage },
            createdBy: createdBy || null,
        });
        return created;
    },

    async update(id, { name, email, phone, city, status, deal_stage, win_loss_reason, lead_source, assigned_advisor_id, last_meeting }, updatedBy = null) {
        const cid = validateId(id);

        const priorRes = await pool.query('SELECT * FROM clients WHERE id = $1', [cid]);
        const prior = priorRes.rows[0];
        if (!prior) return null;

        const res = await pool.query(
            `UPDATE clients SET
                name                = COALESCE($2, name),
                email               = COALESCE($3, email),
                phone               = COALESCE($4, phone),
                city                = COALESCE($5, city),
                status              = COALESCE($6, status),
                deal_stage          = COALESCE($7, deal_stage),
                win_loss_reason     = COALESCE($8, win_loss_reason),
                lead_source         = COALESCE($9, lead_source),
                assigned_advisor_id = COALESCE($10, assigned_advisor_id),
                last_meeting        = COALESCE($11, last_meeting),
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
                win_loss_reason ?? null,
                lead_source ?? null,
                assigned_advisor_id ?? null,
                last_meeting ?? null,
            ]
        );
        const updated = res.rows[0];

        if (deal_stage != null && deal_stage !== prior.deal_stage) {
            await ClientActivityService.log(cid, {
                type: 'stage_changed',
                title: 'Pipeline stage updated',
                description: `Stage changed from ${prior.deal_stage} to ${updated.deal_stage}`,
                meta: { from: prior.deal_stage, to: updated.deal_stage, win_loss_reason: updated.win_loss_reason || null },
                createdBy: updatedBy,
            });
        }

        if (status != null && status !== prior.status) {
            await ClientActivityService.log(cid, {
                type: 'status_changed',
                title: 'Status updated',
                description: `Status changed from ${prior.status} to ${updated.status}`,
                meta: { from: prior.status, to: updated.status },
                createdBy: updatedBy,
            });
        }

        return updated;
    },

    async remove(id) {
        const cid = validateId(id);
        const res = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING id', [cid]);
        return res.rows[0] || null;
    },
};

module.exports = ClientService;
