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

// Static, bulletproof schemas prevent Groq parsing errors
const tools = [
    {
        type: "function",
        function: {
            name: "getProjectStatus",
            description: "Get the live URL and the secret environment vault keys (like Supabase DB keys) for a mapped project.",
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
    }
];

function executeTool(toolName, toolArgs) {
    console.log(`[AGENT] Executing tool: ${toolName} with args:`, toolArgs);
    
    if (toolName === "getProjectStatus") {
        const project = global.systemCache.projects.find(p => (p.name || p.id).toLowerCase() === toolArgs.projectName.toLowerCase());
        if (project) {
            return JSON.stringify({ name: project.name, liveUrl: project.liveUrl, vaultKeys: project.tabs || {}, status: "Found" });
        }
        return JSON.stringify({ error: `Project '${toolArgs.projectName}' not found in Node.js memory. Remind the user to map it in the UI.` });
    }
    
    if (toolName === "saveToMemory") {
        try {
            const memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
            memory[toolArgs.topic] = toolArgs.information;
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
            return JSON.stringify({ success: `Successfully memorized data under topic: ${toolArgs.topic}.` });
        } catch (error) {
            return JSON.stringify({ error: "Failed to write to memory disk." });
        }
    }

    return JSON.stringify({ error: "Unknown tool called." });
}

async function runAgent(userPrompt) {
    let memoryContext = "{}";
    try { memoryContext = fs.readFileSync(MEMORY_FILE, 'utf8'); } catch(e){}

    // Inject known projects directly into the prompt so the AI doesn't hallucinate tags
    const knownProjects = global.systemCache.projects.map(p => p.name || p.id).join(', ') || "No projects synced from UI yet.";

    const systemPrompt = `You are the central AI agent managing a developer's Rashboard.
    
    CURRENTLY SYNCED PROJECTS: [${knownProjects}]
    
    PERMANENT MEMORY BANKS:
    ${memoryContext}
    
    RULES:
    1. To read project URLs or DB keys, use getProjectStatus.
    2. To save facts, use saveToMemory.
    3. If the user asks about a project not in CURRENTLY SYNCED PROJECTS, tell them.
    4. CRITICAL: Never output raw <function> tags in your text. Only use the native tool API.`;

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
                const functionResponse = executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments));
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