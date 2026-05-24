const nodemailer = require('nodemailer');

const EMAIL_FROM = process.env.EMAIL_FROM || 'Mandake Group <noreply@mandake-group.com>';
const ORG_NAME = 'Mandake Group';
const ORG_EMAIL = process.env.EMAIL_USER || 'noreply@mandake-group.com';

let _transport = null;
function getTransport() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
    if (!_transport) {
        _transport = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        });
    }
    return _transport;
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

function safeName(str) {
    return String(str).replace(/[\r\n\t]/g, ' ').slice(0, 100);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toIcsDate(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escIcs(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function generateIcs(method, sequence, uid, start, end, summary, description, clientEmail, clientName) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Mandake Group//Mandake Group//EN',
        'CALSCALE:GREGORIAN',
        `METHOD:${method}`,
        'BEGIN:VEVENT',
        `UID:${uid}@mandake-group`,
        `DTSTAMP:${toIcsDate(new Date())}`,
        `DTSTART:${toIcsDate(start)}`,
        `DTEND:${toIcsDate(end)}`,
        `SEQUENCE:${sequence}`,
        `SUMMARY:${escIcs(summary)}`,
        `DESCRIPTION:${escIcs(description)}`,
        `ORGANIZER;CN=${escIcs(ORG_NAME)}:mailto:${ORG_EMAIL}`,
        `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${escIcs(clientName)}:mailto:${clientEmail}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ];
    return lines.join('\r\n');
}

function icsAttachment(method, sequence, uid, start, end, summary, description, clientEmail, clientName) {
    return {
        filename: 'meeting.ics',
        content: generateIcs(method, sequence, uid, start, end, summary, description, clientEmail, clientName),
        contentType: 'text/calendar; method=' + method
    };
}

async function sendEmail(to, subject, html, attachments) {
    if (!isValidEmail(to)) {
        console.error('[EMAIL] Invalid email address:', to);
        return { skipped: true };
    }
    const transport = getTransport();
    if (!transport) {
        console.log('[EMAIL DUMMY] To:', to, '| Subject:', subject);
        console.log('[EMAIL DUMMY] Body preview:', html.replace(/<[^>]+>/g, '').slice(0, 120));
        return { dummy: true };
    }
    return transport.sendMail({ from: EMAIL_FROM, to, subject, html, attachments });
}

const WA_API_KEY = process.env.WA_API_KEY;
const WA_FROM = process.env.WA_FROM;
const WA_BASE = 'https://api.aoc-portal.com/v1/whatsapp';

async function sendWhatsAppTemplate(phone, templateName, variables) {
    if (!phone) return;

    if (!WA_API_KEY || !WA_FROM) {
        console.log('[WHATSAPP DUMMY] To:', phone, '| Template:', templateName, '| Vars:', variables);
        return { dummy: true };
    }

    const body = {
        from: WA_FROM,
        campaignName: 'mandake-group-' + templateName,
        to: phone,
        templateName,
        type: 'template',
        components: variables && variables.length > 0 ? [{
            type: 'body',
            parameters: variables.map(v => ({ type: 'text', text: String(v) }))
        }] : undefined
    };

    try {
        const axios = require('axios');
        const res = await axios.post(WA_BASE, body, {
            headers: { apikey: WA_API_KEY, 'Content-Type': 'application/json' }
        });
        console.log('[WHATSAPP] Sent to:', phone, '| Template:', templateName);
        return res.data;
    } catch (e) {
        console.error('[WHATSAPP] Failed:', e.response?.data || e.message);
    }
}

function buildEmailHtml({ headerColor, headerLabel, clientName, dateStr, endStr, roomLink, bodyText, noteText }) {
    const joinBtn = roomLink
        ? `<a href="${esc(roomLink)}" style="display:inline-block;background:#8B6B3F;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;padding:13px 36px;text-decoration:none;border-radius:4px;letter-spacing:0.5px;">Join Meeting</a>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0ece8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ece8;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.10);">

        <!-- Header -->
        <tr>
          <td style="background:${headerColor};padding:32px 40px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:2px;text-transform:uppercase;">Mandake Group</p>
            <p style="margin:0 0 10px;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1px;">Mande Light House</p>
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:bold;letter-spacing:0.5px;">${headerLabel}</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 28px;">
            <p style="margin:0 0 8px;font-size:16px;color:#2c2c2c;">Dear <strong>${esc(clientName)}</strong>,</p>
            <p style="margin:0 0 28px;font-size:14px;color:#666666;line-height:1.7;">${bodyText}</p>

            <!-- Details card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f3;border:1px solid #e5d9c8;border-radius:6px;margin-bottom:28px;">
              <tr>
                <td style="padding:0;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="50%" style="padding:18px 24px;border-right:1px solid #e5d9c8;">
                        <p style="margin:0 0 4px;font-size:11px;color:#8B6B3F;font-weight:bold;text-transform:uppercase;letter-spacing:0.8px;">Start Time</p>
                        <p style="margin:0;font-size:14px;color:#2c2c2c;font-weight:600;">${esc(dateStr)}</p>
                      </td>
                      <td width="50%" style="padding:18px 24px;">
                        <p style="margin:0 0 4px;font-size:11px;color:#8B6B3F;font-weight:bold;text-transform:uppercase;letter-spacing:0.8px;">End Time</p>
                        <p style="margin:0;font-size:14px;color:#2c2c2c;font-weight:600;">${esc(endStr)}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            ${roomLink ? `
            <p style="margin:0 0 16px;font-size:14px;color:#555555;">Click the button below to join your meeting:</p>
            <p style="margin:0 0 16px;">${joinBtn}</p>
            <p style="margin:0 0 28px;font-size:12px;color:#999999;">Or copy this link:<br><a href="${esc(roomLink)}" style="color:#8B6B3F;word-break:break-all;">${esc(roomLink)}</a></p>
            ` : `<p style="margin:0 0 28px;font-size:14px;color:#666666;">Your host will share the meeting link shortly.</p>`}

            <p style="margin:0;font-size:13px;color:#888888;line-height:1.6;">${noteText}</p>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="height:1px;background:#e8ddd0;"></td></tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;text-align:center;background:#faf7f3;">
            <p style="margin:0 0 4px;font-size:12px;color:#aaaaaa;">Sent by <strong style="color:#8B6B3F;">Mandake Group</strong> — Please do not reply to this email.</p>
            <p style="margin:0;font-size:11px;color:#cccccc;">© ${new Date().getFullYear()} Mandake Group. All rights reserved.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendInvite(clientEmail, clientName, clientPhone, startTime, roomLink, meetingUid) {
    const start = new Date(startTime);
    const end = new Date(start.getTime() + 3600000);
    const dateStr = start.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const endStr = end.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const uid = meetingUid || ('meet-' + Date.now());

    const html = buildEmailHtml({
        headerColor: '#8B6B3F',
        headerLabel: 'Meeting Invitation',
        clientName,
        dateStr,
        endStr,
        roomLink,
        bodyText: 'You have been invited to a meeting. Please find the details below and add the calendar invite to your schedule.',
        noteText: 'A calendar file (.ics) is attached — open it to add this meeting to your calendar.'
    });

    const attachment = icsAttachment(
        'REQUEST', 0, uid, start, end,
        'Meeting — Mandake Group',
        roomLink ? 'Join your meeting: ' + roomLink : 'Your host will share the meeting link shortly.',
        clientEmail, clientName
    );

    await sendEmail(clientEmail, 'You have been invited to a meeting — Mandake Group', html, [attachment]);

    sendWhatsAppTemplate(clientPhone, 'mandake-group_invite_v2', [
        safeName(clientName),
        dateStr,
        roomLink || 'Link will be shared shortly'
    ]).catch(e => console.error('[WHATSAPP] Invite send failed:', e.message));
}

async function sendReschedule(clientEmail, clientName, clientPhone, newStartTime, roomLink, meetingUid) {
    const start = new Date(newStartTime);
    const end = new Date(start.getTime() + 3600000);
    const dateStr = start.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const endStr = end.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const uid = meetingUid || ('meet-' + Date.now());

    const html = buildEmailHtml({
        headerColor: '#3a6186',
        headerLabel: 'Meeting Rescheduled',
        clientName,
        dateStr,
        endStr,
        roomLink,
        bodyText: 'Your meeting has been rescheduled. Please find the updated details below and add the new calendar invite to your schedule.',
        noteText: 'A new calendar file (.ics) is attached — open it to update this meeting in your calendar.'
    });

    const attachment = icsAttachment(
        'REQUEST', 1, uid, start, end,
        'Meeting (Rescheduled) — Mandake Group',
        roomLink ? 'Join your meeting: ' + roomLink : 'Your host will share the meeting link shortly.',
        clientEmail, clientName
    );

    await sendEmail(clientEmail, 'Your meeting has been rescheduled — Mandake Group', html, [attachment]);

    sendWhatsAppTemplate(clientPhone, 'mandake-group_reschedule_v2', [
        safeName(clientName),
        dateStr,
        roomLink || 'Link will be shared shortly'
    ]).catch(e => console.error('[WHATSAPP] Reschedule send failed:', e.message));
}

async function sendCancellation(clientEmail, clientName, clientPhone, startTime, meetingUid) {
    const start = startTime ? new Date(startTime) : new Date();
    const end = new Date(start.getTime() + 3600000);
    const uid = meetingUid || ('meet-' + Date.now());

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0ece8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ece8;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.10);">
        <tr>
          <td style="background:#b94040;padding:32px 40px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:2px;text-transform:uppercase;">Mandake Group</p>
            <p style="margin:0 0 10px;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1px;">Mande Light House</p>
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:bold;">Meeting Cancelled</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px 28px;">
            <p style="margin:0 0 8px;font-size:16px;color:#2c2c2c;">Dear <strong>${esc(clientName)}</strong>,</p>
            <p style="margin:0 0 24px;font-size:14px;color:#666666;line-height:1.7;">We regret to inform you that your scheduled meeting has been <strong>cancelled</strong>.</p>
            <p style="margin:0;font-size:14px;color:#666666;line-height:1.7;">Please contact us to reschedule at your convenience. We apologise for any inconvenience caused.</p>
          </td>
        </tr>
        <tr><td style="height:1px;background:#e8ddd0;"></td></tr>
        <tr>
          <td style="padding:20px 40px;text-align:center;background:#faf7f3;">
            <p style="margin:0 0 4px;font-size:12px;color:#aaaaaa;">Sent by <strong style="color:#8B6B3F;">Mandake Group</strong> — Please do not reply to this email.</p>
            <p style="margin:0;font-size:11px;color:#cccccc;">© ${new Date().getFullYear()} Mandake Group. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const attachment = icsAttachment('CANCEL', 2, uid, start, end, 'Meeting — Mandake Group', 'This meeting has been cancelled.', clientEmail, clientName);

    await sendEmail(clientEmail, 'Your meeting has been cancelled — Mandake Group', html, [attachment]);

    sendWhatsAppTemplate(clientPhone, 'mandake-group_cancel_v2', [
        safeName(clientName)
    ]).catch(e => console.error('[WHATSAPP] Cancel send failed:', e.message));
}

module.exports = { sendInvite, sendReschedule, sendCancellation };
