const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const nodemailer = require('nodemailer');
const { getHistory, addMessage } = require('./contextWindow'); 

const MEMORY_FILE = path.join(__dirname, '../memory.json');
const TEMPLATE_FILE = path.join(__dirname, 'emailTemplate.html');

if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({}, null, 2));
}

function retrieveRelevantMemories(prompt, memoryObj) {
    const stopWords = new Set(['the','is','in','at','of','on','and','a','an','to','for','with','it','this','that','tell','me','about','how','many','are','there']);
    const words = prompt.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    const keywords = words.filter(w => w.length > 2 && !stopWords.has(w));

    if (keywords.length === 0) return "No active memories triggered.";
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

    if (scoredMemories.length === 0) return "No active memories triggered.";
    scoredMemories.sort((a, b) => b.score - a.score);
    const topMemories = scoredMemories.slice(0, 3);

    let contextString = "";
    topMemories.forEach(m => { contextString += `- [${m.topic}]: ${m.info}\n`; });
    return contextString;
}

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
            if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return JSON.stringify({ error: "Mail configurations missing." });
            if (!fs.existsSync(TEMPLATE_FILE)) return JSON.stringify({ error: "Local HTML template missing." });

            let htmlLayout = fs.readFileSync(TEMPLATE_FILE, 'utf8');
            const cleanBodyHtml = toolArgs.body.split('\n').map(p => p.trim() ? `<p>${p.trim()}</p>` : '').join('');
            
            htmlLayout = htmlLayout.replace(/{{SUBJECT}}/g, toolArgs.subject).replace(/{{BODY}}/g, cleanBodyHtml);

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
                text: toolArgs.body, 
                html: htmlLayout 
            });

            return JSON.stringify({ success: `Email successfully sent.` });
        } catch (error) { return JSON.stringify({ error: `SMTP fault: ${error.message}` }); }
    }

    const targetName = (toolArgs.projectName || '').toLowerCase().replace(/\s+/g, '');
    const project = global.systemCache.projects.find(p => (p.name || p.id).toLowerCase().replace(/\s+/g, '') === targetName);
    
    if (!project && toolName === "querySupabaseDatabase") return JSON.stringify({ error: "Specify the exact 'projectName'." });
    if (!project) return JSON.stringify({ error: `Project not found in the synced UI vault.` });

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
        if (!supaUrl || !activeKey) return JSON.stringify({ error: "Missing Supabase URL or Authentication Key in the vault." });

        const cleanTableName = (toolArgs.tableName || '').replace(/[^a-zA-Z0-9_]/g, '');
        const cleanSupaUrl = supaUrl.split('/rest/v1')[0].replace(/\/$/, '');
        const baseUrl = cleanSupaUrl + '/rest/v1/' + cleanTableName;
        const isCount = toolArgs.queryType === 'count_only' || toolArgs.queryType === 'count';
        
        try {
            const headers = { 'apikey': activeKey, 'Authorization': `Bearer ${activeKey}` };
            let dbRes;

            if (isCount) {
                headers['Prefer'] = 'count=exact';
                dbRes = await fetch(baseUrl + '?select=*', { method: 'HEAD', headers });
            } else {
                headers['Content-Type'] = 'application/json';
                dbRes = await fetch(baseUrl + '?select=*&limit=10', { method: 'GET', headers });
            }
            
            if (!dbRes.ok) {
                let diagnosticReason = "Unknown network error.";
                if (dbRes.status === 404) diagnosticReason = `The table '${cleanTableName}' does not exist in this database.`;
                if (dbRes.status === 401 || dbRes.status === 403) diagnosticReason = `Access Denied. Row Level Security (RLS) is active.`;
                return JSON.stringify({ error: "Database query failed.", httpStatusCode: dbRes.status, diagnosticReason: diagnosticReason });
            }

            if (isCount) {
                const range = dbRes.headers.get('content-range') || '0-0/0';
                return JSON.stringify({ tableName: cleanTableName, queryType: "count", totalRowsInDatabase: parseInt(range.split('/')[1] || 0, 10) });
            } else {
                const data = await dbRes.json();
                return JSON.stringify({ tableName: cleanTableName, rowsReturned: data.length, data: data });
            }
        } catch (err) { return JSON.stringify({ error: "Failed to establish network connection." }); }
    }
    return JSON.stringify({ error: "Unknown tool called." });
}

