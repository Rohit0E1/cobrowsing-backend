const { io } = require('socket.io-client');

const SERVER_URL = process.argv.includes('--server-url')
    ? process.argv[process.argv.indexOf('--server-url') + 1]
    : 'http://localhost:5001';

function generateSpeechChunk(durationMs = 100, frequency = 440, amplitude = 8000, sampleRate = 16000) {
    const numSamples = Math.floor((sampleRate * durationMs) / 1000);
    const buffer = Buffer.alloc(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
        const sample = Math.round(amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate));
        buffer.writeInt16LE(sample, i * 2);
    }
    return buffer;
}

function generateSilenceChunk(durationMs = 100, sampleRate = 16000) {
    const numSamples = Math.floor((sampleRate * durationMs) / 1000);
    return Buffer.alloc(numSamples * 2);
}

function waitForEvent(socket, eventName, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout waiting for '${eventName}' (${timeoutMs}ms)`));
        }, timeoutMs);

        socket.once(eventName, (data) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

function waitForEventOptional(socket, eventName, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        socket.once(eventName, (data) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

function connectClient() {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER_URL, {
            transports: ['websocket'],
            reconnection: false,
            timeout: 5000,
        });

        const timer = setTimeout(() => {
            socket.disconnect();
            reject(new Error('Connection timeout'));
        }, 5000);

        socket.on('connect', () => {
            clearTimeout(timer);
            resolve(socket);
        });

        socket.on('connect_error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Connection failed: ${err.message}`));
        });
    });
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

const results = [];

async function runTest(name, fn) {
    process.stdout.write(`  ⏳ ${name}...`);
    try {
        await fn();
        results.push({ name, status: 'PASS' });
        process.stdout.write(`\r  ✅ ${name}\n`);
    } catch (err) {
        results.push({ name, status: 'FAIL', error: err.message });
        process.stdout.write(`\r  ❌ ${name}: ${err.message}\n`);
    }
}

async function testStartListening() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { language: 'en-IN' });
        const data = await waitForEvent(socket, 'voice:listening', 3000);
        if (data === undefined && data !== null) throw new Error('No voice:listening received');
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

async function testDuplicateStart() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { language: 'en-IN' });
        await waitForEvent(socket, 'voice:listening', 3000);

        socket.emit('voice:start', { language: 'en-IN' });
        await sleep(500);

        socket.emit('voice:stop');
        const ended = await waitForEvent(socket, 'voice:ended', 3000);
    } finally {
        socket.disconnect();
    }
}

async function testSilenceOnly() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', {});
        await waitForEvent(socket, 'voice:listening', 3000);

        for (let i = 0; i < 15; i++) {
            const silence = generateSilenceChunk(100);
            socket.emit('voice:audio-chunk', { audio: silence.toString('base64') });
            await sleep(20);
        }

        const processing = await waitForEventOptional(socket, 'voice:processing', 2000);
        if (processing !== null) {
            throw new Error('Received voice:processing for silence-only input');
        }
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

async function testSpeechThenSilence() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { silenceMs: 500 });
        await waitForEvent(socket, 'voice:listening', 3000);

        const processingPromise = waitForEventOptional(socket, 'voice:processing', 8000);

        for (let i = 0; i < 5; i++) {
            const speech = generateSpeechChunk(100, 440, 8000);
            socket.emit('voice:audio-chunk', { audio: speech.toString('base64') });
            await sleep(30);
        }

        for (let i = 0; i < 12; i++) {
            const silence = generateSilenceChunk(100);
            socket.emit('voice:audio-chunk', { audio: silence.toString('base64') });
            await sleep(60);
        }

        const processing = await processingPromise;
        if (processing === null) {
            throw new Error('Did not receive voice:processing after speech + silence');
        }

        const nextEvent = await Promise.race([
            waitForEventOptional(socket, 'voice:transcript', 10000),
            waitForEventOptional(socket, 'voice:error', 10000),
            waitForEventOptional(socket, 'voice:listening', 10000),
        ]);

    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

async function testTooFewSpeechChunks() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { silenceMs: 300 });
        await waitForEvent(socket, 'voice:listening', 3000);

        const listeningPromise = waitForEventOptional(socket, 'voice:listening', 5000);

        const speech = generateSpeechChunk(100, 440, 8000);
        socket.emit('voice:audio-chunk', { audio: speech.toString('base64') });
        await sleep(30);

        for (let i = 0; i < 10; i++) {
            const silence = generateSilenceChunk(100);
            socket.emit('voice:audio-chunk', { audio: silence.toString('base64') });
            await sleep(50);
        }

        const listening = await listeningPromise;
        if (listening === null) {
            throw new Error('Did not receive voice:listening for too-few speech chunks');
        }
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

async function testStopDuringProcessing() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { silenceMs: 300 });
        await waitForEvent(socket, 'voice:listening', 3000);

        for (let i = 0; i < 5; i++) {
            const speech = generateSpeechChunk(100, 440, 8000);
            socket.emit('voice:audio-chunk', { audio: speech.toString('base64') });
            await sleep(20);
        }
        for (let i = 0; i < 8; i++) {
            const silence = generateSilenceChunk(100);
            socket.emit('voice:audio-chunk', { audio: silence.toString('base64') });
            await sleep(50);
        }

        const processing = await waitForEventOptional(socket, 'voice:processing', 3000);
        if (processing !== null) {
            socket.emit('voice:stop');
            const ended = await waitForEvent(socket, 'voice:ended', 3000);
        }
    } finally {
        socket.disconnect();
    }
}

async function testStopWithoutStart() {
    const socket = await connectClient();
    try {
        socket.emit('voice:stop');
        await sleep(500);
    } finally {
        socket.disconnect();
    }
}

