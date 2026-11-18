const crypto = require('node:crypto');
const { pool } = require('../config/db');
const { vertexClient } = require('../config/vertex');

/**
 * Meaning search over what advisors wrote and said: meeting transcripts, meeting notes, client notes.
 * Text is split into chunks, embedded with Vertex in India (gemini-embedding-001, 768 dims, Mumbai by
 * default) and stored in knowledge_chunks with pgvector. Every search is limited to one tenant.
 */

const MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
const LOCATION = process.env.EMBEDDING_LOCATION || 'asia-south1';
const DIMENSIONS = 768;
const BATCH = 20;
const CHUNK_CHARS = 1000;
const OVERLAP_CHARS = 200;

let available = null; // memo: does knowledge_chunks exist (pgvector installed)?

async function isAvailable() {
    if (available === null) {
        const { rows } = await pool.query("SELECT to_regclass('knowledge_chunks') IS NOT NULL AS ok");
        available = rows[0].ok;
    }
    return available;
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const toVector = (values) => `[${values.join(',')}]`;

async function embed(texts, taskType) {
    const out = [];
    for (let i = 0; i < texts.length; i += BATCH) {
        const res = await vertexClient(LOCATION).models.embedContent({
            model: MODEL,
            contents: texts.slice(i, i + BATCH),
            config: { taskType, outputDimensionality: DIMENSIONS },
        });
        out.push(...res.embeddings.map((e) => e.values));
    }
    return out;
}

/** Splits long text on line breaks into ~1000-character chunks that overlap by ~200 characters. */
function chunkText(text) {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const chunks = [];
    let current = '';
    for (const line of lines) {
        // A single line longer than a chunk is cut into pieces of its own.
        const pieces = line.length > CHUNK_CHARS ? line.match(new RegExp(`.{1,${CHUNK_CHARS}}`, 'gs')) : [line];
        for (const piece of pieces) {
            if (current && current.length + piece.length + 1 > CHUNK_CHARS) {
                chunks.push(current);
                current = current.slice(-OVERLAP_CHARS).replace(/^\S*\s/, ''); // carry the tail over, from a word start
            }
            current = current ? `${current}\n${piece}` : piece;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

const day = (date) => (date ? new Date(date).toISOString().slice(0, 10) : 'unknown date');

/** Everything that should be indexed for one scope, as { source, sourceId, text, header }. */
async function collect(scope) {
    const [kind, id] = scope.split(':');

    if (kind === 'meeting') {
        const { rows } = await pool.query(
            `SELECT m.tenant_id, m.start_time, m.transcript, m.notes, m.meeting_for, c.id AS client_id, c.name AS client_name
             FROM meetings m
             LEFT JOIN scheduled_meetings sm ON sm.meeting_uuid = m.uuid
             LEFT JOIN clients c ON c.tenant_id = m.tenant_id AND LOWER(c.email) = LOWER(sm.client_email)
             WHERE m.uuid = $1
             LIMIT 1`,
            [id],
        );
        const m = rows[0];
        if (!m) return null;
        const who = m.client_name || m.meeting_for || 'a client';
        const header = `Presentation with ${who} on ${day(m.start_time)}.`;
        const items = [];
        if (m.transcript?.trim()) {
            chunkText(m.transcript).forEach((text, i) =>
                items.push({ source: 'transcript', sourceId: `${id}#${i}`, text, header: `${header} Transcript:` }),
            );
        }
        for (const note of Array.isArray(m.notes) ? m.notes : []) {
            if (note?.text?.trim()) {
                items.push({ source: 'meeting_note', sourceId: String(note.id), text: note.text.trim(), header: `${header} Advisor's note:` });
            }
        }
        return { tenantId: m.tenant_id, clientId: m.client_id, meetingUuid: id, items };
    }

    if (kind === 'client') {
        const { rows } = await pool.query(
            `SELECT c.tenant_id, c.name, n.id, n.body, n.created_at
             FROM clients c LEFT JOIN client_notes n ON n.client_id = c.id
             WHERE c.id = $1`,
            [Number(id)],
        );
        if (!rows.length) return null;
        const items = rows
            .filter((r) => r.body?.trim())
            .map((r) => ({
                source: 'client_note',
                sourceId: String(r.id),
                text: r.body.trim(),
                header: `Note on client ${r.name}, ${day(r.created_at)}:`,
            }));
        return { tenantId: rows[0].tenant_id, clientId: Number(id), meetingUuid: null, items };
    }

    throw new Error(`Unknown knowledge scope ${scope}`);
}

/**
 * Re-indexes one scope ("meeting:<uuid>" or "client:<id>") to match the database. Chunks whose text is
 * unchanged keep their embedding, so a small edit only embeds what changed.
 */
async function reindex(scope) {
    if (!(await isAvailable())) return { scope, skipped: 'knowledge search is not set up' };
    return store(scope, await collect(scope));
}

/**
 * Replaces a scope's chunks with `found.items` ({ source, sourceId, text, header }). `ownerUserId` makes them
 * private to that advisor (emails); `occurredAt` dates them when no meeting does. `found` null clears the scope.
 */
async function store(scope, found) {

    const { rows: existing } = await pool.query(
        'SELECT content_hash, embedding::text AS embedding FROM knowledge_chunks WHERE scope = $1',
        [scope],
    );
    const known = new Map(existing.map((r) => [r.content_hash, r.embedding]));

    const items = (found?.items ?? []).map((item) => {
        const embedded = `${item.header}\n${item.text}`;
        return { ...item, embedded, hash: sha256(embedded) };
    });
    const missing = items.filter((item) => !known.has(item.hash));
    const fresh = await embed(missing.map((item) => item.embedded), 'RETRIEVAL_DOCUMENT');
    missing.forEach((item, i) => known.set(item.hash, toVector(fresh[i])));

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM knowledge_chunks WHERE scope = $1', [scope]);
        for (const item of items) {
            await client.query(
                `INSERT INTO knowledge_chunks
                   (tenant_id, scope, source, source_id, client_id, meeting_uuid, text, content_hash, embedding, owner_user_id, occurred_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10, $11)`,
                [
                    found.tenantId, scope, item.source, item.sourceId, found.clientId, found.meetingUuid, item.text, item.hash,
                    known.get(item.hash), found.ownerUserId ?? null, found.occurredAt ?? null,
                ],
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
    return { scope, chunks: items.length, embedded: missing.length };
}

const running = new Map(); // scope -> promise, so two saves of the same meeting index one after the other

/** Fire-and-forget re-index after a save. Failures are logged, never thrown at the caller. */
function queue(scope) {
    const previous = running.get(scope) ?? Promise.resolve();
    const next = previous
        .then(() => reindex(scope))
        .catch((err) => console.error(`[KNOWLEDGE] index ${scope} failed:`, err.message))
        .finally(() => {
            if (running.get(scope) === next) running.delete(scope);
        });
    running.set(scope, next);
    return next;
}

/**
 * The chunks closest in meaning to the question, within one tenant and optionally one client. Private chunks
 * (an advisor's emails) only show to their owner, `userId`.
 */
async function search({ tenantId, userId, query, clientId = null, limit = 5 }) {
    if (!(await isAvailable())) throw Object.assign(new Error('Knowledge search is not set up'), { status: 503 });
    const [vector] = await embed([query], 'RETRIEVAL_QUERY');
    // shortcut: exact scan, no vector index; fine for thousands of chunks per tenant. Add an HNSW index
    // (with pgvector 0.8 iterative scans, so the tenant filter still returns enough rows) past ~100k chunks.
    const { rows } = await pool.query(
        `SELECT k.source, k.text, 1 - (k.embedding <=> $2::vector) AS score,
                c.name AS client, COALESCE(m.start_time, k.occurred_at) AS happened_at, k.meeting_uuid
         FROM knowledge_chunks k
         LEFT JOIN clients c ON c.id = k.client_id
         LEFT JOIN meetings m ON m.uuid = k.meeting_uuid
         WHERE k.tenant_id = $1 AND ($3::int IS NULL OR k.client_id = $3)
           AND (k.owner_user_id IS NULL OR k.owner_user_id = $5)
         ORDER BY k.embedding <=> $2::vector
         LIMIT $4`,
        [tenantId, toVector(vector), clientId, Math.min(Math.max(Number(limit) || 5, 1), 20), userId ?? null],
    );
    return rows.map((r) => ({
        source: r.source,
        client: r.client,
        date: r.happened_at ? day(r.happened_at) : null,
        meetingUuid: r.meeting_uuid,
        score: Number(Number(r.score).toFixed(3)),
        text: r.text,
    }));
}

module.exports = { queue, reindex, store, search, chunkText, isAvailable };