// 🌐 THE UNIFIED AGENT ENGINE 
async function streamAPI(messages, res) {
    const mode = (process.env.AI_MODE || "local").trim().toLowerCase();
    const isGroq = mode === "groq";

    const endpoint = isGroq 
        ? "https://api.groq.com/openai/v1/chat/completions" 
        : (process.env.LOCAL_API_URL || "http://127.0.0.1:8080/v1/chat/completions");
        
    const modelTarget = isGroq 
        ? (process.env.GROQ_MODEL || "llama-3.1-8b-instant") 
        : (process.env.LOCAL_MODEL || "gemma-4-e2b-it");

    const headers = { "Content-Type": "application/json" };
    if (isGroq) {
        if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY missing in .env");
        headers["Authorization"] = `Bearer ${process.env.GROQ_API_KEY}`;
    }

    const payload = {
        model: modelTarget,
        messages: messages,
        temperature: 0.2,
        stream: true
    };

    const fetchRes = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
    });

    if (!fetchRes.ok) {
        const errText = await fetchRes.text();
        throw new Error(`AI Engine Offline [${fetchRes.status}]: ${errText}`);
    }

    const reader = fetchRes.body.getReader();
    const decoder = new TextDecoder('utf-8');
    
    let fullText = "";
    let visibleText = "";
    let toolCalls = [];
    
    // 🛡️ ACCENT ARMOR: Added fallback grouping to instantly catch formatting mutations like <|tool_call|>
    let toolRegex;
    let toolMatchRegex;
    
    if (isGroq) {
        toolRegex = /<[|/]?tool_call\|?>?|(getProjectStatus|saveToMemory|removeFromMemory|sendEmail|querySupabaseDatabase)/i;
        toolMatchRegex = /(?:<[|/]?tool_call\|?>?\s*)?(getProjectStatus|saveToMemory|removeFromMemory|sendEmail|querySupabaseDatabase)\s*(\{[\s\S]*?\})/i;
    } else {
        toolRegex = /<[|/]?tool_call\|?>?|call:(getProjectStatus|saveToMemory|removeFromMemory|sendEmail|querySupabaseDatabase)/i;
        toolMatchRegex = /(?:<[|/]?tool_call\|?>?\s*)?call:([a-zA-Z0-9_]+)\s*(\{[\s\S]*?\})/i;
    }

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.choices[0].delta.content) {
                        fullText += data.choices[0].delta.content;
                        const toolStartIndex = fullText.search(toolRegex);
                        
                        if (toolStartIndex === -1) {
                            if (!fullText.endsWith("<") && !fullText.endsWith("<|") && !fullText.endsWith("call:")) {
                                const newText = fullText.substring(visibleText.length);
                                let cleanText = newText.replace(/<end_of_turn>/gi, '').replace(/<eos>/gi, '');
                                if (cleanText.length > 0 && res) {
                                    res.write(cleanText);
                                    visibleText += cleanText; 
                                }
                            }
                        } else {
                            const safeText = fullText.substring(0, toolStartIndex);
                            const newText = safeText.substring(visibleText.length);
                            let cleanText = newText.replace(/<end_of_turn>/gi, '').replace(/<eos>/gi, '');
                            if (cleanText.length > 0 && res) {
                                res.write(cleanText);
                                visibleText += cleanText;
                            }
                        }
                    }
                } catch (e) {}
            }
        }
    }
    
    const toolMatch = fullText.match(toolMatchRegex);
    if (toolMatch) {
        const funcName = toolMatch[1];
        let argString = toolMatch[2].replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3'); 

        toolCalls.push({
            id: "call_" + Math.random().toString(36).substr(2, 9),
            type: "function",
            function: { name: funcName, arguments: argString }
        });
        return { content: visibleText, tool_calls: toolCalls };
    }

    // 🧼 AUTOMATED FALLBACK SCRUBBER: If the cloud model leaks syntax fragments without outputting actual executable JSON,
    // we scrub the ugly internal tags completely so it returns a clean conversational block to the user.
    let scrubbedText = fullText
        .replace(/<[|/]?tool_call\|?>?/gi, '')
        .replace(/call:/gi, '')
        .replace(/^(getProjectStatus|saveToMemory|removeFromMemory|sendEmail|querySupabaseDatabase)/i, '')
        .trim();

    if (visibleText === "" && scrubbedText.length > 0) {
        if (res) res.write(scrubbedText);
        visibleText = scrubbedText;
    }

    return { content: visibleText, tool_calls: null };
}

