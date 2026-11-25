const KnowledgeService = require("./KnowledgeService");
const { randomBytes } = require("node:crypto");
const { pool } = require("../config/db");
const { CLIENTS_JOINED_SQL } = require("./AnalyticsService");

const DETAILS_SELECT = `
    SELECT
        m.*,
        u.name AS moderator_name,
        (SELECT ${CLIENTS_JOINED_SQL} FROM participants p WHERE p.meeting_id = m.id) AS client_count,
        (SELECT COUNT(*) FROM meeting_recordings r WHERE r.meeting_id = m.id AND r.status <> 'none')::int AS recording_count,
        sm.id AS schedule_id,
        sm.client_id,
        sm.client_name,
        sm.calendar_event_id,
        sm.status AS schedule_status,
        pr.name AS project_name
    FROM meetings m
    LEFT JOIN users u ON m.moderator_id = u.id
    LEFT JOIN scheduled_meetings sm ON sm.meeting_uuid = m.uuid AND sm.tenant_id = m.tenant_id
    LEFT JOIN projects pr ON pr.id = sm.project_id`;

const MeetingService = {
    async create(tenantId, moderatorId, { start_time, duration, meeting_for }) {
        const uuid = randomBytes(4).toString("hex");
        const res = await pool.query(
            "INSERT INTO meetings (uuid, moderator_id, start_time, duration, meeting_for, tenant_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [
                uuid,
                moderatorId,
                start_time ? new Date(start_time) : new Date(),
                duration || 5100,
                meeting_for || "Luxury Advisory",
                tenantId,
            ]
        );
        return res.rows[0];
    },

    /** True when the presentation behind this room was cancelled (clients may no longer join it). */
    async isCancelled(uuid) {
        const res = await pool.query(
            "SELECT 1 FROM scheduled_meetings WHERE meeting_uuid = $1 AND status = 'cancelled' LIMIT 1",
            [uuid]
        );
        return res.rowCount > 0;
    },

    async recoverState(uuid) {
        const res = await pool.query("SELECT id, state FROM meetings WHERE uuid = $1", [uuid]);
        return res.rows[0] || null;
    },

    async getWithModerator(uuid) {
        const res = await pool.query(
            `SELECT
                m.*,
                u.name AS moderator_name,
                t.deck_origin,
                ${CLIENTS_JOINED_SQL} AS client_count,
                EXISTS (
                    SELECT 1 FROM scheduled_meetings sm WHERE sm.meeting_uuid = m.uuid AND sm.status = 'cancelled'
                ) AS cancelled
             FROM meetings m
             JOIN tenants t ON t.id = m.tenant_id
             LEFT JOIN users u ON m.moderator_id = u.id
             LEFT JOIN participants p ON p.meeting_id = m.id
             WHERE m.uuid = $1
             GROUP BY m.id, u.name, t.deck_origin`,
            [uuid]
        );
        return res.rows[0] || null;
    },

    async getAll(tenantId) {
        const res = await pool.query(`
            SELECT
                m.*,
                u.name AS moderator_name,
                ${CLIENTS_JOINED_SQL} AS client_count,
                (SELECT COUNT(*) FROM meeting_recordings r WHERE r.meeting_id = m.id AND r.status <> 'none')::int AS recording_count,
                -- The schedule row (if this room was scheduled): its id is what reschedule/cancel take.
                sm.id AS schedule_id,
                sm.calendar_event_id,
                sm.client_name,
                sm.status AS schedule_status
            FROM meetings m
            LEFT JOIN users u ON m.moderator_id = u.id
            LEFT JOIN participants p ON p.meeting_id = m.id
            LEFT JOIN scheduled_meetings sm ON sm.meeting_uuid = m.uuid
            WHERE m.tenant_id = $1
            GROUP BY m.id, u.name, sm.id
            ORDER BY m.id DESC
        `, [tenantId]);
        return res.rows;
    },

    async getDetails(tenantId, uuid) {
        const res = await pool.query(`${DETAILS_SELECT} WHERE m.tenant_id = $1 AND m.uuid = $2`, [tenantId, uuid]);
        return res.rows[0] || null;
    },

    async listForClient(tenantId, clientId) {
        const res = await pool.query(
            `${DETAILS_SELECT}
             WHERE m.tenant_id = $1
               AND (sm.client_id = $2
                    OR (sm.client_id IS NULL AND LOWER(sm.client_email) = (SELECT LOWER(email) FROM clients WHERE id = $2 AND tenant_id = $1)))
             ORDER BY m.start_time DESC, m.id DESC`,
            [tenantId, clientId]
        );
        return res.rows;
    },

    async reset(uuid) {
        const EnableXService = require("../enablex/EnableXService");
        const res = await pool.query("SELECT enablex_room_id FROM meetings WHERE uuid = $1", [uuid]);
        const roomId = res.rows[0]?.enablex_room_id;

        if (roomId) {
            await pool.query(
                `INSERT INTO meeting_recordings (meeting_id, enablex_room_id)
                 SELECT id, $2 FROM meetings WHERE uuid = $1
                 ON CONFLICT (enablex_room_id) DO NOTHING`,
                [uuid, roomId]
            ).catch((e) => console.warn(`Failed to track recording for room ${roomId}:`, e.message));
        }

        await pool.query("UPDATE meetings SET state = '{}'::jsonb, enablex_room_id = NULL WHERE uuid = $1", [uuid]);

        if (roomId) {
            try {
                await EnableXService.deleteRoom(roomId);
            } catch (e) {
                console.warn(`Failed to delete EnableX room ${roomId} on reset:`, e.message);
            }
        }
    },

    async recordUrlChange(meetingPk, state, slideName) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(
                "UPDATE meetings SET state = $1::jsonb WHERE id = $2",
                [JSON.stringify(state), meetingPk]
            );
            await client.query(
                "INSERT INTO events (meeting_id, event_id, name, time, duration, user_name, user_mobile) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [meetingPk, "slide_view", `Viewed ${slideName}`, new Date(), 0, "Advisor", ""]
            );
            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },

    async registerParticipant(meetingPk, socketId, name, mobile, role, location) {
        await pool.query(
            "INSERT INTO participants (meeting_id, socket_id, name, mobile, role, location) VALUES ($1, $2, $3, $4, $5, $6)",
            [meetingPk, socketId, name, mobile, role, location ? JSON.stringify(location) : null]
        );
    },

    async updateParticipantLocation(socketId, location) {
        await pool.query(
            "UPDATE participants SET location = $1 WHERE socket_id = $2",
            [location ? JSON.stringify(location) : null, socketId]
        );
    },

    async markParticipantLeft(socketId) {
        await pool.query("UPDATE participants SET left_at = NOW() WHERE socket_id = $1", [socketId]);
    },

    async updateEnableXRoom(uuid, roomId) {
        await pool.query("UPDATE meetings SET enablex_room_id = $1 WHERE uuid = $2", [roomId, uuid]);
    },

    async clearEnableXRoom(uuid) {
        await pool.query("UPDATE meetings SET enablex_room_id = NULL WHERE uuid = $1", [uuid]);
    },

    async updateTranscript(uuid, transcript) {
        const res = await pool.query(
            "UPDATE meetings SET transcript = $1 WHERE uuid = $2 RETURNING uuid, transcript",
            [transcript, uuid]
        );
        if (res.rows[0]) KnowledgeService.queue(`meeting:${uuid}`);
        return res.rows[0] || null;
    },
    
    async addNote(uuid, noteText) {
        const noteId = Date.now().toString();
        const res = await pool.query(
            `UPDATE meetings 
             SET notes = COALESCE(notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', $1::text, 'text', $2::text, 'time', NOW()))
             WHERE uuid = $3 
             RETURNING uuid, notes`,
            [noteId, noteText, uuid]
        );
        if (res.rows[0]) KnowledgeService.queue(`meeting:${uuid}`);
        return res.rows[0] || null;
    },

    async editNote(uuid, noteId, newText) {
        // We use jsonb_set with a subquery to find the index, or just update the whole array in JS
        // Using JS for simplicity and safety with indexes
        const meeting = await this.getWithModerator(uuid);
        if (!meeting || !meeting.notes) return null;

        const updatedNotes = meeting.notes.map(n => 
            n.id === noteId ? { ...n, text: newText, updated_at: new Date() } : n
        );

        const res = await pool.query(
            "UPDATE meetings SET notes = $1::jsonb WHERE uuid = $2 RETURNING uuid, notes",
            [JSON.stringify(updatedNotes), uuid]
        );
        if (res.rows[0]) KnowledgeService.queue(`meeting:${uuid}`);
        return res.rows[0] || null;
    },

    async deleteNote(uuid, noteId) {
        const meeting = await this.getWithModerator(uuid);
        if (!meeting || !meeting.notes) return null;

        const updatedNotes = meeting.notes.filter(n => n.id !== noteId);

        const res = await pool.query(
            "UPDATE meetings SET notes = $1::jsonb WHERE uuid = $2 RETURNING uuid, notes",
            [JSON.stringify(updatedNotes), uuid]
        );
        if (res.rows[0]) KnowledgeService.queue(`meeting:${uuid}`);
        return res.rows[0] || null;
    },
};

module.exports = MeetingService;
