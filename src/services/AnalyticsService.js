const { pool } = require("../config/db");

const AnalyticsService = {
    /**
     * Finalizes a meeting session:
     *   1. Marks is_active = false
     *   2. Aggregates events into analytics JSONB
     * All in a single transaction — no partial state on failure.
     */
    async summarize(meetingPk) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            await client.query(
                "UPDATE meetings SET is_active = false, completed_at = NOW() WHERE id = $1",
                [meetingPk]
            );

            const statsRes = await client.query(
                `SELECT
                    COUNT(*) FILTER (WHERE event_id = 'client_interaction') AS interactions,
                    COUNT(DISTINCT user_name) FILTER (WHERE event_id NOT LIKE 'moderator_%') AS unique_clients,
                    COUNT(*) FILTER (WHERE event_id = 'slide_view') AS slide_views
                FROM events WHERE meeting_id = $1`,
                [meetingPk]
            );

            const stats = statsRes.rows[0];
            const analytics = {
                total_interactions: parseInt(stats.interactions || 0),
                unique_clients: parseInt(stats.unique_clients || 0),
                content_engagement: parseInt(stats.slide_views || 0),
                synthesized_at: new Date().toISOString(),
            };

            await client.query(
                "UPDATE meetings SET analytics = $1::jsonb WHERE id = $2",
                [JSON.stringify(analytics), meetingPk]
            );

            await client.query("COMMIT");
            return analytics;
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },
};

module.exports = AnalyticsService;
