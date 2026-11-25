const ownsClient = (p, a = "") =>
    `(${p}::int IS NULL OR ${a}created_by = ${p}::int OR ${a}assigned_advisor_id = ${p}::int::text)`;

const ownsSchedule = (p, a = "") =>
    `(${p}::int IS NULL OR ${a}created_by = ${p}::int OR ${a}client_id IN (SELECT oc.id FROM clients oc WHERE ${ownsClient(p, "oc.")}))`;

const ownsMeeting = (p, a = "") =>
    `(${p}::int IS NULL OR ${a}moderator_id = ${p}::int OR ${a}uuid IN (SELECT os.meeting_uuid FROM scheduled_meetings os WHERE os.meeting_uuid IS NOT NULL AND ${ownsSchedule(p, "os.")}))`;

module.exports = { ownsClient, ownsSchedule, ownsMeeting };
