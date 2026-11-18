const test = require("node:test");
const assert = require("node:assert");
const { chunkText } = require("../src/services/KnowledgeService");

test("short text stays one chunk", () => {
    assert.deepStrictEqual(chunkText("Advisor: Hello\n\nRahul: Hi"), ["Advisor: Hello\nRahul: Hi"]);
});

test("long text splits into chunks under the limit that overlap", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i}: the client asked about the floor plan and the payment schedule.`);
    const chunks = chunkText(lines.join("\n"));
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 1000 + 80, `chunk of ${c.length} chars`);
    for (let i = 1; i < chunks.length; i++) {
        const tail = chunks[i - 1].slice(-60);
        assert.ok(chunks[i].includes(tail.slice(tail.indexOf(" ") + 1)), "next chunk starts with the previous tail");
    }
    for (const line of lines) assert.ok(chunks.some((c) => c.includes(line)), `${line} is kept whole somewhere`);
});

test("one very long line is cut, nothing lost", () => {
    const line = "x".repeat(2500);
    const chunks = chunkText(line);
    assert.ok(chunks.length >= 3);
    assert.ok(chunks.join("").replace(/\n/g, "").length >= 2500);
});

test("empty text gives no chunks", () => {
    assert.deepStrictEqual(chunkText("\n\n  \n"), []);
});
