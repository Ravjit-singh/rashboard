// src/localAgent.js (Formerly groqAgent.js)
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const nodemailer = require('nodemailer');
const { getHistory, addMessage } = require('./contextWindow'); 

// 🚨 We are now aiming at your local Termux server! 🚨
const LOCAL_API_URL = "http://127.0.0.1:8080/v1/chat/completions";
const MEMORY_FILE = path.join(__dirname, '../memory.json');
const TEMPLATE_FILE = path.join(__dirname, 'emailTemplate.html');

if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({}, null, 2));
}

// ... [Keep all your retrieveRelevantMemories, tools, and executeTool code exactly as it is] ...


// --- 🧠 LIGHTWEIGHT RAG ENGINE (Zero-Dependency) ---
function retrieveRelevantMemories(prompt, memoryObj) {
    const stopWords = new Set(['the','is','in','at','of','on','and','a','an','to','for','with','it','this','that','tell','me','about','how','many','are','there']);
    const words = prompt.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    const keywords = words.filter(w => w.length > 2 && !stopWords.has(w));

    if (keywords.length === 0) return "Memory banks ready.";
    let scoredMemories = [];

    for (const [topic, info] of Object.entries(memoryObj)) {
        if (topic === 'system') continue; 
        let score = 0;
        const combinedText = (topic + " " + info).toLowerCase();
        keywords.forEach(kw => {
            const regex = new RegExp(kw, 'g');
            const matches = combinedText.match(regex);
            if (matches) {
                score += matches.length; 
                if (topic.toLowerCase().includes(kw)) score += 3; 
            }
        });
        if (score > 0) scoredMemories.push({ topic, info, score });
    }

    if (scoredMemories.length === 0) return "No highly relevant memories found for this specific query.";
    scoredMemories.sort((a, b) => b.score - a.score);
    const topMemories = scoredMemories.slice(0, 3);

    let contextString = "RELEVANT MEMORIES RETAINED FOR THIS TASK:\n";
    topMemories.forEach(m => { contextString += `- [${m.topic}]: ${m.info}\n`; });
    return contextString;
}

