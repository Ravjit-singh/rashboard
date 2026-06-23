// Import the agent at the top of the file (under the other requires)
const { runAgent } = require('./groqAgent');

// ... (existing code) ...

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