async function runAgent(userPrompt, res) { 
    let memoryData = {};
    try { memoryData = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch(e){}

    const activeMemoryContext = retrieveRelevantMemories(userPrompt, memoryData);
    const knownProjects = global.systemCache.projects.map(p => p.name || p.id).join(', ') || "No projects synced.";
    
    const mode = (process.env.AI_MODE || "local").trim().toLowerCase();
    const isGroq = mode === "groq";

    let toolsInstructions = `[AVAILABLE TOOLS]
- getProjectStatus { "projectName": "string" }
- saveToMemory { "topic": "string", "information": "string" }
- removeFromMemory { "topic": "string" }
- sendEmail { "to": "string", "subject": "string", "body": "string" }
- querySupabaseDatabase { "projectName": "string", "tableName": "string", "queryType": "count_only" or "fetch_data" }

TOOL USAGE STRICT RULE:
If you need to invoke a tool, your ENTIRE response must consist ONLY of the exact tool syntax. Do not narrate your actions. `;

    if (isGroq) {
        toolsInstructions += `Just output exactly:\n<|tool_call>FunctionName{"key": "value"}`;
    } else {
        toolsInstructions += `Just output exactly:\n<|tool_call>call:FunctionName{"key": "value"}`;
    }

    const systemPrompt = `You are Rashboard, an elite AI engineering assistant natively integrated into this environment.
    Your directive is to seamlessly manage backend infrastructure, deployments, and data.

    CRITICAL RULES OF ENGAGEMENT:
    1. NEVER narrate your internal processes. 
    2. NEVER read your internal context, known projects, or saved memories out loud. Use that data silently to inform your answers.
    3. Speak concisely, confidently, and naturally. Do not act like a generic robot.

    ${toolsInstructions}

    [CLASSIFIED INTERNAL CONTEXT - DO NOT READ OUT LOUD]
    Projects Available: ${knownProjects}
    Memory Bank Intel:
    ${activeMemoryContext}`;

    addMessage({ role: "user", content: userPrompt }); 

    const messages = [
        { role: "system", content: systemPrompt },
        ...getHistory()
    ];

    try {
        let responseMessage = await streamAPI(messages, res);
        
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            
            messages.push({ role: "assistant", content: responseMessage.content });

            for (const toolCall of responseMessage.tool_calls) {
                let parsedArgs = {};
                try { parsedArgs = JSON.parse(toolCall.function.arguments); } catch (e) {}

                const functionResponse = await executeTool(toolCall.function.name, parsedArgs);

                messages.push({ 
                    role: "user", 
                    content: `[SYSTEM COMMAND: TOOL EXECUTION COMPLETE]\nResult Data: ${functionResponse}\n\nTask: Deliver this final information to the user in a smooth, conversational manner. Do not repeat the raw data, and do not mention that you used a tool.` 
                });
            }

            const finalResponse = await streamAPI(messages, res);
            const totalCleanResponse = (responseMessage.content + " " + finalResponse.content).trim();
            
            if (totalCleanResponse) {
                addMessage({ role: "assistant", content: totalCleanResponse });
            } else {
                const fallback = "Process finished successfully.";
                if (res) res.write(fallback);
                addMessage({ role: "assistant", content: fallback });
            }
            
            return totalCleanResponse;

        } else {
            if (responseMessage.content) {
                addMessage({ role: "assistant", content: responseMessage.content });
            }
            return responseMessage.content;
        }
    } catch (error) {
        console.error("[AGENT ERROR]", error);
        if (res && !res.headersSent) res.write("System failure: AI engine offline. Please check your .env configuration and ensure the server is running.");
        return null;
    }
}

module.exports = { runAgent };
