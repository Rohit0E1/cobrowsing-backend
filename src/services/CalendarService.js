const GOOGLE_ENABLED = !!(
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_CALENDAR_ID
);

const EVENT_TITLE = 'Mandake Lighthouse';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

const IMPERSONATE_SUBJECT = process.env.GOOGLE_IMPERSONATE_SUBJECT || null;
const CAN_INVITE_ATTENDEES = !!IMPERSONATE_SUBJECT;

let calendar = null;
let plainCalendar = null;

if (GOOGLE_ENABLED) {
    try {
        const { google } = require('googleapis');
        const key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
        const make = (subject) => google.calendar({
            version: 'v3',
            auth: new google.auth.JWT({
                email: process.env.GOOGLE_CLIENT_EMAIL,
                key,
                scopes: ['https://www.googleapis.com/auth/calendar'],
                ...(subject ? { subject } : {})
            })
        });
        plainCalendar = make(null);
        calendar = IMPERSONATE_SUBJECT ? make(IMPERSONATE_SUBJECT) : plainCalendar;
        console.log('[CALENDAR] Google Calendar initialized' +
            (CAN_INVITE_ATTENDEES
                ? ' (DWD attendee invites on, subject=' + IMPERSONATE_SUBJECT + ')'
                : ' (event-only; invites via .ics)'));
    } catch (e) {
        console.warn('[CALENDAR] googleapis not installed, running in dummy mode');
    }
}

function buildAttendees({ clientName, clientEmail, salespersonName, salespersonEmail }) {
    const attendees = [];
    if (clientEmail) {
        attendees.push({ email: clientEmail, displayName: clientName || undefined });
    }
    if (salespersonEmail && salespersonEmail !== clientEmail) {
        attendees.push({ email: salespersonEmail, displayName: salespersonName || undefined });
    }
    return attendees;
}

async function createEvent(startTime, opts = {}) {
    const { clientName, clientEmail, salespersonName, salespersonEmail, roomLink, iCalUid, summary } = opts;
    const start = new Date(startTime);
    const end = new Date(start.getTime() + 3600000);
    const title = summary || EVENT_TITLE;

    if (!calendar) {
        const fakeId = 'dummy_evt_' + Date.now();
        console.log('[CALENDAR DUMMY] Create:', title, '|', clientName, start.toISOString(),
            '| salesperson:', salespersonEmail || '-', '| uid:', iCalUid || '-', roomLink ? '| ' + roomLink : '');
        return fakeId;
    }

    const resource = {
        summary: title,
        description: 'Scheduled meeting with ' + EVENT_TITLE + (roomLink ? '\n\nJoin: ' + roomLink : ''),
        start: { dateTime: start.toISOString(), timeZone: 'Asia/Kolkata' },
        end: { dateTime: end.toISOString(), timeZone: 'Asia/Kolkata' },
        reminders: { useDefault: true }
    };
    if (iCalUid) resource.iCalUID = iCalUid;

    if (CAN_INVITE_ATTENDEES) {
        try {
            const res = await calendar.events.insert({
                calendarId: CALENDAR_ID,
                sendUpdates: 'all',
                resource: { ...resource, attendees: buildAttendees({ clientName, clientEmail, salespersonName, salespersonEmail }) }
            });
            return res.data.id;
        } catch (e) {
            console.warn('[CALENDAR] Attendee invite failed (' + e.message +
                ') — falling back to event-only. Verify Domain-Wide Delegation for ' + IMPERSONATE_SUBJECT + '.');
        }
    }

    const res = await plainCalendar.events.insert({ calendarId: CALENDAR_ID, resource });
    return res.data.id;
}

async function updateEvent(eventId, newStartTime, opts = {}) {
    const { roomLink } = opts;
    const start = new Date(newStartTime);
    const end = new Date(start.getTime() + 3600000);

    if (!calendar || !eventId || eventId.startsWith('dummy_')) {
        const newFakeId = 'dummy_evt_' + Date.now();
        console.log('[CALENDAR DUMMY] Update:', eventId, '->', start.toISOString(), '|', newFakeId);
        return newFakeId;
    }

    const patchResource = {
        start: { dateTime: start.toISOString(), timeZone: 'Asia/Kolkata' },
        end: { dateTime: end.toISOString(), timeZone: 'Asia/Kolkata' }
    };
    if (roomLink) {
        patchResource.description = 'Scheduled meeting with ' + EVENT_TITLE + '\n\nJoin: ' + roomLink;
    }

    if (CAN_INVITE_ATTENDEES) {
        try {
            await calendar.events.patch({ calendarId: CALENDAR_ID, eventId, sendUpdates: 'all', resource: patchResource });
            return eventId;
        } catch (e) {
            console.warn('[CALENDAR] Reschedule notify failed (' + e.message + ') — patching event-only.');
        }
    }

    await plainCalendar.events.patch({ calendarId: CALENDAR_ID, eventId, resource: patchResource });
    return eventId;
}

async function deleteEvent(eventId) {
    if (!calendar || !eventId || eventId.startsWith('dummy_')) {
        console.log('[CALENDAR DUMMY] Delete:', eventId);
        return;
    }

    if (CAN_INVITE_ATTENDEES) {
        try {
            await calendar.events.delete({ calendarId: CALENDAR_ID, eventId, sendUpdates: 'all' });
            return;
        } catch (e) {
            console.warn('[CALENDAR] Cancel notify failed (' + e.message + ') — deleting event-only.');
        }
    }

    await plainCalendar.events.delete({ calendarId: CALENDAR_ID, eventId });
}

module.exports = { createEvent, updateEvent, deleteEvent, EVENT_TITLE };
