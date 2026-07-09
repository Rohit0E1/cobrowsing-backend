const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

const router = express.Router();

router.get('/voice', (req, res) => {
    // Run the regression test script as a child process
    const scriptPath = path.join(__dirname, '../../scripts/test-voice-conversation.js');
    const child = spawn('node', [scriptPath]);

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
        output += data.toString();
    });

    child.stderr.on('data', (data) => {
        errorOutput += data.toString();
    });

    child.on('close', (code) => {
        if (code === 0) {
            res.status(200).json({
                success: true,
                message: 'All Voice Conversation Engine tests passed.',
                output: output
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Voice Conversation Engine tests failed.',
                error: errorOutput || output,
                code: code
            });
        }
    });
});

router.get('/requirements', (req, res) => {
    const scriptPath = path.join(__dirname, '../../scripts/test-requirements.js');
    const child = spawn('node', [scriptPath]);

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
        output += data.toString();
    });

    child.stderr.on('data', (data) => {
        errorOutput += data.toString();
    });

    child.on('close', (code) => {
        if (code === 0) {
            res.status(200).json({
                success: true,
                message: 'All requirements and acceptance criteria passed.',
                output: output
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Requirements/acceptance criteria tests failed.',
                error: errorOutput || output,
                code: code
            });
        }
    });
});

module.exports = router;
