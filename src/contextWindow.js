// src/contextWindow.js
const { loadChats, saveChats } = require('./database');

// Load history from the hard drive on server boot
let chatHistory = loadChats();
const MAX_HISTORY_MESSAGES = 20; // Keeps the last ~7 interactions

function getHistory() {
    return chatHistory;
}

function addMessage(message) {
    chatHistory.push(message);

    // SMART TRIMMING: Prevent context amnesia and API crashes
    if (chatHistory.length > MAX_HISTORY_MESSAGES) {
        let sliceIndex = chatHistory.length - MAX_HISTORY_MESSAGES;
        // Never split an "assistant (tool_call)" from its "tool (response)"
        while (sliceIndex < chatHistory.length && chatHistory[sliceIndex].role !== 'user') {
            sliceIndex++;
        }
        chatHistory = chatHistory.slice(sliceIndex);
    }
    
    // Save to hard drive
    saveChats(chatHistory);
}

function clearHistory() {
    chatHistory = [];
    saveChats(chatHistory);
}

module.exports = { getHistory, addMessage, clearHistory };
