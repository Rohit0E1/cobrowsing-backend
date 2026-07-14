const { pool } = require("../config/db");

const FUNNEL_STAGES = ["inquiry", "vsv_scheduled", "vsv_done", "offer", "negotiation", "closed_won"];

const DashboardService = {
    async summary(tr = {}) {
        const params = tr.from ? [tr.from, tr.to] : [];
        const clientFilter = tr.from ? "WHERE created_at BETWEEN $1 AND $2" : "";
        const activeClientFilter = tr.from ? "AND created_at BETWEEN $1 AND $2" : "";
        const meetingFilter = tr.from ? "WHERE start_time BETWEEN $1 AND $2" : "";
        const activeMeetingFilter = tr.from ? "AND start_time BETWEEN $1 AND $2" : "";
        const attendeesFilter = tr.from
            ? "AND meeting_id IN (SELECT id FROM meetings WHERE start_time BETWEEN $1 AND $2)"
            : "";

        const res = await pool.query(
            `
            SELECT
                (SELECT COUNT(*) FROM clients ${clientFilter})::int AS total_clients,
                (SELECT COUNT(*) FROM clients WHERE status = 'Active' ${activeClientFilter})::int AS active_clients,
                (SELECT COUNT(*) FROM meetings ${meetingFilter})::int AS total_meetings,
                (SELECT COUNT(*) FROM meetings WHERE is_active ${activeMeetingFilter})::int AS active_meetings,
                (SELECT COUNT(*) FROM meetings WHERE NOT is_active ${activeMeetingFilter})::int AS completed_meetings,
                (SELECT COALESCE(SUM((analytics->>'content_engagement')::int), 0)
                   FROM meetings WHERE analytics ? 'content_engagement' ${activeMeetingFilter})::int AS total_engagement,
                (SELECT COUNT(*) FROM participants WHERE role = 'participant' ${attendeesFilter})::int AS total_attendees
            `,
            params
        );
        return res.rows[0];
    },

    async funnel(tr = {}) {
        const params = tr.from ? [tr.from, tr.to] : [];
        const dateFilter = tr.from ? "WHERE created_at BETWEEN $1 AND $2" : "";
          const res = await pool.query(
            `SELECT deal_stage, COUNT(*)::int AS count
             FROM clients
             ${dateFilter}
             GROUP BY deal_stage`,
            params
        );
        const counts = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
        for (const row of res.rows) {
            if (row.deal_stage in counts) counts[row.deal_stage] = row.count;
        }
        return counts;
    },

    async leadSources(tr = {}) {
        const params = tr.from ? [tr.from, tr.to] : [];
        const dateFilter = tr.from ? "WHERE created_at BETWEEN $1 AND $2" : "";
 
        const res = await pool.query(
            `
            SELECT COALESCE(lead_source, 'unknown') AS source, COUNT(*)::int AS count
            FROM clients
            ${dateFilter}
            GROUP BY lead_source
            ORDER BY count DESC
            `,
            params
        );
        return res.rows;
    },

    async cities(tr = {}) {
        const params = tr.from ? [tr.from, tr.to] : [];
        const dateFilter = tr.from ? "WHERE created_at BETWEEN $1 AND $2" : "";
 
        const res = await pool.query(
            `
            SELECT COALESCE(city, 'unknown') AS city, COUNT(*)::int AS count
            FROM clients
            ${dateFilter}
            GROUP BY city
            ORDER BY count DESC
            `,
            params
        );
        return res.rows;
    },

    async advisors(tr = {}) {
        const params = tr.from ? [tr.from, tr.to] : [];
        const dateFilter = tr.from ? "WHERE m.start_time BETWEEN $1 AND $2" : "";
 
        const res = await pool.query(
            `
            SELECT
                COALESCE(u.name, 'Unassigned') AS advisor,
                COUNT(m.id)::int AS meetings,
                COALESCE(SUM((m.analytics->>'content_engagement')::int), 0)::int AS engagement,
                COALESCE(SUM((m.analytics->>'unique_clients')::int), 0)::int AS clients_reached
            FROM meetings m
            LEFT JOIN users u ON m.moderator_id = u.id
            ${dateFilter}
            GROUP BY u.id, u.name
            ORDER BY meetings DESC, engagement DESC
            `,
            params
        );
        return res.rows;
    },

    async meetings(tr = {}) {
        const params = tr.from ? [tr.from, tr.to] : [];
        const mFilter = tr.from ? "WHERE start_time BETWEEN $1 AND $2" : "";
 
        const totalsRes = await pool.query(
            `
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_active)::int AS active,
                COUNT(*) FILTER (WHERE NOT is_active)::int AS completed
            FROM meetings
            ${mFilter}
            `,
            params
        );
 

        const engagementRes = await pool.query(
            `
            SELECT
                m.id AS meeting_id,
                m.meeting_for,
                (m.analytics->>'content_engagement')::int AS engagement
            FROM meetings m
            WHERE m.analytics ? 'content_engagement'
              ${tr.from ? "AND m.start_time BETWEEN $1 AND $2" : ""}
            ORDER BY engagement DESC NULLS LAST
            `,
            params
        );
        const interactionRes = await pool.query(
            `
            SELECT e.meeting_id, COUNT(*)::int AS interactions
            FROM events e
            ${tr.from ? "JOIN meetings m ON e.meeting_id = m.id" : ""}
            WHERE e.event_id = 'client_interaction'
              ${tr.from ? "AND m.start_time BETWEEN $1 AND $2" : ""}
            GROUP BY e.meeting_id
            ORDER BY interactions DESC
            `,
            params
        );

        return {
            ...totalsRes.rows[0],
            engagement_distribution: engagementRes.rows,
            interaction_distribution: interactionRes.rows,
        };
    },

    async activities(limit = 20, tr = {}) {
        const params = [];
        let clientF = "";
        let meetingF = "";
        let schedF = "";
 
        if (tr.from) {
            params.push(tr.from, tr.to);
            clientF = "WHERE created_at BETWEEN $1 AND $2";
            meetingF = "WHERE COALESCE(completed_at, start_time) BETWEEN $1 AND $2";
            schedF = "WHERE created_at BETWEEN $1 AND $2";
        }
 
        params.push(limit);
        const limitParam = `$${params.length}`;
 
        const res = await pool.query(
                       `
            SELECT type, title, description, created_at FROM (
                SELECT
                    'lead_created' AS type,
                    'Lead Created' AS title,
                    name || ' created' AS description,
                    created_at
                FROM clients
                ${clientF}
 
                UNION ALL
 
                SELECT
                    CASE WHEN is_active THEN 'meeting_started' ELSE 'meeting_completed' END AS type,
                    CASE WHEN is_active THEN 'Meeting Started' ELSE 'Meeting Completed' END AS title,
                    'Meeting for ' || COALESCE(meeting_for, 'session') AS description,
                    COALESCE(completed_at, start_time) AS created_at
                FROM meetings
                ${meetingF}
 
                UNION ALL
 
                SELECT
                    'meeting_scheduled' AS type,
                    'Meeting Scheduled' AS title,
                    'Scheduled with ' || client_name AS description,
                    created_at
                FROM scheduled_meetings
                ${schedF}
            ) feed
            ORDER BY created_at DESC
            LIMIT ${limitParam}
            `,
            params
        );
        return res.rows;
    },

    async insights(tr = {}) {
        const params = tr.from ? [tr.from, tr.to] : [];
        const clientDateFilter = tr.from ? "AND created_at BETWEEN $1 AND $2" : "";
        const meetingDateFilter = tr.from ? "AND start_time BETWEEN $1 AND $2" : "";
        const stageDateFilter = tr.from ? "WHERE created_at BETWEEN $1 AND $2" : "WHERE deal_stage IS NOT NULL";

        const out = [];

        const leadRes = await pool.query(
            `
            SELECT lead_source, COUNT(*)::int AS count
            FROM clients
            WHERE lead_source IS NOT NULL
            ${clientDateFilter}
            GROUP BY lead_source
            ORDER BY count DESC
            LIMIT 1
            `,
            params
        );

        const totalLeadsRes = await pool.query(
            `
            SELECT COUNT(*)::int AS count
            FROM clients
            WHERE lead_source IS NOT NULL
            ${clientDateFilter}
            `,
            params
        );

        const totalLeads = totalLeadsRes.rows[0].count;
        if (leadRes.rows[0] && totalLeads > 0) {
            const top = leadRes.rows[0];
            const pct = Math.round((top.count / totalLeads) * 100);
            out.push(`${top.lead_source} generated ${pct}% of leads`);
        }

        const topMeetingRes = await pool.query(
            `
            SELECT id, (analytics->>'content_engagement')::int AS engagement
            FROM meetings
            WHERE analytics ? 'content_engagement'
            ${meetingDateFilter}
            ORDER BY engagement DESC NULLS LAST
            LIMIT 1
            `,
            params
        );
        if (topMeetingRes.rows[0]) {
            out.push(`Meeting ${topMeetingRes.rows[0].id} has highest engagement`);
        }

        const stageRes = await pool.query(
            `
            SELECT deal_stage, COUNT(*)::int AS count
            FROM clients
            ${stageDateFilter}
            GROUP BY deal_stage
            `,
            params
        );
        for (const stage of ["vsv_scheduled", "vsv_done", "offer", "negotiation", "closed_won"]) {
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
