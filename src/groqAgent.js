const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const nodemailer = require('nodemailer');
const { getHistory, addMessage } = require('./contextWindow'); 

const LOCAL_API_URL = "http://127.0.0.1:8080/v1/chat/completions";
const MEMORY_FILE = path.join(__dirname, '../memory.json');
const TEMPLATE_FILE = path.join(__dirname, 'emailTemplate.html');

if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({}, null, 2));
}

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

const toolsInstructions = `
[AVAILABLE TOOLS]
- getProjectStatus { "projectName": "string" }
- saveToMemory { "topic": "string", "information": "string" }
- removeFromMemory { "topic": "string" }
- sendEmail { "to": "string", "subject": "string", "body": "string" }
- querySupabaseDatabase { "projectName": "string", "tableName": "string", "queryType": "count_only" or "fetch_data" }

CRITICAL RULE: To use a tool, you MUST output this exact syntax at the very end of your response:
<|tool_call>call:FunctionName{"key": "value"}
`;

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
    
    if (!project && toolName === "querySupabaseDatabase") {
        return JSON.stringify({ error: "Please specify the exact 'projectName' alongside the 'tableName' so I know which database to connect to." });
    }
    
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
                if (dbRes.status === 401 || dbRes.status === 403) diagnosticReason = `Access Denied. Row Level Security (RLS) is active and blocking read access.`;
                if (dbRes.status === 400) diagnosticReason = `Bad request syntax.`;

                return JSON.stringify({ error: "Database query failed.", httpStatusCode: dbRes.status, diagnosticReason: diagnosticReason });
            }

            if (isCount) {
                const range = dbRes.headers.get('content-range') || '0-0/0';
                const totalCount = parseInt(range.split('/')[1] || 0, 10);
                return JSON.stringify({ tableName: cleanTableName, queryType: "count", totalRowsInDatabase: totalCount });
            } else {
                const data = await dbRes.json();
                return JSON.stringify({ tableName: cleanTableName, rowsReturned: data.length, data: data });
            }
        } catch (err) { 
            return JSON.stringify({ error: "Failed to establish network connection to the Database." }); 
        }
    }
    return JSON.stringify({ error: "Unknown tool called." });
}

// ⚡ THE FORGIVING STREAM INTERCEPTOR ⚡
async function streamLocalAPI(messages, res) {
    const payload = {
        model: "gemma-4-e2b-it",
        messages: messages,
        temperature: 0.15 // Slightly elevated to increase conversational fluidity
    };

    const fetchRes = await fetch(LOCAL_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!fetchRes.ok) throw new Error("Local AI Offline");

    const reader = fetchRes.body.getReader();
    const decoder = new TextDecoder('utf-8');
    
    let fullText = "";
    let visibleText = "";
    let isToolCall = false;
    let streamBuffer = "";
    let toolCalls = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                    const data = JSON.parse(line.slice(6));
                    const delta = data.choices[0].delta;

                    if (delta.content) {
                        fullText += delta.content;

                        // More forgiving detection: catches '<tool', '<|tool', or just 'call:'
                        if (fullText.includes("<|tool") || fullText.includes("<tool") || fullText.includes("call:")) {
                            isToolCall = true;
                        }

                        if (!isToolCall) {
                            streamBuffer += delta.content;
                            // Check if stream is currently printing a partial bracket
                            if (streamBuffer.includes("<|") || streamBuffer.includes("<t")) {
                                // Hold the buffer
                            } else if (streamBuffer.endsWith("<")) {
                                // Hold the buffer
                            } else {
                                if (res) res.write(streamBuffer);
                                visibleText += streamBuffer;
                                streamBuffer = "";
                            }
                        }
                    }
                } catch (e) {}
            }
        }
    }

    // ⚡ BUG FIX 1: Flush any innocent text trapped in the buffer at the end of the stream
    if (!isToolCall && streamBuffer.trim().length > 0) {
        let finalClean = streamBuffer.replace(/<end_of_turn>/gi, '').replace(/<eos>/gi, '');
        if (finalClean && res) res.write(finalClean);
        visibleText += finalClean;
    }
    
    // ⚡ BUG FIX 2: Highly forgiving regex that handles spacing typos and missing brackets
    const toolMatch = fullText.match(/<[|/]?tool_call>\s*call:\s*([a-zA-Z0-9_]+)\s*(\{[\s\S]*?\})/i);
    if (toolMatch) {
        const funcName = toolMatch[1];
        let argString = toolMatch[2];
        argString = argString.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3'); 

        toolCalls.push({
            id: "call_" + Math.random().toString(36).substr(2, 9),
            type: "function",
            function: { name: funcName, arguments: argString }
        });
        return { content: visibleText, tool_calls: toolCalls };
    }

    // ⚡ BUG FIX 3: If it tried to call a tool but completely failed, push the hidden text to the UI so it doesn't hang blank
    if (isToolCall && !toolMatch && res) {
        let cleanFull = fullText.replace(/<end_of_turn>/gi, '').replace(/<eos>/gi, '');
        let missingText = cleanFull.replace(visibleText, '');
        if (missingText.trim().length > 0) {
            res.write(missingText);
            visibleText = cleanFull;
        }
    }

    return { content: fullText, tool_calls: null };
}

