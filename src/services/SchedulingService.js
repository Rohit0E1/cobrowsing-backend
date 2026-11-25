const { pool } = require('../config/db');
const NotificationService = require('./NotificationService');
const CalendarService = require('./CalendarService');
const AdvisorCalendarService = require('./AdvisorCalendarService');
const MeetingService = require('./MeetingService');
const ClientService = require('./ClientService');
const ProjectService = require('./ProjectService');
const ClientActivityService = require('./ClientActivityService');

/** Puts a booking change on the client's activity timeline. Best effort: the timeline never fails a booking. */
function logBooking(meeting, type, title, createdBy, at = meeting && meeting.start_time) {
    if (!meeting || !meeting.client_id) return;
    const when = new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    ClientActivityService.log(meeting.client_id, {
        type,
        title,
        description: `${title} for ${when}`,
        meta: { scheduled_meeting_id: meeting.id, start_time: at },
        createdBy: createdBy || null,
    }).catch(e => console.error('[SCHEDULE] Activity log failed:', e.message));
}
const { scopeOwner } = require('../middleware/auth');
const { ownsSchedule } = require('./AccessScope');

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

/** One retry for a Google call that failed (a blip, an expired token being refreshed). */
async function withRetry(fn) {
    try {
        return await fn();
    } catch (first) {
        console.warn('[ADVISOR CALENDAR] retrying after:', first.message);
        return fn();
    }
}

const STALE_INVITE_WARNING =
    "The client's Google invite still shows the old details: your Google Calendar could not be updated. " +
    'They were emailed a calendar file instead. Reconnect Google Calendar in the assistant settings.';

function inviteDescription(salesperson, roomLink) {
    const host = salesperson && salesperson.name ? ' with ' + salesperson.name : '';
    return 'Your presentation' + host + ', ' + CalendarService.EVENT_TITLE + '.' + (roomLink ? '\n\nJoin: ' + roomLink : '');
}

