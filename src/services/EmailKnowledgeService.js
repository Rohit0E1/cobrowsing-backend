const { pool } = require('../config/db');
const ConnectorService = require('./ConnectorService');
const KnowledgeService = require('./KnowledgeService');

/**
 * The advisor's emails with their clients, made searchable for them alone. Only runs when the advisor turned
 * on `readEmail` in the assistant settings. Only messages to or from a CRM client's address are indexed; each
 * chunk is owned by the advisor (KnowledgeService hides it from everyone else). forget() deletes them all.
 */

const SYNC_EVERY_MS = 15 * 60 * 1000;
const FIRST_SYNC_DAYS = 180;
const ADDRESSES_PER_QUERY = 15; // Gmail search strings get unwieldy beyond this
const PAGE_SIZE = 50;
const MAX_MESSAGES_PER_SYNC = 300;
const MAX_BODY_CHARS = 6000;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Every address in a header like `"Rahul Verma" <rahul@x.com>, b@y.com`, lowercased. */
function addresses(header) {
    return (String(header ?? '').match(EMAIL_RE) ?? []).map((a) => a.toLowerCase());
}

/** The new text of a message: quoted history ("> ..." lines, "On ... wrote:" and below) and blank runs removed. */
function cleanBody(text) {
    const kept = [];
    for (const line of String(text ?? '').split(/\r?\n/)) {
        if (/^\s*On .{5,200}wrote:\s*$/i.test(line) || /^-{2,}\s*Original Message/i.test(line)) break;
        if (/^\s*>/.test(line)) continue;
        kept.push(line.trimEnd());
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_BODY_CHARS);
}

const day = (date) => new Date(date).toISOString().slice(0, 10);

async function clientsByAddress(tenantId) {
    const { rows } = await pool.query(
        "SELECT id, name, LOWER(email) AS email FROM clients WHERE tenant_id = $1 AND email LIKE '%@%'",
        [tenantId],
    );
    return new Map(rows.map((r) => [r.email, r]));
}

async function advisorAddress(user) {
    const r = await ConnectorService.runAsAdvisor(user, 'gmail', 'GMAIL_GET_PROFILE', { user_id: 'me' });
    return String(r.data?.emailAddress ?? r.data?.response_data?.emailAddress ?? '').toLowerCase();
}

/** One Gmail search, all pages, up to `budget` messages. */
async function fetchMessages(user, query, budget) {
    const out = [];
    let pageToken;
    do {
        const r = await ConnectorService.runAsAdvisor(user, 'gmail', 'GMAIL_FETCH_EMAILS', {
            query,
            max_results: Math.min(PAGE_SIZE, budget - out.length),
            include_payload: false,
            ...(pageToken ? { page_token: pageToken } : {}),
        });
        if (r.resultType !== 'completed') throw new Error(`Gmail search failed: ${r.error || r.resultType} (log ${r.logId || '-'})`);
        out.push(...(r.data?.messages ?? []));
        pageToken = r.data?.nextPageToken;
    } while (pageToken && out.length < budget);
    return out;
}

/** Indexes one message as private chunks under `email:<userId>:<messageId>`. */
async function indexMessage(user, tenantId, clients, own, m) {
    const from = addresses(m.sender);
    const to = addresses(m.to);
    const incoming = from.some((a) => clients.has(a));
    const client = clients.get((incoming ? from : to).find((a) => clients.has(a) && a !== own));
    const body = cleanBody(m.messageText);
    if (!client || !body) return 0;

    const when = m.messageTimestamp ? new Date(m.messageTimestamp) : new Date();
    const header = `Email ${incoming ? 'from' : 'to'} ${client.name} on ${day(when)}, subject "${m.subject ?? ''}":`;
    const items = KnowledgeService.chunkText(body).map((text, i) => ({
        source: 'email',
        sourceId: `${m.messageId}#${i}`,
        text,
        header,
    }));
    await KnowledgeService.store(`email:${user.id}:${m.messageId}`, {
        tenantId,
        clientId: client.id,
        meetingUuid: null,
        ownerUserId: user.id,
        occurredAt: when,
        items,
    });
    return items.length;
}

