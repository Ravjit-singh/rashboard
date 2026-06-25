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
const { loadChats } = require('./database');

// --- 📜 FETCH CHAT HISTORY ENDPOINT ---
app.get('/api/history', (req, res) => {
    const rawChats = loadChats();
    
    // We only want to send human-readable messages to the UI.
    // We filter out the raw system 'tool' JSON data so the chat looks clean.
    const displayChats = rawChats.filter(msg => 
        msg.role === 'user' || (msg.role === 'assistant' && msg.content !== null)
    );
    
    res.json({ history: displayChats });
});
// --- 🗑️ CLEAR CHAT HISTORY ENDPOINT ---
app.delete('/api/history', (req, res) => {
    const { clearHistory } = require('./contextWindow');
    clearHistory(); // Wipes the RAM and the JSON file
    res.json({ success: true });
});

// --- ⚙️ AUTOMATION: The 48-Hour Pinger ---
cron.schedule('0 0 */2 * *', async () => {
    console.log('[CRON] Initiating 48-hour heartbeat ping...');
    global.systemCache.lastPing = new Date().toISOString();
    // Later: We will map over global.systemCache.projects to ping them dynamically
});

// --- 🤖 AI AGENT ENDPOINT (STREAMING UPGRADE) ---
app.post('/api/chat', async (req, res) => {
    const userMessage = req.body.message;
    if (!userMessage) return res.status(400).json({ error: "Message is required." });
    
    console.log(`[USER REQUEST]: ${userMessage}`);

    // 1. Set headers to establish a continuous raw data stream
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Connection', 'keep-alive');

    try {
        // 2. Pass 'res' directly into the agent so it can pipe words as they are generated
        await runAgent(userMessage, res);
        res.end(); // Close the stream when the agent is done
    } catch (err) {
        console.error("[STREAM ERROR]", err);
        if (!res.headersSent) res.status(500).send("Stream failed");
        else res.end();
    }
});

app.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`[SYSTEM] Rashboard Dynamic Core live on port ${PORT}`);
    console.log(`[SYSTEM] Awaiting UI synchronization...`);
    console.log(`==========================================`);
});
