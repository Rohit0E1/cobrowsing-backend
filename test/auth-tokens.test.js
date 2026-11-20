const test = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const UserService = require("../src/services/UserService");
const TenantService = require("../src/services/TenantService");
const router = require("../src/routes/auth");

UserService.findByEmail = async () => ({ id: 7, email: "a@b.in", tenant_id: 1, password_hash: "x" });
UserService.verifyPassword = async () => true;
TenantService.getForMember = async (_userId, tenantId) => ({ id: tenantId, name: "Other" });

/** The last handler of a route: what runs after its middleware. */
const handler = (path) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path);
    return layer.route.stack[layer.route.stack.length - 1].handle;
};
const call = async (path, req) => {
    let body;
    await handler(path)(req, { status() { return this; }, json(b) { body = b; } });
    return body;
};
const lifetimeHours = (token) => {
    const { iat, exp } = jwt.decode(token);
    return (exp - iat) / 3600;
};

test("login tokens last as long as the frontend's cookies: 7 days, or 1 day without remember me", async () => {
    assert.strictEqual(lifetimeHours((await call("/login", { body: { email: "a@b.in", password: "p" } })).token), 7 * 24);
    assert.strictEqual(lifetimeHours((await call("/login", { body: { email: "a@b.in", password: "p", rememberMe: true } })).token), 7 * 24);
    assert.strictEqual(lifetimeHours((await call("/login", { body: { email: "a@b.in", password: "p", rememberMe: false } })).token), 24);
});

test("switching tenant keeps the current token's expiry", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const out = await call("/switch-tenant", { body: { tenant_id: 2 }, user: { id: 7, email: "a@b.in", tenantId: 1, exp } });
    const decoded = jwt.verify(out.token, process.env.JWT_SECRET);
    assert.strictEqual(decoded.exp, exp);
    assert.strictEqual(decoded.tenant_id, 2);
});
