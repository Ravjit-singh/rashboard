// src/contextWindow.js

let chatHistory = [];
const MAX_HISTORY_MESSAGES = 15; // Holds about 5-7 full back-and-forth interactions

function getHistory() {
    return chatHistory;
}

function addMessage(message) {
    chatHistory.push(message);

    // SMART TRIMMING: Prevent context amnesia and API crashes.
    // We only trim if we exceed the max length, AND we ensure we never 
    // split an "assistant (tool_call)" from its "tool (response)".
    if (chatHistory.length > MAX_HISTORY_MESSAGES) {
        let sliceIndex = chatHistory.length - MAX_HISTORY_MESSAGES;
        
        // Advance the slice index until we find a fresh "user" message.
        // This guarantees we don't accidentally cut a tool execution sequence in half.
        while (sliceIndex < chatHistory.length && chatHistory[sliceIndex].role !== 'user') {
            sliceIndex++;
        }
        
        chatHistory = chatHistory.slice(sliceIndex);
    }
}

function clearHistory() {
    chatHistory = [];
}

module.exports = {
    getHistory,
    addMessage,
    clearHistory
};
