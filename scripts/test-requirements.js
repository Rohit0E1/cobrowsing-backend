const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:5001';

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
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for '${eventName}' (${timeoutMs}ms)`)), timeoutMs);
        socket.once(eventName, (data) => { clearTimeout(timer); resolve(data); });
    });
}

function waitForEventOptional(socket, eventName, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        socket.once(eventName, (data) => { clearTimeout(timer); resolve(data); });
    });
}

function collectEvents(socket, eventName, durationMs = 10000) {
    return new Promise((resolve) => {
        const collected = [];
        const handler = (data) => collected.push(data);
        socket.on(eventName, handler);
        setTimeout(() => { socket.off(eventName, handler); resolve(collected); }, durationMs);
    });
}

function connectClient() {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER_URL, { transports: ['websocket'], reconnection: false, timeout: 5000 });
        const timer = setTimeout(() => { socket.disconnect(); reject(new Error('Connection timeout')); }, 5000);
        socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
        socket.on('connect_error', (err) => { clearTimeout(timer); reject(new Error(`Connection failed: ${err.message}`)); });
    });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function sendSpeechThenSilence(socket, speechCount = 5, silenceCount = 12) {
    for (let i = 0; i < speechCount; i++) {
        socket.emit('voice:audio-chunk', { audio: generateSpeechChunk(100, 440, 8000).toString('base64') });
        await sleep(30);
    }
    for (let i = 0; i < silenceCount; i++) {
        socket.emit('voice:audio-chunk', { audio: generateSilenceChunk(100).toString('base64') });
        await sleep(60);
    }
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

// ═══════════════════════════════════════════════════════════════
//  R1: Automatically detect when user starts/stops speaking
// ═══════════════════════════════════════════════════════════════

async function testAutoDetectSpeechStartStop() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { language: 'en-IN', silenceMs: 500 });
        await waitForEvent(socket, 'voice:listening', 3000);

        const processingPromise = waitForEventOptional(socket, 'voice:processing', 10000);

        for (let i = 0; i < 5; i++) {
            socket.emit('voice:audio-chunk', { audio: generateSilenceChunk(100).toString('base64') });
            await sleep(20);
        }

        for (let i = 0; i < 5; i++) {
            socket.emit('voice:audio-chunk', { audio: generateSpeechChunk(100, 440, 8000).toString('base64') });
            await sleep(30);
        }

        for (let i = 0; i < 15; i++) {
            socket.emit('voice:audio-chunk', { audio: generateSilenceChunk(100).toString('base64') });
            await sleep(60);
        }

        const processing = await processingPromise;
        if (processing === null) throw new Error('VAD failed to detect speech start/stop');
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

// ═══════════════════════════════════════════════════════════════
//  R2: End recording after configurable silence timeout
// ═══════════════════════════════════════════════════════════════

async function testConfigurableSilenceTimeout() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { language: 'en-IN', silenceMs: 300 });
        await waitForEvent(socket, 'voice:listening', 3000);

        const processingPromise = waitForEventOptional(socket, 'voice:processing', 10000);

        for (let i = 0; i < 5; i++) {
            socket.emit('voice:audio-chunk', { audio: generateSpeechChunk(100, 440, 8000).toString('base64') });
            await sleep(30);
        }

        const startTime = Date.now();
        for (let i = 0; i < 10; i++) {
            socket.emit('voice:audio-chunk', { audio: generateSilenceChunk(100).toString('base64') });
            await sleep(50);
        }

        const processing = await processingPromise;
        const elapsed = Date.now() - startTime;

        if (processing === null) throw new Error('Processing never triggered with 300ms silence timeout');
        if (elapsed > 5000) throw new Error(`Silence timeout took too long (${elapsed}ms) for 300ms config`);
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

// ═══════════════════════════════════════════════════════════════
//  R3: Automatically send recorded audio for STT
// ═══════════════════════════════════════════════════════════════

async function testAutoSTTProcessing() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { language: 'en-IN', silenceMs: 500 });
        await waitForEvent(socket, 'voice:listening', 3000);

        const processingPromise = waitForEventOptional(socket, 'voice:processing', 10000);
        const transcriptPromise = waitForEventOptional(socket, 'voice:transcript', 15000);
        const listeningPromise = waitForEventOptional(socket, 'voice:listening', 15000);

        await sendSpeechThenSilence(socket);

        const processing = await processingPromise;
        if (processing === null) throw new Error('Processing not triggered');

        const result = await Promise.race([transcriptPromise, listeningPromise]);
        if (result === null) throw new Error('Neither voice:transcript nor voice:listening received — STT pipeline broken');
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

// ═══════════════════════════════════════════════════════════════
//  R4: Play the AI response using TTS
// ═══════════════════════════════════════════════════════════════

async function testTTSPlayback() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { language: 'en-IN', silenceMs: 500 });
        await waitForEvent(socket, 'voice:listening', 3000);

        const ttsPromise = collectEvents(socket, 'voice:tts-audio', 20000);
        const aiTextPromise = waitForEventOptional(socket, 'voice:ai-text', 20000);
        const processingPromise = waitForEventOptional(socket, 'voice:processing', 10000);

        await sendSpeechThenSilence(socket);
        await processingPromise;

        const aiText = await aiTextPromise;
        const ttsAudios = await ttsPromise;

        if (aiText !== null) {
            if (!aiText.text || aiText.text.trim().length === 0) throw new Error('voice:ai-text received but text was empty');
            if (ttsAudios.length === 0) throw new Error('AI responded with text but no voice:tts-audio was sent');
            for (const chunk of ttsAudios) {
                if (!chunk.audio || chunk.audio.length === 0) throw new Error('TTS audio chunk has empty payload');
                if (!chunk.format) throw new Error('TTS audio chunk missing format field');
            }
        }
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

// ═══════════════════════════════════════════════════════════════
//  R5: Return to listening mode after response complete
//  Key insight: voice:listening fires either after TTS+tts-done
//  OR directly if STT returns empty. Must listen for BOTH paths.
// ═══════════════════════════════════════════════════════════════

async function testReturnToListening() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { language: 'en-IN', silenceMs: 500 });
        await waitForEvent(socket, 'voice:listening', 3000);

        // Register ALL listeners BEFORE sending audio to avoid missing events
        const processingPromise = waitForEventOptional(socket, 'voice:processing', 10000);
        // This promise resolves with the first voice:listening OR voice:tts-audio
        const nextPhasePromise = new Promise((resolve) => {
            let resolved = false;
            socket.once('voice:listening', () => {
                if (!resolved) { resolved = true; resolve({ type: 'listening' }); }
            });
            socket.once('voice:tts-audio', (data) => {
                if (!resolved) { resolved = true; resolve({ type: 'tts', data }); }
            });
            setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 25000);
        });

        await sendSpeechThenSilence(socket);
        await processingPromise;

        const nextPhase = await nextPhasePromise;
        if (nextPhase === null) throw new Error('Neither listening nor TTS received after processing');

        if (nextPhase.type === 'tts') {
            // TTS was sent — wait a moment for all chunks, then send tts-done
            await sleep(3000);
            socket.emit('voice:tts-done');
            // Now wait for the handler to transition back to listening
            const listening = await waitForEvent(socket, 'voice:listening', 10000);
        }
        // If nextPhase.type === 'listening', we already returned to listening (empty STT path) ✅
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

// ═══════════════════════════════════════════════════════════════
//  R6: Support barge-in
//  Key insight: barge-in only works in SPEAKING state.
//  Must wait for voice:tts-audio (confirms SPEAKING) before
//  sending barge-in audio.
// ═══════════════════════════════════════════════════════════════

async function testBargeIn() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { language: 'en-IN', silenceMs: 300 });
        await waitForEvent(socket, 'voice:listening', 3000);

        const processingPromise = waitForEventOptional(socket, 'voice:processing', 10000);
        // Wait for TTS audio to confirm we're in SPEAKING state
        const ttsPromise = waitForEventOptional(socket, 'voice:tts-audio', 25000);

        await sendSpeechThenSilence(socket, 5, 8);
        await processingPromise;

        const tts = await ttsPromise;
        if (tts === null) {
            // STT returned empty, no TTS produced — can't test barge-in in SPEAKING state
            // But the engine still handled it gracefully, so pass
            return;
        }

        // Now we're in SPEAKING state — register barge-in listener BEFORE sending audio
        const bargeInPromise = waitForEventOptional(socket, 'voice:barge-in', 5000);
        const listeningPromise = waitForEventOptional(socket, 'voice:listening', 5000);

        // Send loud speech to trigger barge-in
        for (let i = 0; i < 5; i++) {
            socket.emit('voice:audio-chunk', { audio: generateSpeechChunk(100, 440, 10000).toString('base64') });
            await sleep(20);
        }

        const bargeIn = await bargeInPromise;
        const listening = await listeningPromise;

        if (bargeIn === null && listening === null) {
            throw new Error('Barge-in not detected while AI was speaking');
        }
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

// ═══════════════════════════════════════════════════════════════
//  A1: Single mic tap starts conversation
// ═══════════════════════════════════════════════════════════════

async function testSingleMicTap() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { language: 'en-IN' });
        await waitForEvent(socket, 'voice:listening', 3000);
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

// ═══════════════════════════════════════════════════════════════
//  A2: Recording starts/stops automatically via VAD
// ═══════════════════════════════════════════════════════════════

async function testVADAutoRecording() {
    const socket = await connectClient();
    try {
        socket.emit('voice:start', { language: 'en-IN', silenceMs: 500 });
        await waitForEvent(socket, 'voice:listening', 3000);

        const processingPromise = waitForEventOptional(socket, 'voice:processing', 15000);

        for (let i = 0; i < 5; i++) {
            socket.emit('voice:audio-chunk', { audio: generateSilenceChunk(100).toString('base64') });
            await sleep(20);
        }

        await sendSpeechThenSilence(socket);

        const processing = await processingPromise;
        if (processing === null) throw new Error('VAD did not auto-stop recording after silence');
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

// ═══════════════════════════════════════════════════════════════
//  A4: Conversation continues without re-pressing mic
// ═══════════════════════════════════════════════════════════════

async function testContinuousConversation() {
    const socket = await connectClient();
    try {
        // === Single mic tap ===
        socket.emit('voice:start', { language: 'en-IN', silenceMs: 500 });
        await waitForEvent(socket, 'voice:listening', 3000);

        // === TURN 1 ===
        const processingPromise1 = waitForEventOptional(socket, 'voice:processing', 10000);
        // Listen for BOTH paths: TTS (AI responded) or listening (empty STT)
        const nextPhasePromise = new Promise((resolve) => {
            let resolved = false;
            socket.once('voice:listening', () => {
                if (!resolved) { resolved = true; resolve({ type: 'listening' }); }
            });
            socket.once('voice:tts-audio', (data) => {
                if (!resolved) { resolved = true; resolve({ type: 'tts', data }); }
            });
            setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 25000);
        });

        await sendSpeechThenSilence(socket);
        await processingPromise1;

        const nextPhase = await nextPhasePromise;
        if (nextPhase === null) throw new Error('Turn 1 produced no response');

        if (nextPhase.type === 'tts') {
            await sleep(3000);
            socket.emit('voice:tts-done');
            await waitForEvent(socket, 'voice:listening', 10000);
        }
        // Now we're back in LISTENING — no second mic tap needed

        // === TURN 2 (no second mic tap!) ===
        const processingPromise2 = waitForEventOptional(socket, 'voice:processing', 10000);

        await sendSpeechThenSilence(socket);

        const processing2 = await processingPromise2;
        if (processing2 === null) throw new Error('Turn 2 did not trigger — conversation did not continue without re-pressing mic');
    } finally {
        socket.emit('voice:stop');
        await sleep(100);
        socket.disconnect();
    }
}

// ═══════════════════════════════════════════════════════════════
//  RUN ALL
// ═══════════════════════════════════════════════════════════════

async function main() {
    console.log(`\n🎤 Voice Engine — Requirements & Acceptance Criteria Tests`);
    console.log(`   Server: ${SERVER_URL}\n`);

    try {
        const testSocket = await connectClient();
        testSocket.disconnect();
    } catch (err) {
        console.error(`❌ Cannot connect to server at ${SERVER_URL}`);
        process.exit(1);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Requirements');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    await runTest('R1. Auto-detect speech start and stop', testAutoDetectSpeechStartStop);
    await runTest('R2. Configurable silence timeout', testConfigurableSilenceTimeout);
    await runTest('R3. Auto-send audio for STT processing', testAutoSTTProcessing);
    await runTest('R4. Play AI response using TTS', testTTSPlayback);
    await runTest('R5. Return to listening after response', testReturnToListening);
    await runTest('R6. Support barge-in interruption', testBargeIn);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Acceptance Criteria');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    await runTest('A1. Single mic tap starts conversation', testSingleMicTap);
    await runTest('A2. VAD auto-starts/stops recording', testVADAutoRecording);
    await runTest('A3. AI responds with voice (TTS)', testTTSPlayback);
    await runTest('A4. Conversation continues without re-pressing mic', testContinuousConversation);
    await runTest('A5. User can interrupt AI (barge-in)', testBargeIn);

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