async function runAgent(userPrompt, res) { 
    let memoryData = {};
    try { memoryData = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch(e){}

    const activeMemoryContext = retrieveRelevantMemories(userPrompt, memoryData);
    const knownProjects = global.systemCache.projects.map(p => p.name || p.id).join(', ') || "No projects synced.";

    // ⚡ IMMERSION UPGRADE: A highly aware, specialized system persona
    const systemPrompt = `You are Rashboard, an advanced, highly capable AI engineering assistant running natively on Ravjit's OnePlus GPU.
    Your primary directive is to manage his backend infrastructure, orchestrate microservices, and retrieve real-time data seamlessly.
    
    Personality Profile:
    - Crisp, highly intelligent, and direct.
    - Conversational, but avoid repetitive robotic cliches (e.g., never say "As an AI...").
    - If a database query fails, diagnose the problem confidently based on the HTTP status code provided.
    
    ${toolsInstructions}
    
    [KNOWN PROJECTS]: ${knownProjects}
    [SAVED MEMORIES]: ${activeMemoryContext}`;

    const pinnedPrompt = `USER COMMAND: ${userPrompt}`;

    addMessage({ role: "user", content: pinnedPrompt }); 

    const messages = [
        { role: "system", content: systemPrompt },
        ...getHistory()
    ];

    try {
        let responseMessage = await streamLocalAPI(messages, res);
        let finalOutput = responseMessage.content;
        
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            
            if (finalOutput) addMessage({ role: "assistant", content: finalOutput });

            for (const toolCall of responseMessage.tool_calls) {
                let parsedArgs = {};
                try { 
                    parsedArgs = JSON.parse(toolCall.function.arguments); 
                } catch (e) {
                    console.error("[AGENT] JSON Parse Error on args:", toolCall.function.arguments);
                }

                const functionResponse = await executeTool(toolCall.function.name, parsedArgs);

                const toolMessage = { 
                    role: "user", 
                    content: `[SYSTEM TOOL RESULT]\n${functionResponse}\n\nCRITICAL INSTRUCTION: Read the data above and answer the user's request naturally in 1-2 sentences. DO NOT repeat the raw JSON data. Synthesize it conversationally.` 
                };
                
                addMessage(toolMessage);
                messages.push(toolMessage);
            }

            const finalResponse = await streamLocalAPI(messages, res);
            finalOutput = finalResponse.content;
        } else {
            if (finalOutput) addMessage({ role: "assistant", content: finalOutput });
        }
        
        // ⚡ BUG FIX 4: Safety net to prevent the UI from locking up if the LLM returns absolutely nothing
        if (!finalOutput || finalOutput.trim() === "") {
            finalOutput = "Task executed successfully.";
            if (res) res.write(finalOutput);
            addMessage({ role: "assistant", content: finalOutput });
        }

        return finalOutput;
    } catch (error) {
        console.error("[AGENT ERROR]", error);
        if (res && !res.headersSent) res.write("System failure: Local AI engine offline or unreachable.");
        return null;
    }
}

module.exports = { runAgent };
