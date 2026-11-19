const ConnectorService = require('./ConnectorService');

/**
 * Presentation invites from the advisor's own Google Calendar (connected through Composio), so the
 * client gets a real Google invite, and its updates and cancellation, from the advisor. Used instead of
 * the service-account calendar whenever the advisor has Calendar connected.
 */

const TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 3600 * 1000; // India has no daylight saving

/** 2026-11-21T10:30:00.000Z -> "2026-11-21T16:00:00", the wall-clock time Composio expects with `timezone`. */
const istLocal = (date) => new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19);

function check(result, what) {
    if (result.resultType !== 'completed') {
        throw new Error(`${what} failed: ${result.error || result.resultType} (log ${result.logId || '-'})`);
    }
    return result.data;
}

const AdvisorCalendarService = {
    /** True when the advisor has Google Calendar connected. Never throws: no connection means "use the fallback". */
    async isConnected(user) {
        if (!process.env.COMPOSIO_API_KEY) return false;
        try {
            return (await ConnectorService.status(user, 'googlecalendar')).connected;
        } catch (err) {
            console.warn('[ADVISOR CALENDAR] status check failed:', err.message);
            return false;
        }
    },

    /** Creates the event on the advisor's calendar and invites the client. Returns where it lives. */
    async createInvite(user, { start, title, description, clientEmail, clientName }) {
        const { defaultCalendarId } = await ConnectorService.getSettings(user);
        const calendarId = defaultCalendarId || 'primary';
        const data = check(
            await ConnectorService.runAsAdvisor(user, 'googlecalendar', 'GOOGLECALENDAR_CREATE_EVENT', {
                calendar_id: calendarId,
                summary: title,
                description,
                start_datetime: istLocal(start),
                timezone: TIMEZONE,
                event_duration_hour: 1,
                event_duration_minutes: 0,
                attendees: [{ email: clientEmail, displayName: clientName || undefined }],
                send_updates: 'all',
                create_meeting_room: false,
            }),
            'Create invite',
        );
        const eventId = data?.response_data?.id;
        if (!eventId) throw new Error('Create invite returned no event id');
        return { calendarId, eventId };
    },

    /** Moves the event; Google emails the client the new time. */
    async moveInvite(user, { calendarId, eventId, start, end, description }) {
        check(
            await ConnectorService.runAsAdvisor(user, 'googlecalendar', 'GOOGLECALENDAR_PATCH_EVENT', {
                calendar_id: calendarId,
                event_id: eventId,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                timezone: TIMEZONE,
                send_updates: 'all',
                ...(description ? { description } : {}),
            }),
            'Move invite',
        );
    },

    /** Deletes the event; Google emails the client the cancellation. */
    async cancelInvite(user, { calendarId, eventId }) {
        check(
            await ConnectorService.runAsAdvisor(user, 'googlecalendar', 'GOOGLECALENDAR_DELETE_EVENT', {
                calendar_id: calendarId,
                event_id: eventId,
                send_updates: 'all',
            }),
            'Cancel invite',
        );
    },
};

module.exports = AdvisorCalendarService;
