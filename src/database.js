// src/database.js
const fs = require('fs');
const path = require('path');

const CHAT_FILE = path.join(__dirname, '../chats.json');

// Boot up: Create the file if it doesn't exist
if (!fs.existsSync(CHAT_FILE)) {
    fs.writeFileSync(CHAT_FILE, JSON.stringify([]));
}

function loadChats() {
    try {
        return JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

function saveChats(chatArray) {
    try {
        fs.writeFileSync(CHAT_FILE, JSON.stringify(chatArray, null, 2));
    } catch (e) {
        console.error("[DB ERROR] Failed to save chat history.");
    }
}

module.exports = { loadChats, saveChats };
