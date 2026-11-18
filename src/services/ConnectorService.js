const { Composio, ComposioToolInputRequiredError } = require('@composio/core');
const { pool } = require('../config/db');

// Apps an advisor may connect. Composio sessions are scoped to these; add a slug here to offer another app.
const TOOLKITS = ['googlecalendar', 'gmail', 'googledrive'];

/**
 * Composio pauses these tools until the advisor approves the call (Composio Approvals).
 * Every tool hinted as a write is gated; reads run straight away. Sending mail and sharing are also named
 * explicitly, because Composio assigns hints on a best-effort basis.
 */
const WRITE_HINTS = { requireApproval: ['createHint', 'updateHint', 'destructiveHint'] };
const ALWAYS_ASK = {
    gmail: ['GMAIL_SEND_EMAIL', 'GMAIL_SEND_DRAFT', 'GMAIL_REPLY_TO_THREAD', 'GMAIL_FORWARD_MESSAGE'],
    googledrive: [
        'GOOGLEDRIVE_CREATE_PERMISSION',
        'GOOGLEDRIVE_CREATE_PERMISSIONS_BATCH',
        'GOOGLEDRIVE_UPDATE_PERMISSION',
        'GOOGLEDRIVE_PATCH_PERMISSION',
    ],
    googlecalendar: ['GOOGLECALENDAR_ACL_INSERT', 'GOOGLECALENDAR_ACL_PATCH', 'GOOGLECALENDAR_ACL_UPDATE'],
};
const APPROVALS = {
    tags: WRITE_HINTS,
    // A toolkit's own config replaces the session-wide tags for it (verified), so each one repeats WRITE_HINTS.
    tools: Object.fromEntries(
        Object.entries(ALWAYS_ASK).map(([toolkit, slugs]) => [toolkit, { tags: WRITE_HINTS, requireApproval: slugs }]),
    ),
};

let client = null;
const sessions = new Map(); // composio user id -> Promise<session>

function http(status, message) {
    return Object.assign(new Error(message), { status });
}

function composio() {
    if (!process.env.COMPOSIO_API_KEY) throw http(503, 'Connectors are not configured');
    if (!client) client = new Composio(); // reads COMPOSIO_API_KEY from the environment
    return client;
}

/**
 * One Composio identity per advisor. The prefix keeps environments apart: they share a Composio
 * project, and local user ids (1, 2, ...) would otherwise collide with production ones.
 */
function composioUserId(user) {
    return `${process.env.COMPOSIO_USER_PREFIX || 'propley'}-user-${user.id}`;
}

function assertToolkit(toolkit) {
    if (!TOOLKITS.includes(toolkit)) throw http(404, `Unknown connector: ${toolkit}`);
}

async function sessionFor(user) {
    const id = composioUserId(user);
    if (!sessions.has(id)) {
        const created = composio().create(id, { toolkits: TOOLKITS, ...APPROVALS });
        created.catch(() => sessions.delete(id)); // don't cache a failed create
        sessions.set(id, created);
    }
    return sessions.get(id);
}

/** Advisor preferences for connector tools; anything else in the body is dropped. */
const SETTINGS = {
    defaultCalendarId: (v) => typeof v === 'string' && v.length <= 200,
    emailSignature: (v) => typeof v === 'string' && v.length <= 1000,
};

function cleanSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw http(400, 'settings must be an object');
    const out = {};
    for (const [key, valid] of Object.entries(SETTINGS)) {
        if (input[key] === undefined) continue;
        if (!valid(input[key])) throw http(400, `Invalid ${key}`);
        out[key] = input[key].trim();
    }
    return out;
}

const ConnectorService = {
    TOOLKITS,

    /** Every app with whether the advisor has it connected (the settings panel). */
    async list(user) {
        const session = await sessionFor(user);
        const { items } = await session.toolkits({ toolkits: TOOLKITS });
        return TOOLKITS.map((toolkit) => {
            const item = items.find((i) => i.slug === toolkit);
            return { toolkit, name: item?.name ?? toolkit, connected: Boolean(item?.connection?.isActive) };
        });
    },

    /** Removes the advisor's Composio connections for the app, expired ones included. */
    async disconnect(user, toolkit) {
        assertToolkit(toolkit);
        const { items } = await composio().connectedAccounts.list({
            userIds: [composioUserId(user)],
            toolkitSlugs: [toolkit],
        });
        for (const account of items) await composio().connectedAccounts.delete(account.id);
        return { toolkit, connected: false, removed: items.length };
    },

    async getSettings(user) {
        const { rows } = await pool.query('SELECT settings FROM connector_settings WHERE user_id = $1', [user.id]);
        return rows[0]?.settings ?? {};
    },

    async saveSettings(user, input) {
        const settings = cleanSettings(input);
        const { rows } = await pool.query(
            `INSERT INTO connector_settings (user_id, settings, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (user_id) DO UPDATE SET settings = connector_settings.settings || EXCLUDED.settings, updated_at = NOW()
             RETURNING settings`,
            [user.id, settings],
        );
        return rows[0].settings;
    },

    /** Whether the advisor has an active connection for the toolkit. */
    async status(user, toolkit) {
        assertToolkit(toolkit);
        const session = await sessionFor(user);
        const { items } = await session.toolkits({ toolkits: [toolkit] });
        const item = items.find((i) => i.slug === toolkit);
        return { toolkit, connected: Boolean(item?.connection?.isActive) };
    },

    /** A Composio Connect Link the advisor opens to authorise the app. */
    async connect(user, toolkit) {
        assertToolkit(toolkit);
        const session = await sessionFor(user);
        const request = await session.authorize(toolkit);
        return { toolkit, redirectUrl: request.redirectUrl };
    },

    /**
     * Run one tool of the toolkit as the advisor. Returns Composio's result, including its log id.
     * A gated tool doesn't run: the result is `resultType: 'input_required'` with the questions to show the
     * advisor. Send the same call again with their `inputResponses` and the returned `requestState`.
     * Those answers must come from the advisor clicking approve, never from an agent or LLM.
     */
    async execute(user, toolkit, tool, args = {}, { inputResponses, requestState } = {}) {
        assertToolkit(toolkit);
        if (typeof tool !== 'string' || !tool.startsWith(`${toolkit.toUpperCase()}_`)) {
            throw http(400, `Tool must belong to ${toolkit}`);
        }
        const session = await sessionFor(user);
        try {
            const answer = inputResponses ? { inputResponses, requestState } : undefined;
            const { resultType, data, error, logId } = await session.execute(tool, args, answer);
            return { resultType, data, error, logId };
        } catch (err) {
            if (!(err instanceof ComposioToolInputRequiredError)) throw err;
            return { resultType: 'input_required', inputRequests: err.inputRequests, requestState: err.requestState };
        }
    },
};

module.exports = ConnectorService;
