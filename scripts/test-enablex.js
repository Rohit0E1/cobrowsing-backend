/**
 * EnableX Backend Test Script
 * Run: node scripts/test-enablex.js
 *
 * Tests all three EnableXService methods against the live API.
 * No server needed — runs against EnableX directly using .env credentials.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const EnableXService = require('../src/enablex/EnableXService');

const TEST_UUID = `test-session-${Date.now()}`;

// Helper: run a named test, print PASS/FAIL
async function test(label, fn) {
    process.stdout.write(`  ${label} ... `);
    try {
        const result = await fn();
        console.log('\x1b[32mPASS\x1b[0m');
        return result;
    } catch (err) {
        console.log('\x1b[31mFAIL\x1b[0m —', err.message);
        return null;
    }
}

async function main() {
    console.log('\n\x1b[1m=== EnableX Service Tests ===\x1b[0m');
    console.log(`  APP_ID : ${process.env.ENABLEX_APP_ID || '\x1b[33m(not set)\x1b[0m'}`);
    console.log(`  APP_KEY: ${process.env.ENABLEX_APP_KEY ? '***' + process.env.ENABLEX_APP_KEY.slice(-4) : '\x1b[33m(not set)\x1b[0m'}`);
    console.log(`  UUID   : ${TEST_UUID}\n`);

    // 1 ── Create Room
    let room = await test('createRoom()', async () => {
        const r = await EnableXService.createRoom(TEST_UUID, 'EnableX Test Session');
        if (!r?.room_id) throw new Error('No room_id in response');
        console.log(`         → room_id: \x1b[36m${r.room_id}\x1b[0m`);
        return r;
    });

    if (!room) {
        console.log('\n\x1b[31mCannot continue without a room — check ENABLEX_APP_ID / ENABLEX_APP_KEY.\x1b[0m\n');
        process.exit(1);
    }

    // 2 ── Get Room
    await test('getRoom()', async () => {
        const r = await EnableXService.getRoom(room.room_id);
        if (!r?.room_id) throw new Error('No room returned');
        if (r.room_id !== room.room_id) throw new Error(`room_id mismatch: ${r.room_id}`);
        return r;
    });

    // 3 ── Generate Moderator Token
    let modToken = await test('generateToken() — moderator', async () => {
        const token = await EnableXService.generateToken(room.room_id, 'TestModerator', 'moderator');
        if (!token || typeof token !== 'string') throw new Error('Token is empty or not a string');
        console.log(`         → token: \x1b[90m${token.slice(0, 40)}...\x1b[0m`);
        return token;
    });

    // 4 ── Generate Participant Token
    await test('generateToken() — participant', async () => {
        const token = await EnableXService.generateToken(room.room_id, 'TestParticipant', 'participant');
        if (!token || typeof token !== 'string') throw new Error('Token is empty or not a string');
        console.log(`         → token: \x1b[90m${token.slice(0, 40)}...\x1b[0m`);
        return token;
    });

    // Summary
    console.log('\n\x1b[1m=== Results ===\x1b[0m');
    console.log(`  Room ID   : ${room.room_id}`);
    console.log(`  Mod Token : ${modToken ? modToken.slice(0, 40) + '...' : 'n/a'}`);
    console.log('\n\x1b[32mDone.\x1b[0m Use the Room ID above in enablex-test.html to test the frontend.\n');
}

main().catch(err => {
    console.error('\n\x1b[31mUnexpected error:\x1b[0m', err.message);
    process.exit(1);
});
