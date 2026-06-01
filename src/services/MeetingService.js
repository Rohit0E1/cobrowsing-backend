const { randomBytes } = require("node:crypto");
const { pool } = require("../config/db");

const MeetingService = {
    async create(moderatorId, { start_time, duration, meeting_for }) {
        const uuid = randomBytes(4).toString("hex");
        const res = await pool.query(
            "INSERT INTO meetings (uuid, moderator_id, start_time, duration, meeting_for) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [
                uuid,
                moderatorId,
                start_time ? new Date(start_time) : new Date(),
                duration || 5100,
                meeting_for || "Luxury Advisory",
            ]
        );
        return res.rows[0];
    },

    async recoverState(uuid) {
        const res = await pool.query("SELECT id, state FROM meetings WHERE uuid = $1", [uuid]);
        return res.rows[0] || null;
    },

    async getWithModerator(uuid) {
        const res = await pool.query(
            `SELECT m.id, m.uuid, m.start_time, m.duration, m.enablex_room_id, m.notes, u.name AS moderator_name
             FROM meetings m
             LEFT JOIN users u ON m.moderator_id = u.id
             WHERE m.uuid = $1`,
            [uuid]
        );
        return res.rows[0] || null;
    },

    async getAll() {
        const res = await pool.query(`
            SELECT
                m.*,
                u.name AS moderator_name,
                COUNT(p.id) FILTER (WHERE p.role = 'participant') AS client_count
            FROM meetings m
            LEFT JOIN users u ON m.moderator_id = u.id
            LEFT JOIN participants p ON p.meeting_id = m.id
            GROUP BY m.id, u.name
            ORDER BY m.id DESC
        `);
        return res.rows;
    },

    async reset(uuid) {
        const EnableXService = require("../enablex/EnableXService");
        const res = await pool.query("SELECT enablex_room_id FROM meetings WHERE uuid = $1", [uuid]);
        const roomId = res.rows[0]?.enablex_room_id;

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
        return res.rows[0] || null;
    },
};

module.exports = MeetingService;
