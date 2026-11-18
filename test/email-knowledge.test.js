const test = require("node:test");
const assert = require("node:assert");
const { cleanBody, addresses } = require("../src/services/EmailKnowledgeService");

test("addresses pulls every email out of a header, lowercased", () => {
    assert.deepStrictEqual(addresses('"Rahul Verma" <Rahul.Verma@Example.com>, sofia@example.com'), [
        "rahul.verma@example.com",
        "sofia@example.com",
    ]);
    assert.deepStrictEqual(addresses(undefined), []);
});

test("cleanBody keeps the new text and drops quoted history", () => {
    const text = [
        "Hi Dev,",
        "",
        "",
        "",
        "We can do Saturday at 11 for the site visit.",
        "> earlier line quoted",
        "Thanks, Rahul",
        "On Tue, 17 Nov 2026 at 10:02, Dev Advisor <dev@propley.in> wrote:",
        "Would Saturday work for a visit?",
    ].join("\n");
    assert.strictEqual(cleanBody(text), "Hi Dev,\n\nWe can do Saturday at 11 for the site visit.\nThanks, Rahul");
});

test("cleanBody stops at a forwarded original and caps length", () => {
    assert.strictEqual(cleanBody("FYI\n-----Original Message-----\nold"), "FYI");
    assert.strictEqual(cleanBody("x".repeat(7000)).length, 6000);
    assert.strictEqual(cleanBody(null), "");
});
