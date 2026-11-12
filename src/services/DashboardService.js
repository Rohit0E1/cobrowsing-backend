const { pool } = require("../config/db");

const FUNNEL_STAGES = ["inquiry", "vsv_scheduled", "vsv_done", "offer", "negotiation", "closed_won"];

const DashboardService = {
    async summary(tenantId, tr = {}) {
        const params = tr.from ? [tenantId, tr.from, tr.to] : [tenantId];
        const clientFilter = tr.from ? "AND created_at BETWEEN $2 AND $3" : "";
        const meetingFilter = tr.from ? "AND start_time BETWEEN $2 AND $3" : "";

        const res = await pool.query(
            `
            SELECT
                (SELECT COUNT(*) FROM clients WHERE tenant_id = $1 ${clientFilter})::int AS total_clients,
                (SELECT COUNT(*) FROM clients WHERE tenant_id = $1 AND status = 'Active' ${clientFilter})::int AS active_clients,
                (SELECT COUNT(*) FROM meetings WHERE tenant_id = $1 ${meetingFilter})::int AS total_meetings,
                (SELECT COUNT(*) FROM meetings WHERE tenant_id = $1 AND is_active ${meetingFilter})::int AS active_meetings,
                (SELECT COUNT(*) FROM meetings WHERE tenant_id = $1 AND NOT is_active ${meetingFilter})::int AS completed_meetings,
                (SELECT COALESCE(SUM((analytics->>'content_engagement')::int), 0)
                   FROM meetings WHERE tenant_id = $1 AND analytics ? 'content_engagement' ${meetingFilter})::int AS total_engagement,
                (SELECT COUNT(*) FROM participants WHERE role = 'participant'
                   AND meeting_id IN (SELECT id FROM meetings WHERE tenant_id = $1 ${meetingFilter}))::int AS total_attendees
            `,
            params
        );
        return res.rows[0];
    },

    async funnel(tenantId, tr = {}) {
        const params = tr.from ? [tenantId, tr.from, tr.to] : [tenantId];
        const dateFilter = tr.from ? "AND created_at BETWEEN $2 AND $3" : "";
          const res = await pool.query(
            `SELECT deal_stage, COUNT(*)::int AS count
             FROM clients
             WHERE tenant_id = $1 ${dateFilter}
             GROUP BY deal_stage`,
            params
        );
        const counts = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
        for (const row of res.rows) {
            if (row.deal_stage in counts) counts[row.deal_stage] = row.count;
        }
        return counts;
    },

    async leadSources(tenantId, tr = {}) {
        const params = tr.from ? [tenantId, tr.from, tr.to] : [tenantId];
        const dateFilter = tr.from ? "AND created_at BETWEEN $2 AND $3" : "";
 
        const res = await pool.query(
            `
            SELECT COALESCE(lead_source, 'unknown') AS source, COUNT(*)::int AS count
            FROM clients
            WHERE tenant_id = $1 ${dateFilter}
            GROUP BY lead_source
            ORDER BY count DESC
            `,
            params
        );
        return res.rows;
    },

    async cities(tenantId, tr = {}) {
        const params = tr.from ? [tenantId, tr.from, tr.to] : [tenantId];
        const dateFilter = tr.from ? "AND created_at BETWEEN $2 AND $3" : "";
 
        const res = await pool.query(
            `
            SELECT COALESCE(city, 'unknown') AS city, COUNT(*)::int AS count
            FROM clients
            WHERE tenant_id = $1 ${dateFilter}
            GROUP BY city
            ORDER BY count DESC
            `,
            params
        );
        return res.rows;
    },

    async advisors(tenantId, tr = {}) {
        const params = tr.from ? [tenantId, tr.from, tr.to] : [tenantId];
        const dateFilter = tr.from ? "AND m.start_time BETWEEN $2 AND $3" : "";
 
        const res = await pool.query(
            `
            SELECT
                COALESCE(u.name, 'Unassigned') AS advisor,
                COUNT(m.id)::int AS meetings,
                COALESCE(SUM((m.analytics->>'content_engagement')::int), 0)::int AS engagement,
                COALESCE(SUM((m.analytics->>'unique_clients')::int), 0)::int AS clients_reached
            FROM meetings m
            LEFT JOIN users u ON m.moderator_id = u.id
            WHERE m.tenant_id = $1 ${dateFilter}
            GROUP BY u.id, u.name
            ORDER BY meetings DESC, engagement DESC
            `,
            params
        );
        return res.rows;
    },

    async meetings(tenantId, tr = {}) {
        const params = tr.from ? [tenantId, tr.from, tr.to] : [tenantId];
        const mFilter = tr.from ? "AND start_time BETWEEN $2 AND $3" : "";
 
        const totalsRes = await pool.query(
            `
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_active)::int AS active,
                COUNT(*) FILTER (WHERE NOT is_active)::int AS completed
            FROM meetings
            WHERE tenant_id = $1 ${mFilter}
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
            WHERE m.tenant_id = $1 AND m.analytics ? 'content_engagement'
              ${tr.from ? "AND m.start_time BETWEEN $2 AND $3" : ""}
            ORDER BY engagement DESC NULLS LAST
            `,
            params
        );
        const interactionRes = await pool.query(
            `
            SELECT e.meeting_id, COUNT(*)::int AS interactions
            FROM events e
            JOIN meetings m ON e.meeting_id = m.id
            WHERE m.tenant_id = $1 AND e.event_id = 'client_interaction'
              ${tr.from ? "AND m.start_time BETWEEN $2 AND $3" : ""}
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

    async activities(tenantId, limit = 20, tr = {}) {
        const params = [tenantId];
        let clientF = "WHERE tenant_id = $1";
        let meetingF = "WHERE tenant_id = $1";
        let schedF = "WHERE tenant_id = $1";
 
        if (tr.from) {
            params.push(tr.from, tr.to);
            clientF += " AND created_at BETWEEN $2 AND $3";
            meetingF += " AND COALESCE(completed_at, start_time) BETWEEN $2 AND $3";
            schedF += " AND created_at BETWEEN $2 AND $3";
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

    async insights(tenantId, tr = {}) {
        const params = tr.from ? [tenantId, tr.from, tr.to] : [tenantId];
        const clientDateFilter = tr.from ? "AND created_at BETWEEN $2 AND $3" : "";
        const meetingDateFilter = tr.from ? "AND start_time BETWEEN $2 AND $3" : "";
        const stageDateFilter = tr.from ? "AND created_at BETWEEN $2 AND $3" : "AND deal_stage IS NOT NULL";

        const out = [];

        const leadRes = await pool.query(
            `
            SELECT lead_source, COUNT(*)::int AS count
            FROM clients
            WHERE tenant_id = $1 AND lead_source IS NOT NULL
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
            WHERE tenant_id = $1 AND lead_source IS NOT NULL
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
            WHERE tenant_id = $1 AND analytics ? 'content_engagement'
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
            WHERE tenant_id = $1 ${stageDateFilter}
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