async function syncState(user) {
    const { rows } = await pool.query(
        'SELECT settings, email_synced_at FROM connector_settings WHERE user_id = $1',
        [user.id],
    );
    return { enabled: Boolean(rows[0]?.settings?.readEmail), syncedAt: rows[0]?.email_synced_at ?? null };
}

/**
 * Indexes the advisor's client emails since the last sync (the last 180 days the first time). Skips quietly
 * when the setting is off, Gmail isn't connected, or the last sync was under 15 minutes ago (unless `force`).
 */
async function sync(user, { force = false } = {}) {
    const { enabled, syncedAt } = await syncState(user);
    if (!enabled) return { skipped: 'email search is off' };
    if (!force && syncedAt && Date.now() - new Date(syncedAt).getTime() < SYNC_EVERY_MS) return { skipped: 'synced recently' };
    if (!(await KnowledgeService.isAvailable())) return { skipped: 'knowledge search is not set up' };
    if (!(await ConnectorService.status(user, 'gmail')).connected) return { skipped: 'Gmail is not connected' };

    const startedAt = new Date();
    const since = syncedAt ? new Date(syncedAt) : new Date(Date.now() - FIRST_SYNC_DAYS * 864e5);
    const clients = await clientsByAddress(user.tenantId);
    const own = await advisorAddress(user);
    const list = [...clients.keys()].filter((a) => a !== own);

    let messages = 0, chunks = 0;
    for (let i = 0; i < list.length && messages < MAX_MESSAGES_PER_SYNC; i += ADDRESSES_PER_QUERY) {
        const group = list.slice(i, i + ADDRESSES_PER_QUERY).join(' OR ');
        const query = `{from:(${group}) to:(${group})} after:${Math.floor(since.getTime() / 1000)}`;
        for (const m of await fetchMessages(user, query, MAX_MESSAGES_PER_SYNC - messages)) {
            messages++;
            chunks += await indexMessage(user, user.tenantId, clients, own, m);
        }
    }
    // shortcut: a sync that hits MAX_MESSAGES_PER_SYNC still moves the cursor, so older overflow is skipped.
    // Page by date instead if advisors with very busy client inboxes show up.
    await pool.query('UPDATE connector_settings SET email_synced_at = $2 WHERE user_id = $1', [user.id, startedAt]);
    // Switched off while this ran: drop what it just stored.
    if (!(await syncState(user)).enabled) await forget(user);
    return { messages, chunks };
}

const running = new Map(); // user id -> promise

/** Fire-and-forget sync, one at a time per advisor. Failures are logged, never thrown. */
function queueSync(user, options) {
    if (running.has(user.id)) return running.get(user.id);
    const job = sync(user, options)
        .then((r) => {
            if (r.messages !== undefined) console.log(`[EMAIL KNOWLEDGE] user ${user.id}: ${r.messages} messages, ${r.chunks} chunks`);
            return r;
        })
        .catch((err) => console.error(`[EMAIL KNOWLEDGE] sync for user ${user.id} failed:`, err.message))
        .finally(() => running.delete(user.id));
    running.set(user.id, job);
    return job;
}

/** Deletes everything indexed from the advisor's email and resets the cursor. */
async function forget(user) {
    await pool.query('UPDATE connector_settings SET email_synced_at = NULL WHERE user_id = $1', [user.id]);
    if (!(await KnowledgeService.isAvailable())) return { removed: 0 };
    const { rowCount } = await pool.query(
        "DELETE FROM knowledge_chunks WHERE owner_user_id = $1 AND source = 'email'",
        [user.id],
    );
    return { removed: rowCount };
}

module.exports = { sync, queueSync, forget, cleanBody, addresses };
