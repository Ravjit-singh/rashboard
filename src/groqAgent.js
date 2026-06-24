// src/groqAgent.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MEMORY_FILE = path.join(__dirname, '../memory.json');

// --- RAG: Initialize Permanent Memory ---
if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({
        system: "Rashboard AI Core initialized. Memory banks empty."
    }, null, 2));
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
            description: "Save an important fact, idea, or preference into long-term permanent memory.",
            parameters: {
                type: "object",
                properties: {
                    topic: { type: "string", description: "A short 1-3 word key (e.g., 'User Name', 'App Idea')" },
                    information: { type: "string", description: "The detailed information to remember permanently." }
                },
                required: ["topic", "information"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "querySupabaseDatabase",
            description: "Fetch live production data directly from a project's Supabase database. Use this to count rows or check recent records.",
            parameters: {
                type: "object",
                properties: {
                    projectName: { type: "string", description: "The exact name of the project." },
                    tableName: { type: "string", description: "The exact name of the database table (e.g., 'pros', 'users', 'profiles')." },
                    selectQuery: { type: "string", description: "Set to 'count' to get the total row count, or '*' to get actual row data." },
                    limit: { type: "number", description: "Max rows to fetch if pulling data. Default is 5. Max 20." }
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

    // Failsafe: Remove spaces and make lowercase so "Service Linkup" matches "ServiceLinkup"
    const targetName = (toolArgs.projectName || '').toLowerCase().replace(/\s+/g, '');
    const project = global.systemCache.projects.find(p => (p.name || p.id).toLowerCase().replace(/\s+/g, '') === targetName);
    
    if (!project) return JSON.stringify({ error: `Project '${toolArgs.projectName}' not found in the synced UI vault.` });

    if (toolName === "getProjectStatus") {
        return JSON.stringify({ name: project.name, liveUrl: project.liveUrl, vaultKeys: project.tabs || {}, status: "Found" });
    }

    // --- 🗄️ THE LIVE DATABASE QUERY ENGINE ---
    if (toolName === "querySupabaseDatabase") {
        let supaUrl = '';
        let anonKey = '';
        let serviceKey = '';
        
        Object.values(project.tabs || {}).flat().forEach(v => {
            const k = (v.key || '').toUpperCase();
            const val = (v.value || '').trim();
            if (val.includes('supabase.co')) supaUrl = val;
            if (val.startsWith('eyJ')) {
                if (k.includes('SERVICE') || k.includes('ROLE')) serviceKey = val;
                else if (k.includes('ANON')) anonKey = val;
                else if (!anonKey) anonKey = val; 
            }
        });

        const activeKey = serviceKey || anonKey;

        if (!supaUrl || !activeKey) {
            return JSON.stringify({ error: "Missing Supabase URL or Key in the project's Rashboard vault." });
        }

        const cleanSupaUrl = supaUrl.split('/rest/v1')[0].replace(/\/$/, '');
        const baseUrl = cleanSupaUrl + '/rest/v1/' + toolArgs.tableName;
        const limit = Math.min(toolArgs.limit || 5, 20);
        
        try {
            const headers = {
                'apikey': activeKey,
                'Authorization': `Bearer ${activeKey}`,
                'Content-Type': 'application/json'
            };

            let fetchUrl = baseUrl;

            if (toolArgs.selectQuery === 'count') {
                headers['Prefer'] = 'count=exact';
                fetchUrl += '?select=*&limit=1'; 
            } else {
                fetchUrl += `?select=${toolArgs.selectQuery || '*'}&limit=${limit}`;
            }

            const dbRes = await fetch(fetchUrl, { headers });
            
            // 🚨 THE AUTO-HEALING LOGIC 🚨
            if (!dbRes.ok) {
                let availableTables = [];
                try {
                    // If table fails, instantly fetch the real database schema
                    const schemaRes = await fetch(cleanSupaUrl + '/rest/v1/', { headers });
                    if (schemaRes.ok) {
                        const schemaData = await schemaRes.json();
                        // Strip out endpoints to just get clean table names
                        availableTables = Object.keys(schemaData.paths || {})
                            .map(p => p.replace('/', '').split('?')[0])
                            .filter(n => n && n !== 'rpc' && n !== 'introspection');
                    }
                } catch(e) {}

                // Send the actual tables back to the AI and command it to ask the user
                return JSON.stringify({ 
                    error: `The table '${toolArgs.tableName}' does not exist or access was denied.`,
                    actualTablesInDatabase: availableTables.length > 0 ? availableTables : "Could not fetch table list.",
                    instruction: "Politely tell the user the table wasn't found, list 2-3 of the most likely matching tables from 'actualTablesInDatabase', and ask them to confirm which one they meant."
                });
            }

            if (toolArgs.selectQuery === 'count') {
                const range = dbRes.headers.get('content-range') || '0-0/0';
                const totalCount = range.split('/')[1] || 0;
                return JSON.stringify({ tableName: toolArgs.tableName, totalRowCount: parseInt(totalCount, 10) });
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
    let memoryContext = "{}";
    try { memoryContext = fs.readFileSync(MEMORY_FILE, 'utf8'); } catch(e){}

    const knownProjects = global.systemCache.projects.map(p => p.name || p.id).join(', ') || "No projects synced.";

    const systemPrompt = `You are the central AI agent managing a developer's Rashboard.
    
    CURRENTLY SYNCED PROJECTS: [${knownProjects}]
    
    PERMANENT MEMORY BANKS:
    ${memoryContext}
    
    RULES:
    1. To fetch live data or count rows from a project's database, use querySupabaseDatabase.
    2. If a tool returns an error saying a table wasn't found but provides a list of 'actualTablesInDatabase', DO NOT SAY 'System Failure'. Instead, naturally ask the user: "I couldn't find the [X] table, but I do see [Y] and [Z]. Did you mean one of those?"
    3. Neatly summarize database data. Do NOT dump raw JSON to the user.`;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
    ];

    try {
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: messages,
            tools: tools,
            tool_choice: "auto"
        });

        const responseMessage = response.choices[0].message;
        
        if (responseMessage.tool_calls) {
            messages.push(responseMessage);
            for (const toolCall of responseMessage.tool_calls) {
                const functionResponse = await executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments));
                messages.push({ tool_call_id: toolCall.id, role: "tool", name: toolCall.function.name, content: functionResponse });
            }

            const finalResponse = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: messages
            });
            return finalResponse.choices[0].message.content;
        }

        return responseMessage.content;
    } catch (error) {
        console.error("[AGENT ERROR]", error);
        return "System failure: Agent could not process the request.";
    }
}

module.exports = { runAgent };
