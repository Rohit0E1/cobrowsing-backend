require("dotenv").config();
const { pool, initDb } = require("../src/config/db");
const KnowledgeService = require("../src/services/KnowledgeService");

/**
 * Indexes every existing meeting transcript, meeting note and client note for knowledge search.
 * Safe to re-run: unchanged text keeps its embedding, so a second run embeds nothing.
 *   node scripts/backfill-knowledge.js
 */
async function main() {
    await initDb();
    if (!(await KnowledgeService.isAvailable())) throw new Error("knowledge_chunks is missing: install pgvector first");

    const { rows: meetings } = await pool.query(
        `SELECT uuid FROM meetings
         WHERE COALESCE(transcript, '') <> '' OR jsonb_array_length(COALESCE(notes, '[]'::jsonb)) > 0`,
    );
    const { rows: clients } = await pool.query("SELECT DISTINCT client_id FROM client_notes");
    const scopes = [...meetings.map((m) => `meeting:${m.uuid}`), ...clients.map((c) => `client:${c.client_id}`)];
    console.log(`Indexing ${meetings.length} meetings and ${clients.length} clients with notes`);

    let chunks = 0, embedded = 0, failed = 0;
    for (const [i, scope] of scopes.entries()) {
        try {
            const r = await KnowledgeService.reindex(scope);
            chunks += r.chunks ?? 0;
            embedded += r.embedded ?? 0;
        } catch (err) {
            failed++;
            console.error(`  ${scope} failed: ${err.message}`);
        }
        if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${scopes.length}`);
    }
    console.log(`Done: ${chunks} chunks, ${embedded} newly embedded, ${failed} failed`);
}

main()
    .catch((err) => {
        console.error(err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
