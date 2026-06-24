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
            name: "listSupabaseTables",
            description: "ALWAYS run this FIRST to see exactly what tables exist in the database before querying.",
            parameters: {
                type: "object",
                properties: {
                    projectName: { type: "string", description: "The exact name of the project to pull credentials for." }
                },
                required: ["projectName"]
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
                    tableName: { type: "string", description: "The exact name of the database table." },
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
    
    if (toolName === "getProjectStatus") {
        const project = global.systemCache.projects.find(p => (p.name || p.id).toLowerCase() === toolArgs.projectName.toLowerCase());
        if (project) return JSON.stringify({ name: project.name, liveUrl: project.liveUrl, vaultKeys: project.tabs || {}, status: "Found" });
        return JSON.stringify({ error: `Project '${toolArgs.projectName}' not found in memory.` });
    }
    
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

    // --- 🗄️ THE LIVE DATABASE QUERY ENGINE ---
    if (toolName === "listSupabaseTables" || toolName === "querySupabaseDatabase") {
        const project = global.systemCache.projects.find(p => (p.name || p.id).toLowerCase() === toolArgs.projectName.toLowerCase());
        if (!project) return JSON.stringify({ error: "Project not found in UI vault." });

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

        // Failsafe: Removes /rest/v1/ if you accidentally pasted it in the UI
        const cleanSupaUrl = supaUrl.split('/rest/v1')[0].replace(/\/$/, '');

        const headers = {
            'apikey': activeKey,
            'Authorization': `Bearer ${activeKey}`,
            'Content-Type': 'application/json'
        };

        // NEW: Fetch all available tables via OpenAPI spec
        if (toolName === "listSupabaseTables") {
            try {
                const dbRes = await fetch(cleanSupaUrl + '/rest/v1/', { headers });
                if (!dbRes.ok) return JSON.stringify({ error: "Failed to connect to database schema." });
                const data = await dbRes.json();
                
                const tables = Object.keys(data.paths || {})
                    .map(path => path.replace('/', ''))
                    .filter(name => name !== 'rpc' && name !== 'introspection');
                
                return JSON.stringify({ availableTables: tables });
            } catch (err) {
                return JSON.stringify({ error: "Network error listing tables." });
            }
        }

        // Execute specific table query
        if (toolName === "querySupabaseDatabase") {
            const baseUrl = cleanSupaUrl + '/rest/v1/' + toolArgs.tableName;
            const limit = Math.min(toolArgs.limit || 5, 20);
            
            try {
                let fetchUrl = baseUrl;

                if (toolArgs.selectQuery === 'count') {
                    headers['Prefer'] = 'count=exact';
                    fetchUrl += '?select=*&limit=1'; 
                } else {
                    fetchUrl += `?select=${toolArgs.selectQuery || '*'}&limit=${limit}`;
                }

                const dbRes = await fetch(fetchUrl, { headers });
                
                if (!dbRes.ok) {
                    const errText = await dbRes.text();
                    return JSON.stringify({ error: `Database rejection: ${dbRes.statusText}`, details: errText });
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
    1. To read project URLs or DB keys, use getProjectStatus.
    2. To save facts, use saveToMemory.
    3. ALWAYS use listSupabaseTables FIRST to find the correct table name before using querySupabaseDatabase. Do not guess table names.
    4. To fetch live data or count rows, use querySupabaseDatabase using the EXACT table name you found. 
    5. If querying a database, neatly summarize the data. Do NOT dump raw JSON to the user.
    6. CRITICAL: Never output raw <function> tags. Only use the native tool API.`;

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
        const toolCalls = responseMessage.tool_calls;
        
        if (toolCalls) {
            messages.push(responseMessage);
            for (const toolCall of toolCalls) {
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
