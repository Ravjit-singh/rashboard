// src/server.js
const path = require('path');
// 1. Load the environment variables BEFORE anything else
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// 2. Now it is safe to load the agent and the rest of the app
const { runAgent } = require('./groqAgent');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const projects = require('../projects.config');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- 🧠 GLOBAL MEMORY CACHE ---
global.systemCache = {
    lastPing: null,
    projectStatus: {}
};

// Initialize empty status for all tracked projects
projects.forEach(proj => {
    global.systemCache.projectStatus[proj.id] = "Unknown";
});

// --- ⚙️ AUTOMATION: The 48-Hour Pinger ---
cron.schedule('0 0 */2 * *', async () => {
    console.log('[CRON] Initiating 48-hour heartbeat ping to prevent Render sleeping...');
    global.systemCache.lastPing = new Date().toISOString();
});

// --- 🌐 API ROUTES ---
app.get('/api/health', (req, res) => {
    res.json({ 
        status: "Rashboard Central Node is Active",
        trackedProjects: projects.length,
        cache: global.systemCache
    });
});

// --- 🤖 AI AGENT ENDPOINT ---
app.post('/api/chat', async (req, res) => {
    const userMessage = req.body.message;
    
    if (!userMessage) {
        return res.status(400).json({ error: "Message is required." });
    }

    console.log(`[USER REQUEST]: ${userMessage}`);
    
    // Pass the message to our Groq Execution Loop
    const agentResponse = await runAgent(userMessage);
    
    res.json({ response: agentResponse });
});

// --- BOOT UP ---
app.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`[SYSTEM] Rashboard backend live on port ${PORT}`);
    console.log(`[SYSTEM] Monitoring ${projects.length} projects:`);
    projects.forEach(p => console.log(`   -> ${p.name}`));
    console.log(`==========================================`);
});
