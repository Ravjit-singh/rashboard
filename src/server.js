// src/server.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

// We no longer require the static projects.config file!
const { runAgent } = require('./groqAgent');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// --- 🧠 DYNAMIC GLOBAL MEMORY CACHE ---
// This now starts empty and waits for the frontend to tell it what projects exist.
global.systemCache = {
    projects: [], // Holds the full project data (URLs, DB keys, etc.)
    lastPing: null
};

// --- 🌉 THE SYNC BRIDGE ---
// The frontend calls this to securely pass the UI configurations to the backend.
app.post('/api/sync', (req, res) => {
    const { projects } = req.body;
    if (projects && Array.isArray(projects)) {
        global.systemCache.projects = projects;
        console.log(`[SYNC] Architecture updated. Now monitoring ${projects.length} dynamic projects.`);
        res.json({ success: true, count: projects.length });
    } else {
        res.status(400).json({ error: "Invalid payload" });
    }
});

// --- ⚙️ AUTOMATION: The 48-Hour Pinger ---
cron.schedule('0 0 */2 * *', async () => {
    console.log('[CRON] Initiating 48-hour heartbeat ping...');
    global.systemCache.lastPing = new Date().toISOString();
    // Later: We will map over global.systemCache.projects to ping them dynamically
});

// --- 🤖 AI AGENT ENDPOINT ---
app.post('/api/chat', async (req, res) => {
    const userMessage = req.body.message;
    if (!userMessage) return res.status(400).json({ error: "Message is required." });
    
    console.log(`[USER REQUEST]: ${userMessage}`);
    const agentResponse = await runAgent(userMessage);
    res.json({ response: agentResponse });
});

app.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`[SYSTEM] Rashboard Dynamic Core live on port ${PORT}`);
    console.log(`[SYSTEM] Awaiting UI synchronization...`);
    console.log(`==========================================`);
});
