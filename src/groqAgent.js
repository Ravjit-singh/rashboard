// src/groqAgent.js
const Groq = require('groq-sdk');
const projects = require('../projects.config');

// Initialize Groq client
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// --- 🛠️ TOOL SCHEMAS ---
// This JSON tells the AI what tools it has hands to use.
const tools = [
    {
        type: "function",
        function: {
            name: "getProjectStatus",
            description: "Get the current health and status of a tracked portfolio project.",
            parameters: {
                type: "object",
                properties: {
                    projectId: {
                        type: "string",
                        description: `The unique ID of the project. Valid options: ${projects.map(p => p.id).join(", ")}`
                    }
                },
                required: ["projectId"]
            }
        }
    }
];

// --- ⚙️ LOCAL FUNCTIONS ---
// The actual Node.js code that runs when the AI asks to use a tool.
function executeTool(toolName, toolArgs) {
    console.log(`[AGENT] Executing tool: ${toolName} with args:`, toolArgs);
    
    if (toolName === "getProjectStatus") {
        // Read instantly from the memory cache we built in server.js
        const status = global.systemCache.projectStatus[toolArgs.projectId];
        if (status) {
            return JSON.stringify({ id: toolArgs.projectId, status: status });
        } else {
            return JSON.stringify({ error: "Project ID not found in system tracker." });
        }
    }
    
    return JSON.stringify({ error: "Unknown tool called." });
}

// --- 🧠 THE MAIN EXECUTION LOOP ---
async function runAgent(userPrompt) {
    const messages = [
        { role: "system", content: "You are the central AI agent managing a developer's portfolio dashboard called Rashboard. Be concise and precise." },
        { role: "user", content: userPrompt }
    ];

    try {
        // Step 1: Send the user message and tools to Groq
        const response = await groq.chat.completions.create({
            model: "llama-3.1-70b-versatile", // Fast, powerful open-source model
            messages: messages,
            tools: tools,
            tool_choice: "auto"
        });

        const responseMessage = response.choices[0].message;

        // Step 2: Check if the AI wants to use a tool
        const toolCalls = responseMessage.tool_calls;
        
        if (toolCalls) {
            // Add the AI's tool request to the conversation history
            messages.push(responseMessage);

            // Loop through the tools the AI wants to execute
            for (const toolCall of toolCalls) {
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);
                
                // Run the local code
                const functionResponse = executeTool(functionName, functionArgs);

                // Add the raw data back to the conversation
                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: functionName,
                    content: functionResponse,
                });
            }

            // Step 3: Let the AI formulate the final answer using the new data
            const finalResponse = await groq.chat.completions.create({
                model: "llama-3.1-70b-versatile",
                messages: messages
            });

            return finalResponse.choices[0].message.content;
        }

        // If no tools were needed, return the direct response
        return responseMessage.content;

    } catch (error) {
        console.error("[AGENT ERROR]", error);
        return "System failure: Agent could not process the request.";
    }
}

module.exports = { runAgent };