async function testChunksWithoutStart() {
    const socket = await connectClient();
    try {
        const speech = generateSpeechChunk(100, 440, 8000);
        for (let i = 0; i < 5; i++) {
            socket.emit('voice:audio-chunk', { audio: speech.toString('base64') });
            await sleep(20);
        }
        await sleep(500);

        const processing = await waitForEventOptional(socket, 'voice:processing', 1000);
        if (processing !== null) {
            throw new Error('Received voice:processing without voice:start');
        }
    } finally {
        socket.disconnect();
    }
}

async function testRapidFireChunks() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', {});
        await waitForEvent(socket, 'voice:listening', 3000);

        const speech = generateSpeechChunk(50, 440, 8000);
        for (let i = 0; i < 100; i++) {
            socket.emit('voice:audio-chunk', { audio: speech.toString('base64') });
        }

        await sleep(1000);
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

async function testTtsDoneWithoutSession() {
    const socket = await connectClient();
    try {
        socket.emit('voice:tts-done', {});
        await sleep(500);
    } finally {
        socket.disconnect();
    }
}

async function testEmptyAudioPayload() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', {});
        await waitForEvent(socket, 'voice:listening', 3000);

        socket.emit('voice:audio-chunk', {});
        socket.emit('voice:audio-chunk', { audio: '' });
        socket.emit('voice:audio-chunk', { audio: null });

        await sleep(500);
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

async function testSequentialConversations() {
    const socket = await connectClient();
    try {
        for (let round = 0; round < 3; round++) {
            socket.emit('voice:start', {});
            await waitForEvent(socket, 'voice:listening', 3000);
            await sleep(200);
            socket.emit('voice:stop');
            await waitForEvent(socket, 'voice:ended', 3000);
            await sleep(200);
        }
    } finally {
        socket.disconnect();
    }
}

async function testBargeInStateTransition() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { silenceMs: 300 });
        await waitForEvent(socket, 'voice:listening', 3000);

        for (let i = 0; i < 5; i++) {
            socket.emit('voice:audio-chunk', { audio: generateSpeechChunk(100).toString('base64') });
            await sleep(20);
        }
        for (let i = 0; i < 8; i++) {
            socket.emit('voice:audio-chunk', { audio: generateSilenceChunk(100).toString('base64') });
            await sleep(50);
        }

        const processing = await waitForEventOptional(socket, 'voice:processing', 3000);

        if (processing !== null) {
            await sleep(500);
            for (let i = 0; i < 5; i++) {
                socket.emit('voice:audio-chunk', { audio: generateSpeechChunk(100, 440, 10000).toString('base64') });
                await sleep(20);
            }

            const bargeIn = await waitForEventOptional(socket, 'voice:barge-in', 3000);
        }
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

async function testDisconnectDuringConversation() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', {});
        await waitForEvent(socket, 'voice:listening', 3000);

        for (let i = 0; i < 5; i++) {
            socket.emit('voice:audio-chunk', { audio: generateSpeechChunk(100).toString('base64') });
            await sleep(20);
        }

        socket.disconnect();
        await sleep(500);

        const socket2 = await connectClient();
        socket2.emit('voice:start', {});
        await waitForEvent(socket2, 'voice:listening', 3000);
        socket2.emit('voice:stop');
        await waitForEvent(socket2, 'voice:ended', 3000);
        socket2.disconnect();
    } catch (err) {
        if (socket.connected) socket.disconnect();
        throw err;
    }
}

async function main() {
    console.log(`\n🎤 Voice Conversation Engine — Edge Case Tests`);
    console.log(`   Server: ${SERVER_URL}\n`);

    try {
        const testSocket = await connectClient();
        testSocket.disconnect();
    } catch (err) {
        console.error(`❌ Cannot connect to server at ${SERVER_URL}`);
        console.error(`   Make sure the server is running: npm run dev\n`);
        process.exit(1);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Socket Protocol Tests (no credentials needed)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    await runTest('1.  voice:start → voice:listening', testStartListening);
    await runTest('2.  Duplicate voice:start (no crash)', testDuplicateStart);
    await runTest('3.  Silence-only audio (no STT trigger)', testSilenceOnly);
    await runTest('4.  Too few speech chunks → resume listening', testTooFewSpeechChunks);
    await runTest('5.  voice:stop without voice:start (no crash)', testStopWithoutStart);
    await runTest('6.  Audio chunks without voice:start (ignored)', testChunksWithoutStart);
    await runTest('7.  voice:tts-done without session (no crash)', testTtsDoneWithoutSession);
    await runTest('8.  Empty audio payloads (no crash)', testEmptyAudioPayload);
    await runTest('9.  Rapid-fire 100 chunks (stress test)', testRapidFireChunks);
    await runTest('10. Multiple sequential conversations', testSequentialConversations);
    await runTest('11. Disconnect during active conversation', testDisconnectDuringConversation);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Pipeline Tests (requires SARVAM_API_KEY)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    await runTest('12. Speech + silence → processing pipeline', testSpeechThenSilence);
    await runTest('13. voice:stop during processing (abort)', testStopDuringProcessing);
    await runTest('14. Barge-in state transition', testBargeInStateTransition);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const passed = results.filter((r) => r.status === 'PASS').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;
    const total = results.length;

    console.log(`\n  Results: ${passed}/${total} passed, ${failed} failed\n`);

    if (failed > 0) {
        console.log('  Failed tests:');
        results.filter((r) => r.status === 'FAIL').forEach((r) => {
            console.log(`    ❌ ${r.name}: ${r.error}`);
        });
        console.log('');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Test runner error:', err);
    process.exit(1);
});
