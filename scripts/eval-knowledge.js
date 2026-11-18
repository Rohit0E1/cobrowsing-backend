require("dotenv").config();
const fs = require("node:fs");
const { parseArgs } = require("node:util");
const { pool } = require("../src/config/db");
const KnowledgeService = require("../src/services/KnowledgeService");

const USAGE = `Usage: node scripts/eval-knowledge.js questions.json [--tenant mandake] [--k 3] [--ignore-client]

questions.json: [{ "q": "What parking did Rahul ask for?", "client": "Rahul Verma", "expect": "two covered parking" }]
A question passes when one of the top k results contains "expect" (case-insensitive). "client" is optional
and limits the search to that client, as the assistant does; --ignore-client searches the whole tenant.
Read-only: it only searches.`;

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: { tenant: { type: "string", default: "mandake" }, k: { type: "string", default: "3" }, "ignore-client": { type: "boolean" } },
    });
    if (!positionals[0]) throw new Error(USAGE);
    const questions = JSON.parse(fs.readFileSync(positionals[0], "utf8"));
    const k = Number(values.k);

    const { rows } = await pool.query("SELECT id FROM tenants WHERE slug = $1", [values.tenant]);
    if (!rows[0]) throw new Error(`No tenant ${values.tenant}`);
    const tenantId = rows[0].id;

    let passed = 0;
    for (const { q, client, expect } of questions) {
        let clientId = null;
        if (client && !values["ignore-client"]) {
            const found = await pool.query("SELECT id FROM clients WHERE tenant_id = $1 AND name ILIKE $2", [tenantId, client]);
            clientId = found.rows[0]?.id ?? null;
        }
        const results = await KnowledgeService.search({ tenantId, query: q, clientId, limit: k });
        const rank = results.findIndex((r) => r.text.toLowerCase().includes(expect.toLowerCase()));
        if (rank >= 0) passed++;
        console.log(`${rank >= 0 ? `PASS #${rank + 1}` : "MISS   "}  ${q}${rank < 0 ? `\n         top: ${results[0]?.text.slice(0, 90).replace(/\n/g, " ")}` : ""}`);
    }
    console.log(`\n${passed}/${questions.length} with the right text in the top ${k}`);
}

main()
    .catch((err) => {
        console.error(err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
