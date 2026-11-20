const test = require("node:test");
const assert = require("node:assert");
const ConnectorService = require("../src/services/ConnectorService");
const AdvisorCalendarService = require("../src/services/AdvisorCalendarService");

// Stub the Composio calls; record what would be sent.
function stub({ settings = {}, result = { resultType: "completed", data: { response_data: { id: "evt_1" } } } } = {}) {
    const calls = [];
    ConnectorService.getSettings = async () => settings;
    ConnectorService.runAsAdvisor = async (user, toolkit, tool, args) => {
        calls.push({ user, toolkit, tool, args });
        return result;
    };
    return calls;
}

test("createInvite books 1 hour in IST on the advisor's chosen calendar and invites the client", async () => {
    const calls = stub({ settings: { defaultCalendarId: "team@group.calendar.google.com" } });
    const out = await AdvisorCalendarService.createInvite({ id: 7 }, {
        start: new Date("2026-11-21T10:30:00Z"), // 16:00 IST
        title: "Mandake Lighthouse",
        description: "Join: https://x",
        clientEmail: "rahul.verma@example.com",
        clientName: "Rahul Verma",
    });
    assert.deepStrictEqual(out, { calendarId: "team@group.calendar.google.com", eventId: "evt_1" });
    const { tool, args, user } = calls[0];
    assert.strictEqual(tool, "GOOGLECALENDAR_CREATE_EVENT");
    assert.strictEqual(user.id, 7);
    assert.strictEqual(args.start_datetime, "2026-11-21T16:00:00");
    assert.strictEqual(args.timezone, "Asia/Kolkata");
    assert.strictEqual(args.event_duration_hour, 1);
    assert.strictEqual(args.send_updates, "all");
    assert.deepStrictEqual(args.attendees, [{ email: "rahul.verma@example.com", displayName: "Rahul Verma" }]);
});

test("createInvite uses the main calendar when none is chosen", async () => {
    const calls = stub();
    const out = await AdvisorCalendarService.createInvite({ id: 7 }, { start: new Date(), title: "t", clientEmail: "a@example.com" });
    assert.strictEqual(out.calendarId, "primary");
    assert.strictEqual(calls[0].args.calendar_id, "primary");
});

test("a failed or id-less create throws, so scheduling falls back", async () => {
    stub({ result: { resultType: "failed", error: "insufficient permissions", logId: "log_1" } });
    await assert.rejects(
        AdvisorCalendarService.createInvite({ id: 7 }, { start: new Date(), title: "t", clientEmail: "a@example.com" }),
        /insufficient permissions/,
    );
    stub({ result: { resultType: "completed", data: {} } });
    await assert.rejects(
        AdvisorCalendarService.createInvite({ id: 7 }, { start: new Date(), title: "t", clientEmail: "a@example.com" }),
        /no event id/,
    );
});

test("moveInvite and cancelInvite target the stored calendar and notify guests", async () => {
    const calls = stub();
    const start = new Date("2026-11-22T05:30:00Z");
    const end = new Date("2026-11-22T06:30:00Z");
    await AdvisorCalendarService.moveInvite({ id: 7 }, { calendarId: "cal_x", eventId: "evt_1", start, end });
    await AdvisorCalendarService.cancelInvite({ id: 7 }, { calendarId: "cal_x", eventId: "evt_1" });
    assert.strictEqual(calls[0].tool, "GOOGLECALENDAR_PATCH_EVENT");
    assert.strictEqual(calls[0].args.start_time, "2026-11-22T05:30:00.000Z");
    assert.strictEqual(calls[0].args.calendar_id, "cal_x");
    assert.strictEqual(calls[1].tool, "GOOGLECALENDAR_DELETE_EVENT");
    for (const c of calls) assert.strictEqual(c.args.send_updates, "all");
});

test("isConnected is false without a Composio key and never throws", async () => {
    const key = process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    assert.strictEqual(await AdvisorCalendarService.isConnected({ id: 7 }), false);
    process.env.COMPOSIO_API_KEY = "x";
    ConnectorService.status = async () => { throw new Error("network down"); };
    assert.strictEqual(await AdvisorCalendarService.isConnected({ id: 7 }), false);
    if (key === undefined) delete process.env.COMPOSIO_API_KEY; else process.env.COMPOSIO_API_KEY = key;
});
