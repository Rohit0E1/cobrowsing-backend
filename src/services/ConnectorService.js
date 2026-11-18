const { Composio } = require('@composio/core');

// Apps an advisor may connect. Composio sessions are scoped to these; add a slug here to offer another app.
const TOOLKITS = ['googlecalendar'];

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
        const created = composio().create(id, { toolkits: TOOLKITS });
        created.catch(() => sessions.delete(id)); // don't cache a failed create
        sessions.set(id, created);
    }
    return sessions.get(id);
}

const ConnectorService = {
    TOOLKITS,

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

    /** Run one tool of the toolkit as the advisor. Returns Composio's result, including its log id. */
    async execute(user, toolkit, tool, args = {}) {
        assertToolkit(toolkit);
        if (typeof tool !== 'string' || !tool.startsWith(`${toolkit.toUpperCase()}_`)) {
            throw http(400, `Tool must belong to ${toolkit}`);
        }
        const session = await sessionFor(user);
        const { resultType, data, error, logId } = await session.execute(tool, args);
        return { resultType, data, error, logId };
    },
};

module.exports = ConnectorService;
