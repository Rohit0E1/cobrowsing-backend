const { pool } = require("../config/db");

const FUNNEL_STAGES = ["inquiry", "vsv_scheduled", "vsv_done", "offer", "negotiation", "closed_won", "closed_lost"];

const DashboardService = {
    async summary() {
        const res = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM clients)::int AS total_clients,
                (SELECT COUNT(*) FROM clients WHERE status = 'Active')::int AS active_clients,
                (SELECT COUNT(*) FROM meetings)::int AS total_meetings,
                (SELECT COUNT(*) FROM meetings WHERE is_active)::int AS active_meetings,
                (SELECT COUNT(*) FROM meetings WHERE NOT is_active)::int AS completed_meetings,
                (SELECT COALESCE(SUM((analytics->>'content_engagement')::int), 0)
                   FROM meetings WHERE analytics ? 'content_engagement')::int AS total_engagement,
                (SELECT COUNT(*) FROM participants WHERE role = 'participant')::int AS total_attendees
        `);
        return res.rows[0];
    },

    async funnel() {
        const res = await pool.query(
            "SELECT deal_stage, COUNT(*)::int AS count FROM clients GROUP BY deal_stage"
        );
        const counts = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
        for (const row of res.rows) {
            if (row.deal_stage in counts) counts[row.deal_stage] = row.count;
        }
        return counts;
    },

    async leadSources() {
        const res = await pool.query(`
            SELECT COALESCE(lead_source, 'unknown') AS source, COUNT(*)::int AS count
            FROM clients
            GROUP BY lead_source
            ORDER BY count DESC
        `);
        return res.rows;
    },

    async cities() {
        const res = await pool.query(`
            SELECT COALESCE(city, 'unknown') AS city, COUNT(*)::int AS count
            FROM clients
            GROUP BY city
            ORDER BY count DESC
        `);
        return res.rows;
    },

    async advisors() {
        const res = await pool.query(`
            SELECT
                COALESCE(u.name, 'Unassigned') AS advisor,
                COUNT(m.id)::int AS meetings,
                COALESCE(SUM((m.analytics->>'content_engagement')::int), 0)::int AS engagement,
                COALESCE(SUM((m.analytics->>'unique_clients')::int), 0)::int AS clients_reached
            FROM meetings m
            LEFT JOIN users u ON m.moderator_id = u.id
            GROUP BY u.id, u.name
            ORDER BY meetings DESC, engagement DESC
        `);
        return res.rows;
    },

    async meetings() {
        const totalsRes = await pool.query(`
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_active)::int AS active,
                COUNT(*) FILTER (WHERE NOT is_active)::int AS completed
            FROM meetings
        `);

        const engagementRes = await pool.query(`
            SELECT
                m.id AS meeting_id,
                m.meeting_for,
                (m.analytics->>'content_engagement')::int AS engagement
            FROM meetings m
            WHERE m.analytics ? 'content_engagement'
            ORDER BY engagement DESC NULLS LAST
        `);

        const interactionRes = await pool.query(`
            SELECT meeting_id, COUNT(*)::int AS interactions
            FROM events
            WHERE event_id = 'client_interaction'
            GROUP BY meeting_id
            ORDER BY interactions DESC
        `);

        return {
            ...totalsRes.rows[0],
            engagement_distribution: engagementRes.rows,
            interaction_distribution: interactionRes.rows,
        };
    },

    async activities(limit = 20) {
        const res = await pool.query(
            `
            SELECT type, title, description, created_at FROM (
                SELECT
                    'lead_created' AS type,
                    'Lead Created' AS title,
                    name || ' created' AS description,
                    created_at
                FROM clients

                UNION ALL

                SELECT
                    CASE WHEN is_active THEN 'meeting_started' ELSE 'meeting_completed' END AS type,
                    CASE WHEN is_active THEN 'Meeting Started' ELSE 'Meeting Completed' END AS title,
                    'Meeting for ' || COALESCE(meeting_for, 'session') AS description,
                    COALESCE(completed_at, start_time) AS created_at
                FROM meetings

                UNION ALL

                SELECT
                    'meeting_scheduled' AS type,
                    'Meeting Scheduled' AS title,
                    'Scheduled with ' || client_name AS description,
                    created_at
                FROM scheduled_meetings
            ) feed
            ORDER BY created_at DESC
            LIMIT $1
            `,
            [limit]
        );
        return res.rows;
    },

    async insights() {
        const out = [];

        const leadRes = await pool.query(`
            SELECT lead_source, COUNT(*)::int AS count
            FROM clients
            WHERE lead_source IS NOT NULL
            GROUP BY lead_source
            ORDER BY count DESC
            LIMIT 1
        `);
        const totalLeadsRes = await pool.query(
            "SELECT COUNT(*)::int AS count FROM clients WHERE lead_source IS NOT NULL"
        );
        const totalLeads = totalLeadsRes.rows[0].count;
        if (leadRes.rows[0] && totalLeads > 0) {
            const top = leadRes.rows[0];
            const pct = Math.round((top.count / totalLeads) * 100);
            out.push(`${top.lead_source} generated ${pct}% of leads`);
        }

        const topMeetingRes = await pool.query(`
            SELECT id, (analytics->>'content_engagement')::int AS engagement
            FROM meetings
            WHERE analytics ? 'content_engagement'
            ORDER BY engagement DESC NULLS LAST
            LIMIT 1
        `);
        if (topMeetingRes.rows[0]) {
            out.push(`Meeting ${topMeetingRes.rows[0].id} has highest engagement`);
        }

        const stageRes = await pool.query(`
            SELECT deal_stage, COUNT(*)::int AS count
            FROM clients
            GROUP BY deal_stage
        `);
        for (const stage of ["vsv_scheduled", "vsv_done", "offer", "negotiation", "closed_won", "closed_lost"]) {
            const row = stageRes.rows.find((r) => r.deal_stage === stage);
            if (row && row.count > 0) {
                out.push(
                    `${row.count === 1 ? "Only one lead" : `${row.count} leads`} reached ${stage} stage`
                );
            }
        }

        return out;
    },
};

module.exports = DashboardService;
