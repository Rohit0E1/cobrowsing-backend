const GOOGLE_ENABLED = !!(
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_CALENDAR_ID
);

let calendar = null;

if (GOOGLE_ENABLED) {
    try {
        const { google } = require('googleapis');
        const auth = new google.auth.JWT({
            email: process.env.GOOGLE_CLIENT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/calendar']
        });
        calendar = google.calendar({ version: 'v3', auth });
        console.log('[CALENDAR] Google Calendar initialized');
    } catch (e) {
        console.warn('[CALENDAR] googleapis not installed, running in dummy mode');
    }
}

async function createEvent(startTime, clientName, clientEmail, roomLink) {
    const start = new Date(startTime);
    const end = new Date(start.getTime() + 3600000);

    if (!calendar) {
        const fakeId = 'dummy_evt_' + Date.now();
        console.log('[CALENDAR DUMMY] Create:', clientName, start.toISOString(), '|', fakeId, roomLink ? '| ' + roomLink : '');
        return fakeId;
    }

    const res = await calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        resource: {
            summary: 'Meeting with ' + clientName,
            description: 'Scheduled meeting via CobroMeet' + (roomLink ? '\n\nJoin: ' + roomLink : ''),
            start: { dateTime: start.toISOString(), timeZone: 'Asia/Kolkata' },
            end: { dateTime: end.toISOString(), timeZone: 'Asia/Kolkata' },
            reminders: { useDefault: true }
        }
    });
    return res.data.id;
}

async function updateEvent(eventId, newStartTime, clientName, roomLink) {
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
        patchResource.description = 'Scheduled meeting via CobroMeet\n\nJoin: ' + roomLink;
    }

    await calendar.events.patch({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        eventId,
        resource: patchResource
    });
    return eventId;
}

async function deleteEvent(eventId) {
    if (!calendar || !eventId || eventId.startsWith('dummy_')) {
        console.log('[CALENDAR DUMMY] Delete:', eventId);
        return;
    }

    await calendar.events.delete({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        eventId
    });
}

module.exports = { createEvent, updateEvent, deleteEvent };
