// src/groqAgent.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- 🛠️ DYNAMIC TOOL SCHEMAS ---
// This function dynamically builds the tool list based on what is in the UI
function getDynamicTools() {
    // Extract just the names/IDs so the AI knows exactly what to call them
    const projectNames = global.systemCache.projects.map(p => p.name || p.id);
    const validOptions = projectNames.length > 0 ? projectNames.join(", ") : "No projects configured yet.";

    return [
        {
            type: "function",
            function: {
                name: "getProjectStatus",
                description: "Get the configuration and status of a tracked portfolio project.",
                parameters: {
                    type: "object",
                    properties: {
                        projectName: {
                            type: "string",
                            description: `The exact name of the project. Valid options: ${validOptions}`
                        }
                    },
                    required: ["projectName"]
                }
            }
        }
    ];
}

// --- ⚙️ LOCAL FUNCTIONS ---
function executeTool(toolName, toolArgs) {
    console.log(`[AGENT] Executing tool: ${toolName} with args:`, toolArgs);
    
    if (toolName === "getProjectStatus") {
        // Find the specific project dynamically from the memory cache
        const project = global.systemCache.projects.find(
            p => (p.name || p.id).toLowerCase() === toolArgs.projectName.toLowerCase()
        );

        if (project) {
            // Return basic telemetry for now (we will add Supabase DB fetching here next!)
            return JSON.stringify({ 
                name: project.name, 
                liveUrl: project.liveUrl,
                status: "Configured and tracked in vault."
            });
        } else {
            return JSON.stringify({ error: "Project not found in system tracker." });
        }
    }
    return JSON.stringify({ error: "Unknown tool called." });
}

// --- 🧠 THE MAIN EXECUTION LOOP ---
async function runAgent(userPrompt) {
    const messages = [
        { role: "system", content: "You are the central AI agent managing a developer's portfolio dashboard. Use the available tools to lookup project data." },
        { role: "user", content: userPrompt }
    ];

    try {
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: messages,
            tools: getDynamicTools(), // <-- NOW CALLING THE DYNAMIC FUNCTION
            tool_choice: "auto"
        });

        const responseMessage = response.choices[0].message;
        const toolCalls = responseMessage.tool_calls;
        
        if (toolCalls) {
            messages.push(responseMessage);
            for (const toolCall of toolCalls) {
                const functionResponse = executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments));
                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: toolCall.function.name,
                    content: functionResponse,
                });
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