const SchedulingService = {
    async schedule(tenantId, createdBy, owner, { client_name, client_email, client_phone, client_city, project_id, start_time }) {
        const start = new Date(start_time);
        if (isNaN(start.getTime())) throw new Error('Invalid start_time');
        if (start <= new Date()) throw new Error('start_time must be in the future');
        if (project_id && !(await ProjectService.getById(tenantId, project_id))) throw new Error('Invalid project_id');

        const end = new Date(start.getTime() + 3600000);

        const { client } = await ClientService.upsertByContact(tenantId, createdBy, {
            name: client_name,
            email: client_email,
            phone: client_phone,
            city: client_city
        }, owner);

        let meeting;
        try {
            const res = await pool.query(
                `INSERT INTO scheduled_meetings
                 (client_id, client_name, client_email, client_phone, client_city, project_id, start_time, end_time, status, calendar_event_id, created_by, tenant_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9, $10, $11)
                 RETURNING *`,
                [client.id, client.name, client.email, client.phone || null, client.city || null, project_id || null, start, end, null, createdBy, tenantId]
            );
            meeting = res.rows[0];
        } catch (dbErr) {
            throw dbErr;
        }

        let uuid = null;
        let roomLink = null;
        try {
            const roomRow = await MeetingService.create(tenantId, createdBy, {
                start_time: start,
                duration: 3600,
                meeting_for: meeting.client_name
            });
            uuid = roomRow.uuid;
            roomLink = (process.env.APP_URL || 'http://localhost:3000') + '/participant/' + uuid;
        } catch (roomErr) {
            console.error('[SCHEDULE] Meeting room creation failed:', roomErr.message);
            await pool.query('DELETE FROM scheduled_meetings WHERE id = $1', [meeting.id]);
            throw roomErr;
        }

        const salesperson = await getSalesperson(createdBy);
        const icalUid = buildIcalUid(uuid);

        // The advisor's own Google Calendar sends the client a real invite; otherwise the service calendar
        // and the emailed .ics do it.
        let calendarEventId = null;
        let advisorCalendarId = null;
        if (await AdvisorCalendarService.isConnected({ id: createdBy })) {
            try {
                const invite = await AdvisorCalendarService.createInvite({ id: createdBy }, {
                    start,
                    title: CalendarService.EVENT_TITLE,
                    description: inviteDescription(salesperson, roomLink),
                    clientEmail: meeting.client_email,
                    clientName: meeting.client_name
                });
                calendarEventId = invite.eventId;
                advisorCalendarId = invite.calendarId;
            } catch (advErr) {
                console.error('[SCHEDULE] Advisor calendar invite failed, using the service calendar:', advErr.message);
            }
        }

        if (!advisorCalendarId) {
            try {
                calendarEventId = await CalendarService.createEvent(start, {
                    clientName: meeting.client_name,
                    clientEmail: meeting.client_email,
                    salespersonName: salesperson && salesperson.name,
                    salespersonEmail: salesperson && salesperson.email,
                    roomLink,
                    iCalUid: icalUid
                });
            } catch (calErr) {
                console.error('[SCHEDULE] Calendar create failed:', calErr.message);
            }
        }

        if (uuid !== null || calendarEventId !== null) {
            await pool.query(
                'UPDATE scheduled_meetings SET meeting_uuid = $1, calendar_event_id = $2, advisor_calendar_id = $3 WHERE id = $4',
                [uuid, calendarEventId, advisorCalendarId, meeting.id]
            );
            meeting.meeting_uuid = uuid;
            meeting.calendar_event_id = calendarEventId;
            meeting.advisor_calendar_id = advisorCalendarId;
            meeting.room_link = roomLink;
        }

        logBooking(meeting, 'presentation_scheduled', 'Presentation scheduled', createdBy);

        NotificationService.sendInvite(meeting.client_email, meeting.client_name, meeting.client_phone, start, roomLink, icalUid, salesperson, { calendarFile: !advisorCalendarId }).catch(e =>
            console.error('[SCHEDULE] Notification failed:', e.message)
        );

        return meeting;
    },

    async reschedule(id, user, { start_time }) {
        const safeId = validateId(id);
        const row = await pool.query(
            `SELECT * FROM scheduled_meetings WHERE id = $1 AND tenant_id = $2 AND ${ownsSchedule('$3')}`,
            [safeId, user.tenantId, scopeOwner(user)]
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
            ? (process.env.APP_URL || 'http://localhost:3000') + '/participant/' + existingUuid
            : null;

        const salesperson = await getSalesperson(existing.created_by || user.id);
        let newCalendarId = existing.calendar_event_id;
        let advisorMoved = false;
        if (existing.advisor_calendar_id) {
            try {
                await withRetry(() => AdvisorCalendarService.moveInvite({ id: existing.created_by || user.id }, {
                    calendarId: existing.advisor_calendar_id,
                    eventId: existing.calendar_event_id,
                    start,
                    end,
                    description: inviteDescription(salesperson, roomLink)
                }));
                advisorMoved = true;
            } catch (advErr) {
                // The event lives on the advisor's Google account, so nothing else can move it. The client gets an
                // .ics and is told to drop the old entry; the advisor is told to reconnect (which heals later edits).
                console.error('[RESCHEDULE] Advisor calendar update failed, emailing an .ics instead:', advErr.message);
            }
        } else {
            try {
                newCalendarId = await CalendarService.updateEvent(existing.calendar_event_id, start, {
                    clientName: existing.client_name,
                    roomLink
                });
            } catch (calErr) {
                console.error('[RESCHEDULE] Calendar update failed:', calErr.message);
            }
        }

        const res = await pool.query(
            `UPDATE scheduled_meetings
             SET start_time = $1, end_time = $2, status = 'rescheduled', calendar_event_id = $3, updated_at = NOW()
             WHERE id = $4 RETURNING *`,
            [start, end, newCalendarId, safeId]
        );

        const updated = res.rows[0];
        // The presentations list shows the room's time, so keep it in step with the schedule.
        if (existingUuid) {
            await pool.query('UPDATE meetings SET start_time = $1 WHERE uuid = $2', [start, existingUuid]);
        }
        const icalUid = existingUuid ? buildIcalUid(existingUuid) : null;
        const staleInvite = Boolean(existing.advisor_calendar_id) && !advisorMoved;
        NotificationService.sendReschedule(
            updated.client_email, updated.client_name, updated.client_phone, start, roomLink, icalUid, salesperson,
            { calendarFile: !advisorMoved, replacesInvite: staleInvite }
        ).catch(e => console.error('[RESCHEDULE] Notification failed:', e.message));
        if (staleInvite) updated.calendar_warning = STALE_INVITE_WARNING;
        logBooking(updated, 'presentation_rescheduled', 'Presentation rescheduled', user.id);

        return updated;
    },

    async cancel(id, user) {
        const safeId = validateId(id);
        const row = await pool.query(
            `SELECT * FROM scheduled_meetings WHERE id = $1 AND tenant_id = $2 AND ${ownsSchedule('$3')}`,
            [safeId, user.tenantId, scopeOwner(user)]
        );
        if (!row.rows[0]) return null;
        const existing = row.rows[0];

        if (existing.status === 'cancelled') throw new Error('Meeting is already cancelled');

        let advisorCancelled = false;
        if (existing.advisor_calendar_id && existing.calendar_event_id) {
            try {
                await withRetry(() => AdvisorCalendarService.cancelInvite({ id: existing.created_by || user.id }, {
                    calendarId: existing.advisor_calendar_id,
                    eventId: existing.calendar_event_id
                }));
                advisorCancelled = true;
            } catch (advErr) {
                console.error('[CANCEL] Advisor calendar cancel failed, emailing an .ics instead:', advErr.message);
            }
        } else if (existing.calendar_event_id) {
            CalendarService.deleteEvent(existing.calendar_event_id).catch(e =>
                console.error('[CANCEL] Calendar delete failed:', e.message)
            );
        }

        const res = await pool.query(
            `UPDATE scheduled_meetings
             SET status = 'cancelled', updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [safeId]
        );
        // Close the presentation room too, so it no longer counts as upcoming or live anywhere.
        // (Joining by link does not check is_active; blocking that is a separate change.)
        if (existing.meeting_uuid) {
            await pool.query('UPDATE meetings SET is_active = FALSE WHERE uuid = $1', [existing.meeting_uuid]);
        }

        const updated = res.rows[0];
        logBooking(updated, 'presentation_cancelled', 'Presentation cancelled', user.id, existing.start_time);
        const salesperson = await getSalesperson(existing.created_by || user.id);
        const icalUid = existing.meeting_uuid ? buildIcalUid(existing.meeting_uuid) : null;
        const staleInvite = Boolean(existing.advisor_calendar_id) && !advisorCancelled;
        NotificationService.sendCancellation(
            updated.client_email, updated.client_name, updated.client_phone, existing.start_time, icalUid, salesperson,
            { calendarFile: !advisorCancelled, replacesInvite: staleInvite }
        ).catch(e => console.error('[CANCEL] Notification failed:', e.message));
        if (staleInvite) updated.calendar_warning = STALE_INVITE_WARNING;

        return updated;
    },

    async resend(id, user, { mode } = {}) {
        const safeId = validateId(id);
        const row = await pool.query(
            `SELECT * FROM scheduled_meetings WHERE id = $1 AND tenant_id = $2 AND ${ownsSchedule('$3')}`,
            [safeId, user.tenantId, scopeOwner(user)]
        );
        const existing = row.rows[0];
        if (!existing) return null;
        if (existing.status === 'cancelled') throw new Error('Cannot resend a cancelled meeting');
        if (!existing.meeting_uuid) throw new Error('Invalid meeting: no session room');

        const roomLink = (process.env.APP_URL || 'http://localhost:3000') + '/participant/' + existing.meeting_uuid;
        const icalUid = buildIcalUid(existing.meeting_uuid);
        const salesperson = await getSalesperson(existing.created_by || user.id);
        const send = mode === 'reschedule' ? NotificationService.sendReschedule : NotificationService.sendInvite;
        await send(existing.client_email, existing.client_name, existing.client_phone, existing.start_time, roomLink, icalUid, salesperson);

        return existing;
    },

    async getAll(tenantId, owner) {
        const res = await pool.query(
            `SELECT sm.*, u.name AS created_by_name
             FROM scheduled_meetings sm
             LEFT JOIN users u ON sm.created_by = u.id
             WHERE sm.tenant_id = $1 AND ${ownsSchedule('$2', 'sm.')}
             ORDER BY sm.start_time DESC`,
            [tenantId, owner]
        );
        return res.rows;
    },

    async getById(id, user) {
        const safeId = validateId(id);
        const res = await pool.query(
            `SELECT * FROM scheduled_meetings WHERE id = $1 AND tenant_id = $2 AND ${ownsSchedule('$3')}`,
            [safeId, user.tenantId, scopeOwner(user)]
        );
        return res.rows[0] || null;
    },

    async lookupCustomer(tenantId, owner, { email, phone }) {
        const trimmedEmail = email ? String(email).trim().toLowerCase() : null;
        const trimmedPhone = phone ? String(phone).trim() : null;
        if (!trimmedEmail && !trimmedPhone) return null;

        const conditions = [];
        const params = [tenantId, owner];
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
             WHERE tenant_id = $1 AND ${ownsSchedule('$2')} AND (${conditions.join(' OR ')})
             ORDER BY LOWER(client_email), created_at DESC
             LIMIT 1`,
            params
        );
        return res.rows[0] || null;
    }
};

module.exports = SchedulingService;