// --- 🛠️ THE AI TOOLBELT ---
const tools = [
    {
        type: "function",
        function: {
            name: "getProjectStatus",
            description: "Get the live URL and the secret environment vault keys for a mapped project.",
            parameters: {
                type: "object",
                properties: { projectName: { type: "string", description: "The exact name of the project." } },
                required: ["projectName"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "saveToMemory",
            description: "Trigger this IMMEDIATELY to save a fact permanently anytime the user says 'remember', 'keep in mind', 'note', or dictates a structural rule.",
            parameters: {
                type: "object",
                properties: {
                    topic: { type: "string", description: "A short 1-3 word key." },
                    information: { type: "string", description: "The detailed info to save." }
                },
                required: ["topic", "information"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "removeFromMemory",
            description: "Use ONLY when the user commands you to 'forget', 'delete', or 'remove' a previously saved memory.",
            parameters: {
                type: "object",
                properties: { topic: { type: "string", description: "The exact topic name of the memory to delete." } },
                required: ["topic"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "sendEmail",
            description: "Dispatches an email via a standard local design template. Generate plain text content for the body only; the system wrapper formats it automatically.",
            parameters: {
                type: "object",
                properties: {
                    to: { type: "string", description: "The recipient's target email address." },
                    subject: { type: "string", description: "A summary sentence for the email header context." },
                    body: { type: "string", description: "The text data report, summary, or details to compile inside the message container." }
                },
                required: ["to", "subject", "body"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "querySupabaseDatabase",
            description: "Fetch live data from Supabase. Use this to count rows, query tables, or when the user confirms a table name.",
            parameters: {
                type: "object",
                properties: {
                    projectName: { type: "string", description: "The exact name of the project." },
                    tableName: { type: "string", description: "The exact name of the database table." },
                    selectQuery: { type: "string", description: "Set to 'count' to get total rows, or '*' to get row data." },
                    limit: { type: "number", description: "Max rows to fetch. Default is 5." }
                },
                required: ["projectName", "tableName"]
            }
        }
    }
];

// --- ⚙️ TOOL EXECUTION LOGIC ---
async function executeTool(toolName, toolArgs) {
    console.log(`[AGENT] Executing tool: ${toolName}`);
    
    if (toolName === "saveToMemory") {
        try {
            const memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
            memory[toolArgs.topic] = toolArgs.information;
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
            return JSON.stringify({ success: `Memorized under topic: ${toolArgs.topic}.` });
        } catch (error) { return JSON.stringify({ error: "Failed to write to memory disk." }); }
    }

    if (toolName === "removeFromMemory") {
        try {
            const memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
            if (memory[toolArgs.topic]) {
                delete memory[toolArgs.topic];
                fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
                return JSON.stringify({ success: `Memory '${toolArgs.topic}' has been permanently wiped.` });
            } else { return JSON.stringify({ error: `Could not find memory key '${toolArgs.topic}'.` }); }
        } catch (error) { return JSON.stringify({ error: "Failed to access memory disk." }); }
    }

    if (toolName === "sendEmail") {
        try {
            if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
                return JSON.stringify({ error: "Mail configurations missing from your system environmental variables." });
            }
            if (!fs.existsSync(TEMPLATE_FILE)) {
                return JSON.stringify({ error: "Local html blueprint template not discovered in file path storage." });
            }

            // 📂 READ TEMPLATE AND INJECT CONTENT
            let htmlLayout = fs.readFileSync(TEMPLATE_FILE, 'utf8');
            const cleanBodyHtml = toolArgs.body.split('\n').map(p => p.trim() ? `<p>${p.trim()}</p>` : '').join('');
            
            htmlLayout = htmlLayout
                .replace(/{{SUBJECT}}/g, toolArgs.subject)
                .replace(/{{BODY}}/g, cleanBodyHtml);

            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587', 10),
                secure: process.env.SMTP_PORT === '464', 
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            });

            await transporter.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: toolArgs.to,
                subject: toolArgs.subject,
                text: toolArgs.body, // Text backup parameter
                html: htmlLayout // Injected HTML Layout parameters
            });

            return JSON.stringify({ success: `Email layout successfully constructed and routed to destination inbox.` });
        } catch (error) {
            return JSON.stringify({ error: `SMTP server socket initialization fault: ${error.message}` });
        }
    }

    const targetName = (toolArgs.projectName || '').toLowerCase().replace(/\s+/g, '');
    const project = global.systemCache.projects.find(p => (p.name || p.id).toLowerCase().replace(/\s+/g, '') === targetName);
    
    if (!project) return JSON.stringify({ error: `Project '${toolArgs.projectName}' not found in the synced UI vault.` });

    if (toolName === "getProjectStatus") {
        return JSON.stringify({ name: project.name, liveUrl: project.liveUrl, vaultKeys: project.tabs || {}, status: "Found" });
    }

    if (toolName === "querySupabaseDatabase") {
        let supaUrl = ''; let anonKey = ''; let serviceKey = '';
        Object.values(project.tabs || {}).flat().forEach(v => {
            const k = (v.key || '').toUpperCase(); const val = (v.value || '').trim();
            if (val.includes('supabase.co')) supaUrl = val;
            if (val.startsWith('eyJ')) {
                if (k.includes('SERVICE') || k.includes('ROLE')) serviceKey = val;
                else if (k.includes('ANON')) anonKey = val;
                else if (!anonKey) anonKey = val; 
            }
        });

        const activeKey = serviceKey || anonKey;
        if (!supaUrl || !activeKey) return JSON.stringify({ error: "Missing Supabase URL or Key in the project's Rashboard vault." });

        const cleanSupaUrl = supaUrl.split('/rest/v1')[0].replace(/\/$/, '');
        const baseUrl = cleanSupaUrl + '/rest/v1/' + toolArgs.tableName;
        const limit = Math.min(toolArgs.limit || 5, 20);
        
        try {
            const headers = { 'apikey': activeKey, 'Authorization': `Bearer ${activeKey}`, 'Content-Type': 'application/json' };
            let fetchUrl = baseUrl;

            if (toolArgs.selectQuery === 'count') {
                headers['Prefer'] = 'count=exact'; fetchUrl += '?select=*&limit=1'; 
            } else {
                fetchUrl += `?select=${toolArgs.selectQuery || '*'}&limit=${limit}`;
            }

            const dbRes = await fetch(fetchUrl, { headers });
            
            if (!dbRes.ok) {
                let availableTables = [];
                try {
                    const schemaRes = await fetch(cleanSupaUrl + '/rest/v1/', { headers });
                    if (schemaRes.ok) {
                        const schemaData = await schemaRes.json();
                        availableTables = Object.keys(schemaData.paths || {})
                            .map(p => p.replace('/', '').split('?')[0])
                            .filter(n => n && n !== 'rpc' && n !== 'introspection');
                    }
                } catch(e) {}

                return JSON.stringify({ 
                    error: `The table '${toolArgs.tableName}' does not exist.`,
                    actualTablesInDatabase: availableTables.length > 0 ? availableTables : "Could not fetch table list.",
                    instruction: "Tell the user the table wasn't found, list the 'actualTablesInDatabase', and ask them to confirm which one they meant."
                });
            }

            if (toolArgs.selectQuery === 'count') {
                const range = dbRes.headers.get('content-range') || '0-0/0';
                return JSON.stringify({ tableName: toolArgs.tableName, totalRowCount: parseInt(range.split('/')[1] || 0, 10) });
            } else {
                const data = await dbRes.json();
                return JSON.stringify({ tableName: toolArgs.tableName, rowsReturned: data.length, data: data });
            }
        } catch (err) { return JSON.stringify({ error: "Failed to establish network connection to Database." }); }
    }
    return JSON.stringify({ error: "Unknown tool called." });
}

// --- 🧠 LOCAL API DRIVER ---
// A custom fetch wrapper that talks to llama.cpp instead of Groq
async function queryLocalModel(messages, useTools = true) {
    const payload = {
        model: "local-model",
        messages: messages,
        temperature: 0.1 // Keep it focused and logical
    };

    if (useTools) {
        payload.tools = tools;
        payload.tool_choice = "auto";
    }

    const res = await fetch(LOCAL_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Local Server Offline: ${res.statusText}`);
    const data = await res.json();
    return data.choices[0].message;
}

// --- 🧠 THE MAIN EXECUTION LOOP ---
async function runAgent(userPrompt) {
    let memoryData = {};
    try { memoryData = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch(e){}

    const activeMemoryContext = retrieveRelevantMemories(userPrompt, memoryData);
    const knownProjects = global.systemCache.projects.map(p => p.name || p.id).join(', ') || "No projects synced.";

    const systemPrompt = `You are the central AI agent managing a developer's Rashboard.
    
    CURRENTLY SYNCED PROJECTS: [${knownProjects}]
    
    ${activeMemoryContext}
    
    RULES:
    1. To fetch live data or count rows, use 'querySupabaseDatabase'.
    2. If you asked the user to clarify a table name and they say "Yes" or provide the name, IMMEDIATELY use 'querySupabaseDatabase' with the corrected table name.
    3. If asked to forget a memory, use 'removeFromMemory'.
    4. If asked to send an email, use 'sendEmail'. Generate plain text message statements only.
    5. CRITICAL: If the user tells you a new fact, mapping, or rule to 'keep in mind', ALWAYS execute the 'saveToMemory' tool.`;

    addMessage({ role: "user", content: userPrompt });

    const messages = [
        { role: "system", content: systemPrompt },
        ...getHistory()
    ];

    try {
        // 1. Send conversation to Local Llama 3.2
        let responseMessage = await queryLocalModel(messages, true);
        let finalOutput = responseMessage.content;
        
        // 2. Check if the local AI wants to use a tool
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            addMessage(responseMessage);
            messages.push(responseMessage);

            // Execute the tools locally
            for (const toolCall of responseMessage.tool_calls) {
                const functionResponse = await executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments));
                const toolMessage = { tool_call_id: toolCall.id, role: "tool", name: toolCall.function.name, content: functionResponse };
                addMessage(toolMessage);
                messages.push(toolMessage);
            }

            // 3. Send the tool results back to the AI for a final summary
            responseMessage = await queryLocalModel(messages, false);
            finalOutput = responseMessage.content;
        }

        if (finalOutput) addMessage({ role: "assistant", content: finalOutput });
        return finalOutput || "Task executed successfully.";
    } catch (error) {
        console.error("[AGENT ERROR]", error);
        return "System failure: Local AI engine offline or unreachable. Please ensure ./llama-server is running.";
    }
}

module.exports = { runAgent };
