# Rashboard: Agentic AI Environment Monitor

Rashboard is a localized, fully autonomous Agentic AI dashboard designed to monitor, manage, and interact with your entire software development environment. Operating as a unified bridge between your frontend interfaces, backend databases, and deployment environments, Rashboard acts as an intelligent assistant capable of executing complex infrastructure tasks through natural language.

Built with a highly flexible architecture, Rashboard allows developers to seamlessly toggle the system's "brain" between blazing-fast cloud APIs and completely offline, on-device local models. 

## Table of Contents
1. [Core Architecture & Engine Design](#core-architecture--engine-design)
2. [Built-In Tool Arsenal](#built-in-tool-arsenal)
3. [System Requirements](#system-requirements)
4. [Universal Installation Guide](#universal-installation-guide)
5. [Environment Configuration (The Switch)](#environment-configuration-the-switch)
6. [The Mobile-First LiteRT APK Integration](#the-mobile-first-litert-apk-integration)
7. [Security & Best Practices](#security--best-practices)
8. [Roadmap & Future Development](#roadmap--future-development)

---

## Core Architecture & Engine Design

Rashboard is not a simple chatbot; it is a tool-calling execution environment. The backend is engineered using Node.js and relies on a series of advanced routing and parsing mechanics to ensure stability across any hardware.

* **Dynamic Model Routing:** The central `agentEngine.js` file dynamically reads environment variables at runtime. This allows the system to instantly format its system prompts, headers, and payloads to match the specific requirements of either cloud APIs (like Groq, OpenAI, or DeepSeek) or local endpoints (like Ollama or LiteRT).
* **The Dynamic Buffer Shield:** When an AI model decides to call a system tool, it outputs specific syntax (e.g., `<|tool_call|>`). Rashboard implements a sub-millisecond streaming buffer that inspects incoming data chunks in real-time. If it detects an impending tool call, it instantly locks the UI stream, preventing internal syntax tags from leaking to the frontend while the background task executes.
* **Context Persistence:** Rashboard maintains a localized JSON-based memory disk (`memory.json`). The agent can intelligently save, recall, and delete operational context between sessions, allowing it to remember specific project paths, deployment URLs, or API keys without requiring repeated prompts.

---

## Built-In Tool Arsenal

The agent comes pre-configured with a suite of native tools that it can invoke autonomously based on user requests.

* **Project Status Mapping (`getProjectStatus`):** Scans the global system cache synced from the UI to retrieve live URLs, repository branches, and active database keys for any loaded project.
* **Persistent Memory Management (`saveToMemory` / `removeFromMemory`):** Writes or erases targeted contextual data directly to the local disk. The agent uses keyword extraction to pull relevant memories into its active context window for future queries.
* **SMTP Email Dispatch (`sendEmail`):** Connects to a local HTML template engine and utilizes Nodemailer to compile and send formatted status reports, code snippets, or alert metrics to external stakeholders via a secure TCP socket.
* **Supabase Database Querying (`querySupabaseDatabase`):** Directly interfaces with Supabase REST APIs using project-specific Anon/Service keys found in the system cache. It respects Row Level Security (RLS) and can perform exact row counts or fetch specific data payloads directly into the chat interface.

---

## System Requirements

Rashboard is hardware-agnostic and designed to run on heavy desktop rigs or constrained mobile environments.

**For Desktop (Windows / macOS / Linux):**
* Node.js (v18.0.0 or higher)
* Git
* (Optional) Ollama installed locally for offline inference.

**For Mobile (Android via Termux):**
* Termux (Latest release from F-Droid)
* Node.js installed via `pkg install nodejs`
* To optimize development time and avoid native compilation overhead, the frontend is built to run flawlessly inside an HTML/JS-based APK wrapper.

---

## Universal Installation Guide

The installation process is identical regardless of your operating system or hardware environment. 

1. **Clone the Repository**
Open your terminal and pull the source code to your local machine:
\`\`\`bash
git clone https://github.com/YOUR_USERNAME/rashboard.git
cd rashboard
\`\`\`

2. **Install Core Dependencies**
Initialize the Node package manager to install required libraries (Express, Nodemailer, node-cron, etc.):
\`\`\`bash
npm install
\`\`\`

3. **Initialize the Environment File**
Never commit your raw `.env` file to version control. Rashboard provides a template for safe initialization:
\`\`\`bash
cp .env.example .env
\`\`\`

---

## Environment Configuration (The Switch)

Open the `.env` file in your preferred editor. You must instruct the engine on how to process inference by setting the `AI_MODE` variable.

### Option A: Cloud API Mode (Recommended for Speed)
This mode connects your dashboard to a cloud-hosted model. It is compatible with any OpenAI-standard endpoint.
\`\`\`env
AI_MODE=api
API_BASE_URL=https://api.groq.com/openai/v1/chat/completions
API_KEY=your_secure_api_key_here
API_MODEL=llama-3.1-8b-instant
\`\`\`

### Option B: Local Offline Mode (Recommended for Privacy)
This mode completely disconnects Rashboard from the internet, routing all queries to a local inference engine running on a dedicated port.
\`\`\`env
AI_MODE=local
LOCAL_API_URL=http://127.0.0.1:8080/v1/chat/completions
LOCAL_MODEL=gemma-4-e2b-it
\`\`\`

### SMTP Configuration
To utilize the `sendEmail` tool, provide your mail server credentials. If using Gmail, you must generate a 16-digit "App Password" from your Google Account security settings.
\`\`\`env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your.email@address.com
SMTP_PASS=your_16_digit_app_password
SMTP_FROM="Rashboard Core" <your.email@address.com>
\`\`\`

Once configured, boot the application:
\`\`\`bash
npm start
\`\`\`
The Node.js server will initialize, establish the memory cache, and begin listening on Port 3000.

---

## The Mobile-First LiteRT APK Integration

Rashboard was heavily optimized to run on mobile processors (e.g., Snapdragon architectures) using a dual-server Termux environment.

For users wishing to deploy the AI completely offline on an Android device:
1. Navigate to the **Releases** tab of this repository.
2. Download the pre-compiled LiteRT Engine `.apk`.
3. Install the APK, which serves as a streamlined HTML/JS wrapper.
4. Open Termux and create two separate sessions.
   * **Session 1:** Boot your local inference model so it binds to `127.0.0.1:8080`.
   * **Session 2:** Navigate to the `rashboard` directory and run `npm start`.
5. The APK wrapper will natively connect to the Node.js backend, providing a fully localized, hardware-accelerated agentic environment directly on your device.

---

## Security & Best Practices

Rashboard possesses the ability to read your database schemas, access secure API keys, and transmit data. 
* **.gitignore Integrity:** Ensure your `.env` and `memory.json` files remain in the `.gitignore` registry. Pushing these files to a public repository will result in immediate compromise of your credentials.
* **Transient Network Errors:** If operating in Cloud API mode on a mobile network, you may occasionally encounter an `ECONNRESET` terminal error. This is a standard mobile socket drop; the system is designed to recover seamlessly upon the next prompt.
* **Row Level Security (RLS):** When the agent utilizes the Supabase querying tool, it respects your database RLS policies. Ensure the active key provided to the UI vault has the correct permissions for the data you are requesting.

---

## Roadmap & Future Development

Rashboard v1.0 establishes the core communication, routing, and tool-execution protocols. Future iterations (v1.1+) are planned to expand the agent's filesystem capabilities, including:
* Native terminal command execution directly from the chat interface.
* Direct local file-reading tools for seamless repository context ingestion.
* Automated cron-job health pinging for monitored projects.

## License

This project is open-source and available under the standard ISC License.
