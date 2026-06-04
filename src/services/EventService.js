const { pool } = require("../config/db");

const EventService = {
    /** Single aggregation query replacing the 3 separate queries in the old /stats endpoint */
    async getStats() {
        const res = await pool.query(`
            SELECT
                COUNT(DISTINCT m.id) AS total,
                COUNT(DISTINCT e.meeting_id) AS engaged_count,
                COUNT(e.id) FILTER (
                    WHERE e.event_id IN ('client_interaction', 'moderator_ended', 'participant_joined', 'slide_view')
                ) AS portfolio_views
            FROM meetings m
            LEFT JOIN events e ON e.meeting_id = m.id
        `);
        const row = res.rows[0];
        const total = parseInt(row.total) || 0;
        const engaged = parseInt(row.engaged_count) || 0;
        return {
            total,
            portfolio_views: parseInt(row.portfolio_views) || 0,
            engagement_rate: `${total > 0 ? Math.round((engaged / total) * 100) : 0}%`,
        };
    },

    /** Activity log for a single meeting — paginated */
    async getActivity(meetingPk, page = 1) {
        const pageSize = 15;
        const currentPage = Math.max(1, parseInt(page, 10) || 1);
        const offset = (currentPage - 1) * pageSize;

        const countRes = await pool.query(
            "SELECT COUNT(*) FROM events WHERE meeting_id = $1",
            [meetingPk]
        );
        const total = parseInt(countRes.rows[0].count, 10);

        const res = await pool.query(
            "SELECT * FROM events WHERE meeting_id = $1 ORDER BY time DESC LIMIT $2 OFFSET $3",
            [meetingPk, pageSize, offset]
        );

        return {
            data: res.rows,
            pagination: {
                page: currentPage,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            },
        };
    },

    async getLiveStream() {
        const res = await pool.query(`
            SELECT e.*, m.meeting_for
            FROM events e
            JOIN meetings m ON e.meeting_id = m.id
            ORDER BY e.time DESC
            LIMIT 10
        `);
        return res.rows;
    },

    /**
     * Records a behavioral event + updates meeting-level analytics counter.
     * Wrapped in a transaction so both succeed or both fail.
     */
    async record(meetingPk, { event_id, name, time, duration, user_name, user_mobile, meta }) {
        const activityTime = time ? new Date(time) : new Date();
        const metaJson = meta && typeof meta === "object" ? meta : {};
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(
                "INSERT INTO events (meeting_id, event_id, name, time, duration, user_name, user_mobile, meta) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                [meetingPk, event_id, name, activityTime, duration, user_name, user_mobile, JSON.stringify(metaJson)]
            );
            await client.query(
                `UPDATE meetings SET analytics = jsonb_set(
                    jsonb_set(
                        analytics,
                        '{total_interactions}',
                        (COALESCE(analytics->>'total_interactions', '0')::int + 1)::text::jsonb
                    ),
                    '{last_activity}', to_jsonb($1::text)
                ) WHERE id = $2`,
                [activityTime.toISOString(), meetingPk]
            );
            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },

    /** Fire-and-forget insert used by socket analytics handler */
    async recordClick(meetingPk, event) {
        await pool.query(
            "INSERT INTO events (meeting_id, event_id, name, time, duration, user_name, user_mobile, user_title) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            [
                meetingPk,
                event.event_id,
                event.name,
                event.time,
                event.duration,
                event.user_name,
                event.user_mobile,
                event.user_title || "",
            ]
        );
    },
};

module.exports = EventService;
