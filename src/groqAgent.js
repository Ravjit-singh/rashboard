// src/groqAgent.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const Groq = require('groq-sdk');
const { getHistory, addMessage } = require('./contextWindow'); 

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MEMORY_FILE = path.join(__dirname, '../memory.json');

// --- RAG 1.0: Initialize Storage ---
if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({}, null, 2));
}

// --- 🧠 LIGHTWEIGHT RAG ENGINE (Zero-Dependency) ---
function retrieveRelevantMemories(prompt, memoryObj) {
    // 1. Filter out useless words to find the core intent
    const stopWords = new Set(['the','is','in','at','of','on','and','a','an','to','for','with','it','this','that','tell','me','about','how','many','are','there']);
    const words = prompt.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    const keywords = words.filter(w => w.length > 2 && !stopWords.has(w));

    if (keywords.length === 0) return "Memory banks ready."; // No strong keywords detected

    let scoredMemories = [];

    // 2. Scan every memory and calculate a Relevance Score
    for (const [topic, info] of Object.entries(memoryObj)) {
        if (topic === 'system') continue; 
        
        let score = 0;
        const combinedText = (topic + " " + info).toLowerCase();

        keywords.forEach(kw => {
            const regex = new RegExp(kw, 'g');
            const matches = combinedText.match(regex);
            if (matches) {
                score += matches.length; // 1 point per word match
                if (topic.toLowerCase().includes(kw)) score += 3; // +3 Bonus if the word is in the Title
            }
        });

        if (score > 0) {
            scoredMemories.push({ topic, info, score });
        }
    }

    if (scoredMemories.length === 0) return "No highly relevant memories found for this specific query.";

    // 3. Sort by highest score and grab ONLY the top 3
    scoredMemories.sort((a, b) => b.score - a.score);
    const topMemories = scoredMemories.slice(0, 3);

    // 4. Format into a clean string for the LLM
    let contextString = "RELEVANT MEMORIES RETAINED FOR THIS TASK:\n";
    topMemories.forEach(m => {
        contextString += `- [${m.topic}]: ${m.info}\n`;
    });

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
                properties: {
                    projectName: { type: "string", description: "The exact name of the project." }
                },
                required: ["projectName"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "saveToMemory",
            description: "Use ONLY when the user EXPLICITLY commands you to 'remember', 'save', or 'memorize' something.",
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
    console.log(`[AGENT] Executing tool: ${toolName} with args:`, toolArgs);
    
    if (toolName === "saveToMemory") {
        try {
            const memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
            memory[toolArgs.topic] = toolArgs.information;
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
            return JSON.stringify({ success: `Memorized under topic: ${toolArgs.topic}.` });
        } catch (error) {
            return JSON.stringify({ error: "Failed to write to memory disk." });
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
            
            // Auto-Healing Logic
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
        } catch (err) {
            return JSON.stringify({ error: "Failed to establish network connection to Database." });
        }
    }
    return JSON.stringify({ error: "Unknown tool called." });
}

// --- 🧠 THE MAIN EXECUTION LOOP ---
async function runAgent(userPrompt) {
    let memoryData = {};
    try { memoryData = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch(e){}

    // 🚀 EXECUTE TRUE RAG RETRIEVAL
    const activeMemoryContext = retrieveRelevantMemories(userPrompt, memoryData);

    const knownProjects = global.systemCache.projects.map(p => p.name || p.id).join(', ') || "No projects synced.";

    const systemPrompt = `You are the central AI agent managing a developer's Rashboard.
    
    CURRENTLY SYNCED PROJECTS: [${knownProjects}]
    
    ${activeMemoryContext}
    
    RULES:
    1. To fetch live data or count rows, use 'querySupabaseDatabase'.
    2. If you asked the user to clarify a table name and they say "Yes" or provide the name, IMMEDIATELY use 'querySupabaseDatabase' with the corrected table name.
    3. Neatly summarize database data. Do NOT dump raw JSON to the user.`;

    // 1. ADD USER MESSAGE TO CONTEXT WINDOW
    addMessage({ role: "user", content: userPrompt });

    // 2. BUILD API MESSAGES (System Prompt + Full Context Window)
    const messages = [
        { role: "system", content: systemPrompt },
        ...getHistory()
    ];

    try {
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: messages,
            tools: tools,
            tool_choice: "auto"
        });

        let responseMessage = response.choices[0].message;
        let finalOutput = responseMessage.content;
        
        // If the AI decides to use a tool
        if (responseMessage.tool_calls) {
            addMessage(responseMessage);
            messages.push(responseMessage);

            for (const toolCall of responseMessage.tool_calls) {
                const functionResponse = await executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments));
                
                const toolMessage = { tool_call_id: toolCall.id, role: "tool", name: toolCall.function.name, content: functionResponse };
                addMessage(toolMessage);
                messages.push(toolMessage);
            }

            const finalResponse = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: messages
            });
            
            responseMessage = finalResponse.choices[0].message;
            finalOutput = responseMessage.content;
        }

        // Record final human answer in the context window
        if (finalOutput) {
            addMessage({ role: "assistant", content: finalOutput });
        }
        
        return finalOutput;

    } catch (error) {
        console.error("[AGENT ERROR]", error);
        return "System failure: Agent could not process the request.";
    }
}

module.exports = { runAgent };
