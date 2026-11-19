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

const { asksAboutEmail } = require("../src/services/KnowledgeService");

test("questions about email are recognised, others are not", () => {
    for (const q of ["What did I email Rahul about?", "anything in my inbox from Sofia", "Rahul ko kya ईमेल kiya tha", "did she e-mail back"]) {
        assert.ok(asksAboutEmail(q), q);
    }
    for (const q of ["What did Rahul say about parking?", "When is the site visit?", "Mailbox Heights brochure"]) {
        assert.ok(!asksAboutEmail(q), q);
    }
});

test('assistant conversations keep facts, not questions or "no record" replies', () => {
    const { worthRemembering } = require('../src/services/KnowledgeService');
    const keep = [
        { role: 'advisor', text: 'She wants a 3 BHK under 2 crore. Draft an email to her.' },
        { role: 'advisor', text: 'Can you add Tapaswin as a new client' },
        { role: 'assistant', text: 'Renamed Tapaswin to "Tapaswin Padhy".' },
    ];
    const drop = [
        { role: 'advisor', text: 'What budget did I mention for her?' },
        { role: 'advisor', text: 'did that email go out' },
        { role: 'assistant', text: 'I have no record of you mentioning a budget for Tapaswin.' },
        { role: 'assistant', text: "I can't see whether you sent it." },
    ];
    for (const m of keep) assert.ok(worthRemembering(m), m.text);
    for (const m of drop) assert.ok(!worthRemembering(m), m.text);
});
