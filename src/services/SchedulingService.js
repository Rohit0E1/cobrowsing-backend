const { pool } = require('../config/db');
const NotificationService = require('./NotificationService');
const CalendarService = require('./CalendarService');
const MeetingService = require('./MeetingService');

function validateId(id) {
    const n = parseInt(id, 10);
    if (isNaN(n) || n <= 0) throw new Error('Invalid meeting ID');
    return n;
}

async function getSalesperson(userId) {
    try {
        const res = await pool.query('SELECT name, email FROM users WHERE id = $1', [userId]);
        return res.rows[0] || null;
    } catch (e) {
        console.error('[SCHEDULE] Salesperson lookup failed:', e.message);
        return null;
    }
}

function buildIcalUid(uuid) {
    return 'mandake-' + uuid + '@mandake-lighthouse';
}

const SchedulingService = {
    async schedule(createdBy, { client_name, client_email, client_phone, client_city, project_id, start_time }) {
        const start = new Date(start_time);
        if (isNaN(start.getTime())) throw new Error('Invalid start_time');
        if (start <= new Date()) throw new Error('start_time must be in the future');

        const end = new Date(start.getTime() + 3600000);

        let meeting;
        try {
            const res = await pool.query(
                `INSERT INTO scheduled_meetings
                 (client_name, client_email, client_phone, client_city, project_id, start_time, end_time, status, calendar_event_id, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9)
                 RETURNING *`,
                [client_name, client_email, client_phone || null, client_city || null, project_id || null, start, end, null, createdBy]
            );
            meeting = res.rows[0];
        } catch (dbErr) {
            throw dbErr;
        }

        let uuid = null;
        let roomLink = null;
        try {
            const roomRow = await MeetingService.create(createdBy, {
                start_time: start,
                duration: 3600,
                meeting_for: client_name
            });
            uuid = roomRow.uuid;
            roomLink = (process.env.APP_URL || 'http://localhost:3000') + '/participant?meetingId=' + uuid;
        } catch (roomErr) {
            console.error('[SCHEDULE] Meeting room creation failed:', roomErr.message);
            await pool.query('DELETE FROM scheduled_meetings WHERE id = $1', [meeting.id]);
            throw roomErr;
        }

        const salesperson = await getSalesperson(createdBy);
        const icalUid = buildIcalUid(uuid);

        let calendarEventId = null;
        try {
            calendarEventId = await CalendarService.createEvent(start, {
                clientName: client_name,
                clientEmail: client_email,
                salespersonName: salesperson && salesperson.name,
                salespersonEmail: salesperson && salesperson.email,
                roomLink,
                iCalUid: icalUid
            });
        } catch (calErr) {
            console.error('[SCHEDULE] Calendar create failed:', calErr.message);
        }

        if (uuid !== null || calendarEventId !== null) {
            await pool.query(
                'UPDATE scheduled_meetings SET meeting_uuid = $1, calendar_event_id = $2 WHERE id = $3',
                [uuid, calendarEventId, meeting.id]
            );
            meeting.meeting_uuid = uuid;
            meeting.calendar_event_id = calendarEventId;
            meeting.room_link = roomLink;
        }

        NotificationService.sendInvite(client_email, client_name, client_phone, start, roomLink, icalUid, salesperson).catch(e =>
            console.error('[SCHEDULE] Notification failed:', e.message)
        );

        return meeting;
    },

    async reschedule(id, userId, { start_time }) {
        const safeId = validateId(id);
        const row = await pool.query(
            'SELECT * FROM scheduled_meetings WHERE id = $1 AND created_by = $2',
            [safeId, userId]
        );
        if (!row.rows[0]) return null;
        const existing = row.rows[0];

        if (existing.status === 'cancelled') throw new Error('Cannot reschedule a cancelled meeting');

        const start = new Date(start_time);
        if (isNaN(start.getTime())) throw new Error('Invalid start_time');
        if (start <= new Date()) throw new Error('New start_time must be in the future');

        const end = new Date(start.getTime() + 3600000);

        const existingUuid = existing.meeting_uuid;
        const roomLink = existingUuid
            ? (process.env.APP_URL || 'http://localhost:3000') + '/participant?meetingId=' + existingUuid
            : null;

        let newCalendarId = existing.calendar_event_id;
        try {
            newCalendarId = await CalendarService.updateEvent(existing.calendar_event_id, start, {
                clientName: existing.client_name,
                roomLink
            });
        } catch (calErr) {
            console.error('[RESCHEDULE] Calendar update failed:', calErr.message);
        }

        const res = await pool.query(
            `UPDATE scheduled_meetings
             SET start_time = $1, end_time = $2, status = 'rescheduled', calendar_event_id = $3, updated_at = NOW()
             WHERE id = $4 AND created_by = $5 RETURNING *`,
            [start, end, newCalendarId, safeId, userId]
        );

        const updated = res.rows[0];
        const salesperson = await getSalesperson(userId);
        const icalUid = existingUuid ? buildIcalUid(existingUuid) : null;
        NotificationService.sendReschedule(
            updated.client_email, updated.client_name, updated.client_phone, start, roomLink, icalUid, salesperson
        ).catch(e => console.error('[RESCHEDULE] Notification failed:', e.message));

        return updated;
    },

    async cancel(id, userId) {
        const safeId = validateId(id);
        const row = await pool.query(
            'SELECT * FROM scheduled_meetings WHERE id = $1 AND created_by = $2',
            [safeId, userId]
        );
        if (!row.rows[0]) return null;
        const existing = row.rows[0];

        if (existing.status === 'cancelled') throw new Error('Meeting is already cancelled');

        if (existing.calendar_event_id) {
            CalendarService.deleteEvent(existing.calendar_event_id).catch(e =>
                console.error('[CANCEL] Calendar delete failed:', e.message)
            );
        }

        const res = await pool.query(
            `UPDATE scheduled_meetings
             SET status = 'cancelled', updated_at = NOW()
             WHERE id = $1 AND created_by = $2 RETURNING *`,
            [safeId, userId]
        );

        const updated = res.rows[0];
        const salesperson = await getSalesperson(userId);
        const icalUid = existing.meeting_uuid ? buildIcalUid(existing.meeting_uuid) : null;
        NotificationService.sendCancellation(
            updated.client_email, updated.client_name, updated.client_phone, existing.start_time, icalUid, salesperson
        ).catch(e => console.error('[CANCEL] Notification failed:', e.message));

        return updated;
    },

    async getAll(userId) {
        const res = await pool.query(
            `SELECT sm.*, u.name AS created_by_name
             FROM scheduled_meetings sm
             LEFT JOIN users u ON sm.created_by = u.id
             WHERE sm.created_by = $1
             ORDER BY sm.start_time DESC`,
            [userId]
        );
        return res.rows;
    },

    async getById(id, userId) {
        const safeId = validateId(id);
        const res = await pool.query(
            'SELECT * FROM scheduled_meetings WHERE id = $1 AND created_by = $2',
            [safeId, userId]
        );
        return res.rows[0] || null;
    },

    async lookupCustomer({ email, phone }) {
        const trimmedEmail = email ? String(email).trim().toLowerCase() : null;
        const trimmedPhone = phone ? String(phone).trim() : null;
        if (!trimmedEmail && !trimmedPhone) return null;

        const conditions = [];
        const params = [];
        if (trimmedEmail) {
            params.push(trimmedEmail);
            conditions.push(`LOWER(client_email) = $${params.length}`);
        }
        if (trimmedPhone) {
            params.push(trimmedPhone);
            conditions.push(`client_phone = $${params.length}`);
        }

        const res = await pool.query(
            `SELECT DISTINCT ON (LOWER(client_email))
                client_name, client_email, client_phone, client_city, project_id,
                MAX(created_at) OVER (PARTITION BY LOWER(client_email)) AS last_seen_at
             FROM scheduled_meetings
             WHERE ${conditions.join(' OR ')}
             ORDER BY LOWER(client_email), created_at DESC
             LIMIT 1`,
            params
        );
        return res.rows[0] || null;
    }
};

module.exports = SchedulingService;
