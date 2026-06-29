// public/script.js

// --- 🧠 CORE STATE & CACHE ---
let projects = [];
try { projects = JSON.parse(localStorage.getItem('rashboard_v13')) || []; } catch(e) {}
if (!Array.isArray(projects)) projects = [];

let tempParsedVars = []; 
let editingProjectId = null;

let activeTabs = {};
try { activeTabs = JSON.parse(localStorage.getItem('rashboard_tabs')) || {}; } catch(e) {}

let expandedCards = new Set();
try { expandedCards = new Set(JSON.parse(localStorage.getItem('rashboard_expanded') || '[]')); } catch(e) {}

let searchTerm = '';
let voiceResponseEnabled = false;
let recognition = null;
let isListening = false;

const DEFAULT_CATEGORIES = ['General', 'Database', 'Backend', 'Storage', 'AppScript', 'Frontend', 'Auth'];

const SERVICES = [
    { name: 'Supabase', regex: /https:\/\/([a-z0-9]+)\.supabase\.co/i, getUrl: m => `https://supabase.com/dashboard/project/${m[1]}`, color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
    { name: 'Render', regex: /\.onrender\.com/i, getUrl: () => `https://dashboard.render.com/`, color: 'text-purple-500 bg-purple-500/10 border-purple-500/20' },
    { name: 'Neon', regex: /\.neon\.tech/i, getUrl: () => `https://console.neon.tech/`, color: 'text-teal-500 bg-teal-500/10 border-teal-500/20' },
    { name: 'Clerk', regex: /clerk\./i, getUrl: () => `https://dashboard.clerk.com/`, color: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20' },
    { name: 'Stripe', regex: /sk_live|pk_live|sk_test|pk_test/i, getUrl: () => `https://dashboard.stripe.com/`, color: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
    { name: 'Vercel', regex: /\.vercel\.app/i, getUrl: () => `https://vercel.com/dashboard`, color: 'text-accent bg-elevated border-borderline/20' }
];

// --- 🚀 THE UNBREAKABLE BOOT SEQUENCE ---
function forceRemoveSplash() {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.style.opacity = '0';
        splash.style.pointerEvents = 'none';
        setTimeout(() => splash.style.display = 'none', 700);
    }
}
setTimeout(forceRemoveSplash, 1500);

document.addEventListener("DOMContentLoaded", () => {
    try {
        init();
        switchView('workspace');
        setupEventListeners();
        setTimeout(forceRemoveSplash, 300);
    } catch (error) {
        console.error("[SYSTEM FATAL] Boot sequence crashed:", error);
        forceRemoveSplash();
    }
});

// --- 🔄 BACKGROUND SYNC ---
async function syncToBackend() {
    try {
        await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projects: projects })
        });
    } catch(e) { console.error("Failed to sync with backend", e); }
}

// --- 📜 PERSISTENT CHAT HISTORY ---
async function loadChatHistory() {
    try {
        const res = await fetch('/api/history');
        const data = await res.json();
        
        if (data.history && data.history.length > 0) {
            const wrapper = document.getElementById('chat-content-wrapper');
            if (wrapper) wrapper.innerHTML = ''; 
            
            data.history.forEach(msg => {
                const isUser = msg.role === 'user';
                const div = document.createElement('div');
                div.className = `p-4 rounded-2xl max-w-[90%] md:max-w-[80%] text-sm shadow-inner-light leading-relaxed animate-slide-up ${isUser ? 'chat-bubble-user' : 'chat-bubble-agent'}`;
                div.innerHTML = msg.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                if (wrapper) wrapper.appendChild(div);
            });

            const chatBox = document.getElementById('chat-box');
            if (chatBox) setTimeout(() => chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' }), 100);
        }
    } catch(e) { console.error("No history found."); }
}

async function clearChat() {
    if(confirm("Wipe all AI chat history? This cannot be undone.")) {
        try {
            await fetch('/api/history', { method: 'DELETE' });
            const wrapper = document.getElementById('chat-content-wrapper');
            if (wrapper) {
                wrapper.innerHTML = `
                    <div class="chat-bubble-agent p-4 rounded-2xl max-w-[90%] md:max-w-[80%] text-sm shadow-inner-light animate-slide-up">
                        <p>System memory wiped. Ready for new commands.</p>
                    </div>`;
            }
            showToast("Chat history cleared", "success");
        } catch(e) { showToast("Failed to clear history", "error"); }
    }
}

// --- ⚙️ INITIALIZATION & META ---
function init() {
    if (projects.length === 0 && localStorage.getItem('rashboard_v12')) {
        projects = JSON.parse(localStorage.getItem('rashboard_v12'));
        localStorage.setItem('rashboard_v13', JSON.stringify(projects));
    }
    
    projects.forEach(p => { 
        if(!p) return;
        const keys = Object.keys(p.tabs || {}); 
        if(keys.length && !activeTabs[p.id]) activeTabs[p.id] = keys[0]; 
    });

    saveStateMeta();
    setupKeyboardShortcuts();
    renderProjects();
    pingAll();
    
    syncToBackend(); 
    loadChatHistory();
    
    setInterval(syncToBackend, 10000);
    setInterval(pingAll, 30000);
}

function saveStateMeta() {
    localStorage.setItem('rashboard_tabs', JSON.stringify(activeTabs));
    localStorage.setItem('rashboard_expanded', JSON.stringify(Array.from(expandedCards)));
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            if(document.getElementById('view-workspace').style.display !== 'none') document.getElementById('global-search').focus();
        }
        if (e.key === 'Escape') {
            closeCreator();
            const searchInput = document.getElementById('global-search');
            if (document.activeElement === searchInput) { searchInput.blur(); clearSearch(); }
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            const modal = document.getElementById('creator-backdrop');
            if (modal && modal.classList.contains('active')) {
                if (!document.getElementById('step-2').classList.contains('hidden')) saveProject();
                else processEnv();
            }
        }
    });
}

function switchView(view) {
    document.getElementById('view-workspace').style.display = view === 'workspace' ? 'flex' : 'none';
    document.getElementById('view-agent').style.display = view === 'agent' ? 'flex' : 'none';
    document.getElementById('view-settings').style.display = view === 'settings' ? 'flex' : 'none';
    
    ['workspace', 'agent', 'settings'].forEach(v => {
        const isV = view === v;
        const navBtn = document.getElementById(`nav-btn-${v}`);
        const mobNavBtn = document.getElementById(`mob-nav-btn-${v}`);
        
        if (navBtn) navBtn.className = `nav-btn flex items-center gap-3 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${isV ? 'bg-elevated/50 text-accent border border-borderline/5 shadow-inner-light' : 'text-muted hover:text-accent hover:bg-elevated/30 border border-transparent'}`;
        if (mobNavBtn) mobNavBtn.className = `mob-nav-btn flex items-center justify-center w-12 h-12 rounded-full transition-colors ${isV ? 'bg-elevated/80 text-accent' : 'text-muted hover:text-accent'}`;
    });
}

// --- 🔍 UI & SEARCH ---
function handleSearch(val) { searchTerm = val.toLowerCase().trim(); renderProjects(); }
function clearSearch() { document.getElementById('global-search').value = ''; handleSearch(''); }
function toggleGhPagesInput(isChecked) {
    const container = document.getElementById('gh-pages-custom-container');
    if (container) isChecked ? container.classList.add('hidden') : container.classList.remove('hidden');
}

// --- 🎨 HTML RENDERERS ---
function generateVaultHtml(project, tabName) {
    const configs = (project.tabs || {})[tabName] || [];
    if (configs.length === 0) return '<div class="py-10 text-center text-xs font-medium text-muted">No variable mapping in this category.</div>';
    return configs.map(conf => `<div class="flex justify-between items-center py-3 border-b border-borderline/10 last:border-0 group cursor-pointer hover:bg-borderline/5 px-2 -mx-2 rounded-lg" onclick="copyText('${conf.value.replace(/'/g, "\\'")}', '${conf.key}')"><span class="text-[13px] font-bold text-accent w-[40%] truncate">${conf.key}</span><div class="flex items-center gap-2"><span class="text-[11px] font-mono text-muted group-hover:text-accent">${conf.value.replace(/./g, '•')}</span></div></div>`).join('');
}

function generateTabsHtml(project, currentTab) {
    const tabNames = Object.keys(project.tabs || {}); if (tabNames.length === 0) return '';
    const tabButtons = tabNames.map(tab => `<button onclick="switchTab('${project.id}', '${tab}')" class="tab-btn px-4 py-3.5 text-[13px] elite-tab ${currentTab === tab ? 'active' : ''} whitespace-nowrap flex items-center gap-1.5">${tab} <span class="text-[9px] bg-borderline/10 px-1.5 py-0.5 rounded text-muted font-bold">${(project.tabs[tab] || []).length}</span></button>`).join('');
    return `<div class="flex justify-between items-center border-b border-borderline/10 pr-2"><div class="flex overflow-x-auto hide-scroll px-2" id="tabs-container-${project.id}">${tabButtons}</div></div>`;
}

function renderProjects() {
    const grid = document.getElementById('project-grid'); 
    const emptyState = document.getElementById('empty-state');
    if (!grid || !emptyState) return;

    const filtered = projects.filter(p => !searchTerm || (p.name||'').toLowerCase().includes(searchTerm) || Object.values(p.tabs||{}).flat().some(v => (v.key||'').toLowerCase().includes(searchTerm)));
    if (filtered.length === 0) { grid.innerHTML = ''; emptyState.classList.remove('hidden'); emptyState.classList.add('flex'); return; }
    emptyState.classList.add('hidden'); emptyState.classList.remove('flex');
    
    grid.innerHTML = filtered.map((project) => {
        const isExpanded = expandedCards.has(project.id) || searchTerm !== ''; 
        const currentActiveTab = activeTabs[project.id];
        const allConfigs = Object.values(project.tabs || {}).flat();
        
        let dockButtons = [];
        if (project.liveUrl) dockButtons.push(`<a href="${project.liveUrl}" target="_blank" class="dock-pill border-blue-500/30 bg-blue-500/10 text-blue-500 hover:bg-blue-500/20"><span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span> LIVE APP</a>`);
        if (project.ghRepo) {
            let repoPath = project.ghRepo.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/^\/+|\/+$/g, '');
            if (!repoPath.includes('/')) repoPath = `ravjit-singh/${repoPath}`;
            dockButtons.push(`<a href="https://github.com/${repoPath}" target="_blank" class="dock-pill border-borderline/20 bg-elevated text-accent hover:bg-borderline/10">REPO</a>`);
            let pagesLink = project.autoPages !== false ? `https://ravjit-singh.github.io/${repoPath.split('/').pop()}` : project.ghPagesUrl;
            if (pagesLink) dockButtons.push(`<a href="${pagesLink}" target="_blank" class="dock-pill border-amber-500/30 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20">PAGES ↗</a>`);
        }
        detectServices(allConfigs).forEach(p => dockButtons.push(`<a href="${p.url}" target="_blank" class="dock-pill ${p.color}">${p.name}</a>`));

        return `
        <div id="card-${project.id}" class="glass-card flex flex-col w-full animate-slide-up">
            <div class="p-5 md:p-7 pb-5">
                <div class="flex justify-between items-start">
                    <div class="max-w-[75%]"><h3 class="text-xl font-bold truncate">${project.name || 'Unnamed'}</h3><button onclick="forcePing('${project.id}')" id="status-${project.id}" class="flex items-center gap-1.5 mt-1 hover:opacity-70"><span class="w-1.5 h-1.5 rounded-full bg-muted"></span><span class="text-[9px] text-muted font-bold tracking-widest uppercase">STANDBY</span></button></div>
                    <div class="flex gap-2"><button onclick="editProject('${project.id}')" class="w-9 h-9 rounded-full bg-surface border border-borderline/10 flex items-center justify-center text-muted hover:text-accent shadow-inner-light"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button><button onclick="deleteProject('${project.id}')" class="w-9 h-9 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 hover:bg-red-500/20 shadow-inner-light"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></div>
                </div>
                ${dockButtons.length > 0 ? `<div class="flex flex-wrap gap-2 mt-5 pb-1">${dockButtons.join('')}</div>` : ''}
            </div>
            <button onclick="toggleExpand('${project.id}')" class="w-full px-6 py-4 border-t border-borderline/5 flex justify-between items-center text-xs font-bold text-muted hover:text-accent hover:bg-elevated/30 transition-colors rounded-b-[20px]">
                <span>Secure Environment Vault</span>
                <svg id="icon-${project.id}" class="w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            <div id="wrapper-${project.id}" class="expandable-wrapper ${isExpanded ? 'expanded border-borderline/10' : ''} bg-base rounded-b-[20px] border-t border-borderline/0 transition-all">
                <div class="expandable-inner flex flex-col" id="content-area-${project.id}">${generateTabsHtml(project, currentActiveTab)}<div class="px-5 py-3 flex-grow vault-content-container" id="vault-${project.id}">${generateVaultHtml(project, currentActiveTab)}</div></div>
            </div>
        </div>`;
    }).join(''); 
    
    if(!searchTerm) pingAll();
}

function switchTab(projectId, tabName) { activeTabs[projectId] = tabName; saveStateMeta(); renderProjects(); }
function toggleExpand(projectId) { expandedCards.has(projectId) ? expandedCards.delete(projectId) : expandedCards.add(projectId); saveStateMeta(); renderProjects(); }
function copyText(t, k) { navigator.clipboard.writeText(t).then(() => showToast(`Value for ${k} secured to clipboard`, "success")); }

// --- 📂 FILE UPLOAD & EXTRACTION ---
function handleDragOver(e) { e.preventDefault(); document.getElementById('dropzone').classList.add('dragover'); }
function handleDragLeave(e) { e.preventDefault(); document.getElementById('dropzone').classList.remove('dragover'); }
function handleDrop(e) { e.preventDefault(); document.getElementById('dropzone').classList.remove('dragover'); processFile(e.dataTransfer.files[0]); }
function handleFileInput(e) { processFile(e.target.files[0]); e.target.value = ""; }

function processFile(file) {
    if (!file) return;
    if (!file.name.includes('.env') && !file.name.match(/^\.env/)) return showToast("Only .env formats accepted", "error");
    const reader = new FileReader();
    reader.onload = e => {
        const ta = document.getElementById('env-input');
        if (ta) ta.value = ta.value ? ta.value + '\n' + e.target.result : e.target.result;
        showToast(`Extracted ${file.name} successfully`, "success");
    };
    reader.readAsText(file);
}

// --- 🛠️ MODAL WORKFLOW ---
function openCreator() { 
    editingProjectId = null; 
    document.getElementById('proj-name').value = ''; 
    document.getElementById('proj-live-url').value = ''; 
    document.getElementById('proj-gh').value = ''; 
    document.getElementById('env-input').value = ''; 
    showModalStep(1); 
}

function editProject(id) { 
    const p = projects.find(x => x.id === id); if (!p) return; 
    editingProjectId = id; 
    document.getElementById('proj-name').value = p.name || ''; 
    document.getElementById('proj-live-url').value = p.liveUrl || ''; 
    document.getElementById('proj-gh').value = p.ghRepo || ''; 
    let raw = ""; 
    for (const t in (p.tabs || {})) (p.tabs[t] || []).forEach(v => { if(v.key) raw += `${v.key}=${v.value}\n`; }); 
    document.getElementById('env-input').value = raw.trim(); 
    showModalStep(1); 
}

function handleBackdropClick(e) { if(e.target === e.currentTarget) closeCreator(); }

function showModalStep(step) { 
    const backdrop = document.getElementById('creator-backdrop');
    if (backdrop) backdrop.classList.add('active'); 
    
    if (step === 1) { 
        document.getElementById('step-1').classList.remove('hidden'); 
        document.getElementById('step-2').classList.add('hidden'); 
        document.getElementById('step-2').classList.remove('flex'); 
    } else { 
        document.getElementById('step-1').classList.add('hidden'); 
        document.getElementById('step-2').classList.remove('hidden'); 
        document.getElementById('step-2').classList.add('flex'); 
    } 
}

function closeCreator() { 
    const backdrop = document.getElementById('creator-backdrop');
    if (backdrop) backdrop.classList.remove('active'); 
    tempParsedVars = []; 
}

function backToStep1() { showModalStep(1); }

function processEnv() {
    const n = document.getElementById('proj-name').value.trim();
    const e = document.getElementById('env-input').value;
    if (!n) return showToast('Project Identity is required', 'error');
    
    tempParsedVars = e.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map((line, idx) => {
        const eq = line.indexOf('='); if(eq === -1) return null;
        const key = line.substring(0, eq).trim(), value = line.substring(eq + 1).trim().replace(/^["']|["']$/g, '');
        let tab = 'General'; const k = key.toUpperCase();
        if (k.includes('DB') || k.includes('DATABASE') || k.includes('POSTGRES') || k.includes('SUPABASE')) tab = 'Database';
        else if (k.includes('AWS') || k.includes('S3') || k.includes('BUCKET')) tab = 'Storage';
        else if (k.includes('API') || k.includes('SECRET') || k.includes('CLERK') || k.includes('STRIPE')) tab = 'Backend';
        else if (k.includes('NEXT_PUBLIC') || k.includes('VITE') || k.includes('REACT')) tab = 'Frontend';
        return { id: idx, key, value, tab };
    }).filter(Boolean);
    
    showModalStep(2); 
    renderCategorizationStep();
}

function renderCategorizationStep() {
    const list = document.getElementById('parsed-vars-list');
    if (!list) return;
    
    if (!tempParsedVars.length) { 
        list.innerHTML = `<div class="text-center py-10 text-muted text-sm border border-dashed border-borderline/20 rounded-xl bg-base">No variables extracted. Setup is currently blank.</div>`; 
        return; 
    }
    
    list.innerHTML = tempParsedVars.map((v, i) => `
        <div class="flex flex-col md:flex-row gap-3 items-start md:items-center bg-elevated/50 p-4 rounded-xl border border-borderline/10 shadow-inner-light">
            <div class="flex-grow w-full md:w-auto flex flex-col gap-1.5">
                <input type="text" value="${v.key || ''}" onchange="updateTempVar(${i}, 'key', this.value)" class="w-full bg-transparent border-b border-borderline/10 px-1 py-1 text-sm font-bold text-accent outline-none focus:border-accent transition-colors">
                <input type="text" value="${v.value || ''}" onchange="updateTempVar(${i}, 'value', this.value)" class="w-full bg-transparent border-b border-borderline/10 px-1 py-1 text-[11px] font-mono text-muted outline-none focus:border-accent transition-colors">
            </div>
            <div class="flex items-center gap-2 w-full md:w-auto shrink-0">
                <select onchange="updateTempVar(${i}, 'tab', this.value)" class="flex-1 md:w-36 bg-surface border border-borderline/10 text-xs text-accent font-semibold rounded-lg px-2 py-2 outline-none shadow-inner-light">
                    ${DEFAULT_CATEGORIES.map(cat => `<option value="${cat}" ${v.tab === cat ? 'selected' : ''}>${cat}</option>`).join('')}
                    <option value="NEW">+ Custom...</option>
                </select>
                <button onclick="removeTempVar(${i})" class="w-9 h-9 rounded-lg bg-surface border border-borderline/10 flex items-center justify-center text-muted hover:text-red-500 hover:border-red-500/30 transition-all shrink-0">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </div>
        </div>`).join('');
}

function addNewRow() { tempParsedVars.push({ key: '', value: '', tab: 'General' }); renderCategorizationStep(); }
function removeTempVar(index) { tempParsedVars.splice(index, 1); renderCategorizationStep(); }
function updateTempVar(index, field, val) { tempParsedVars[index][field] = val; }

function saveProject() {
    const n = document.getElementById('proj-name').value.trim(); 
    const l = document.getElementById('proj-live-url').value.trim(); 
    const g = document.getElementById('proj-gh').value.trim();
    
    const grp = {}; 
    tempParsedVars.filter(v => v.key || v.value).forEach(v => { 
        const t = v.tab || 'General'; 
        if (!grp[t]) grp[t] = []; 
        grp[t].push({ key: v.key, value: v.value }); 
    });
    
    if (editingProjectId) { 
        const i = projects.findIndex(p => p.id === editingProjectId); 
        if (i > -1) { projects[i] = { ...projects[i], name: n, liveUrl: l, ghRepo: g, tabs: grp }; } 
    } else { 
        const id = crypto.randomUUID(); 
        projects.unshift({ id, name: n, liveUrl: l, ghRepo: g, tabs: grp }); 
        activeTabs[id] = Object.keys(grp)[0] || null; 
    }
    
    localStorage.setItem('rashboard_v13', JSON.stringify(projects)); 
    saveStateMeta(); 
    renderProjects(); 
    pingAll(); 
    syncToBackend(); 
    closeCreator(); 
    showToast("System synchronized", "success");
}

function deleteProject(id) { 
    if(confirm("Delete environment?")) { 
        projects = projects.filter(p => p.id !== id); 
        delete activeTabs[id]; 
        expandedCards.delete(id); 
        localStorage.setItem('rashboard_v13', JSON.stringify(projects)); 
        saveStateMeta(); 
        renderProjects(); 
        syncToBackend(); 
    } 
}

// --- 💾 BACKUP & RESTORE ---
function exportData() { 
    if(!projects.length) return showToast("No data to export", "error"); 
    const str = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(projects, null, 2)); 
    const a = document.createElement('a'); 
    a.href = str; 
    a.download = `rashboard-vault-${new Date().toISOString().split('T')[0]}.json`; 
    a.click(); 
    showToast("Vault exported securely", "success"); 
}

function importData(e) {
    const f = e.target.files[0]; 
    if (!f) return; 
    
    const r = new FileReader(); 
    r.onload = event => { 
        try { 
            const imp = JSON.parse(event.target.result); 
            if (Array.isArray(imp)) { 
                projects = imp.filter(p => p !== null); 
                localStorage.setItem('rashboard_v13', JSON.stringify(projects)); 
                projects.forEach(p => { 
                    const k = Object.keys(p.tabs || {}); 
                    if(k.length) activeTabs[p.id] = k[0]; 
                }); 
                saveStateMeta(); 
                switchView('workspace'); 
                renderProjects(); 
                pingAll(); 
                syncToBackend(); 
                showToast("System restored successfully", "success"); 
            } else {
                throw new Error("Invalid format: Not an array");
            }
        } catch(err) { 
            console.error("Restore Error:", err);
            showToast(`Error: ${err.message}`, "error"); 
        } 
    }; 
    r.readAsText(f); 
    e.target.value = ""; 
}

function clearAllData() { 
    if(confirm("Wipe all local Rashboard data? Cannot be undone.")) { 
        projects = []; 
        localStorage.removeItem('rashboard_v13'); 
        renderProjects(); 
        syncToBackend(); 
        showToast("System wiped", "success"); 
    } 
}

function showToast(msg, type = "success") {
    const t = document.getElementById('toast'), i = document.getElementById('toast-icon'); 
    if (!t || !i) return;
    
    document.getElementById('toast-msg').innerText = msg;
    i.className = `w-5 h-5 shrink-0 rounded-full flex items-center justify-center border ${type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-500' : 'border-blue-500/30 bg-blue-500/10 text-blue-500'}`;
    i.innerHTML = type === 'error' ? '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>' : '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>';
    
    t.classList.remove('opacity-0', 'pointer-events-none'); 
    t.classList.remove(window.innerWidth < 768 ? '-translate-y-20' : 'translate-y-20'); 
    t.classList.add('translate-y-0');
    
    setTimeout(() => { 
        t.classList.add('opacity-0', 'pointer-events-none'); 
        t.classList.remove('translate-y-0'); 
        t.classList.add(window.innerWidth < 768 ? '-translate-y-20' : 'translate-y-20'); 
    }, 3000);
}

// --- 📡 NETWORK & PING ---
function detectServices(cfgs) {
    const d = [], a = new Set(); 
    cfgs.forEach(c => {
        if(!c.value) return;
        SERVICES.forEach(s => { const m = c.value.match(s.regex); if (m && !a.has(s.name)) { d.push({ name: s.name, url: s.getUrl(m), color: s.color }); a.add(s.name); } });
    }); 
    return d;
}

function forcePing(id) { const p = projects.find(x => x.id === id); if(p) autoPingMainUrl(p); }
function pingAll() { projects.forEach(p => autoPingMainUrl(p)); }

async function autoPingMainUrl(p) {
    const d = document.getElementById(`status-${p.id}`); if (!d) return; 
    let u = p.liveUrl; 
    if (!u) { const safeTabs = p.tabs || {}; for (const t in safeTabs) { const f = (safeTabs[t] || []).find(c => c.value && c.value.startsWith('http')); if (f) { u = f.value; break; } } }
    if (!u) { d.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-muted"></span><span class="text-[9px] text-muted font-bold tracking-widest uppercase">IDLE</span>`; return; }
    
    d.innerHTML = `<span class="flex h-1.5 w-1.5 relative"><span class="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75"></span><span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span></span><span class="text-[9px] text-blue-500 font-bold tracking-widest uppercase">PINGING</span>`;
    const c = new AbortController(); const tId = setTimeout(() => c.abort(), 3500);
    
    try { 
        await fetch(u, { mode: 'no-cors', signal: c.signal, cache: 'no-store' }); 
        clearTimeout(tId); 
        d.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span><span class="text-[9px] text-emerald-500 font-bold tracking-widest uppercase">ONLINE</span>`;
    } catch (err) { 
        if (err.name === 'AbortError') { 
            d.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse"></span><span class="text-[9px] text-amber-500 font-bold tracking-widest uppercase">WAKING SERVER</span>`; 
            setTimeout(() => autoPingMainUrl(p), 8000); 
        } else { 
            d.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></span><span class="text-[9px] text-red-500 font-bold tracking-widest uppercase">OFFLINE</span>`; 
        } 
    }
}

// --- 🎙️ BROWSER-NATIVE NEURAL TTS (WebAssembly) ---
let ttsPipeline = null;
let isModelLoading = false;

// 1. Pre-load the tiny model into the phone's RAM
async function initTTSModel() {
    if (ttsPipeline || isModelLoading) return;
    isModelLoading = true;
    try {
        showToast("Downloading Neural Voice (Takes 10-30s first time)...", "success");

        // Dynamically import the Hugging Face WASM engine
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers');
        
        // FIX 1: Explicitly tell Android where to find the WASM binary files so they don't 404
        env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/';
        
        // Optimize for mobile browser hardware
        env.allowLocalModels = false;
        env.useBrowserCache = true; 
        
        console.log("[SYSTEM] Downloading & caching Neural Voice...");
        
        // FIX 2: Force 'quantized: true' to ensure the tiny version loads (prevents Android RAM crashes)
        ttsPipeline = await pipeline('text-to-speech', 'Xenova/vits-ljs', { quantized: true }); 
        
        showToast("Neural Voice Ready!", "success");
        console.log("[SYSTEM] Neural Voice Ready.");
    } catch (err) {
        console.error("WASM INIT ERROR:", err);
        showToast("AI Boot Error: " + err.message, "error");
    }
    isModelLoading = false;
}

// 2. The Fileless Playback Function
async function speakAgentText(text) { 
    if (!voiceResponseEnabled) return; 
    const cleanText = text.replace(/[*#]/g, '').replace(/_/g, ' ');

    try {
        if (!ttsPipeline) {
            showToast("Initializing voice engine...", "success");
            await initTTSModel();
            if (!ttsPipeline) throw new Error("Model failed to initialize.");
        }

        const result = await ttsPipeline(cleanText);
        
        // The engine outputs raw Float32 audio data. Convert it to a standard browser Audio blob.
        const wavBuffer = encodeWAV(result.audio, result.sampling_rate);
        const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // 🚀 Instant playback at 1.2x speed
        const audio = new Audio(audioUrl);
        audio.playbackRate = 1.2; 
        
        // FIX 3: Catch Android blocking asynchronous media playback
        audio.play().catch(e => {
            console.error("Playback blocked by Android:", e);
            throw new Error("Android blocked audio playback.");
        });

    } catch (error) {
        console.error("WASM Voice Engine Error:", error);
        
        // This will now pop up on your screen telling us EXACTLY why it failed
        showToast("Using Native Voice. Error: " + (error.message || "Unknown Engine Crash"), "error");
        
        // Instant failsafe
        if (window.speechSynthesis) {
            const fallback = new SpeechSynthesisUtterance(cleanText);
            fallback.rate = 1.2;
            window.speechSynthesis.speak(fallback);
        }
    }
}

// 3. Helper to wrap raw Float32 neural audio into a playable WAV file
function encodeWAV(samples, sampleRate) {
    const rawSamples = samples.data ? samples.data : samples; // Failsafe for Tensor objects
    const buffer = new ArrayBuffer(44 + rawSamples.length * 2);
    const view = new DataView(buffer);
    const writeString = (view, offset, string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };
    
    writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + rawSamples.length * 2, true);
    writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeString(view, 36, 'data');
    view.setUint32(40, rawSamples.length * 2, true);
    
    let offset = 44;
    for (let i = 0; i < rawSamples.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, rawSamples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
}



function resetMicState() { 
    isListening = false; 
    const micBtn = document.getElementById('mic-btn');
    const messageInput = document.getElementById('message-input');
    if(micBtn) micBtn.classList.remove('mic-active', 'animate-pulse-fast'); 
    if(messageInput) { messageInput.placeholder = "Ask agent..."; messageInput.disabled = false; } 
}

function appendMessage(text, isUser) {
    const chatWrapper = document.getElementById('chat-content-wrapper');
    const chatBox = document.getElementById('chat-box');
    if (!chatWrapper) return;
    
    const div = document.createElement('div'); 
    div.className = `p-4 rounded-2xl max-w-[90%] md:max-w-[80%] text-sm shadow-inner-light animate-slide-up leading-relaxed ${isUser ? 'chat-bubble-user' : 'chat-bubble-agent'}`;
    div.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); 
    chatWrapper.appendChild(div);
    
    if (chatBox) setTimeout(() => { chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' }); }, 50);
}

// --- 🎯 SAFELY BIND EVENT LISTENERS & STREAMING ENGINE ---
function setupEventListeners() {
    const voiceToggleBtn = document.getElementById('voice-toggle-btn'); 
    const voiceIcon = document.getElementById('voice-icon'); 
    const voiceStatusText = document.getElementById('voice-status-text');
    
    if(voiceToggleBtn) {
        voiceToggleBtn.addEventListener('click', () => { 
            voiceResponseEnabled = !voiceResponseEnabled; 
            if (voiceResponseEnabled) { 
                voiceStatusText.textContent = "AUDIO ON"; 
                voiceToggleBtn.classList.replace('text-muted', 'text-blue-400'); 
                voiceIcon.classList.replace('text-muted', 'text-blue-400'); 
                voiceIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.898a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path>`; 
            } else { 
                voiceStatusText.textContent = "SILENT"; 
                voiceToggleBtn.classList.replace('text-blue-400', 'text-muted'); 
                voiceIcon.classList.replace('text-blue-400', 'text-muted'); 
                window.speechSynthesis.cancel(); 
                voiceIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clip-rule="evenodd"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>`; 
            } 
        });
    }

    const micBtn = document.getElementById('mic-btn'); 
    const messageInput = document.getElementById('message-input'); 
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition; 
    
    if (SpeechRecognition && micBtn && messageInput) {
        recognition = new SpeechRecognition(); 
        recognition.continuous = false; 
        recognition.interimResults = false; 
        recognition.lang = 'en-US';
        
        recognition.onstart = () => { 
            isListening = true; 
            micBtn.classList.add('mic-active', 'animate-pulse-fast'); 
            messageInput.placeholder = "Listening..."; 
            messageInput.disabled = true; 
        };
        
        recognition.onresult = (e) => { 
            messageInput.value = e.results[0][0].transcript; 
            document.getElementById('chat-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); 
        };
        
        recognition.onerror = () => resetMicState(); 
        recognition.onend = () => resetMicState();
        
        micBtn.addEventListener('click', () => { 
            if (isListening) recognition.stop(); 
            else { try { recognition.start(); } catch (e) {} } 
        });
    } else if (micBtn && messageInput) { 
        micBtn.style.display = 'none'; 
        messageInput.classList.remove('pl-12'); 
        messageInput.classList.add('pl-4'); 
    }

    const chatForm = document.getElementById('chat-form'); 
    const sendBtn = document.getElementById('send-btn');
    const chatWrapper = document.getElementById('chat-content-wrapper');
    const chatBox = document.getElementById('chat-box');
    
    if (chatForm && messageInput && sendBtn) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault(); 
            const message = messageInput.value.trim(); 
            if (!message) return;
            
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            
            // 1. Post User Message immediately
            appendMessage(message, true); 
            messageInput.value = ''; 
            sendBtn.innerHTML = `<span class="w-4 h-4 border-2 border-accentInv border-t-transparent rounded-full animate-spin"></span>`; 
            sendBtn.disabled = true;

            // 2. Instantiate an empty Agent Message Box instantly
            const agentBubble = document.createElement('div');
            agentBubble.className = `p-4 rounded-2xl max-w-[90%] md:max-w-[80%] text-sm shadow-inner-light animate-slide-up leading-relaxed chat-bubble-agent`;
            agentBubble.innerHTML = `<span class="animate-pulse text-muted">Thinking...</span>`;
            if (chatWrapper) chatWrapper.appendChild(agentBubble);
            if (chatBox) chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
            
            try {
                const response = await fetch('/api/chat', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ message }) 
                });

                if (!response.body) throw new Error("No stream payload received");

                // 3. Mount the Decoder and Process the Stream real-time
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let fullText = '';
                
                // Clear the 'Thinking' text and add a blinking cursor block
                agentBubble.innerHTML = `<span class="inline-block w-1.5 h-3.5 ml-1 bg-accent/70 animate-pulse"></span>`;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    fullText += chunk;
                    
                    // Render current text + bold formats + the blinking cursor
                    agentBubble.innerHTML = fullText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') + `<span class="inline-block w-1.5 h-3.5 ml-1 bg-accent/70 animate-pulse"></span>`;
                    
                    // Auto-scroll slightly so the new words are always visible
                    if (chatBox) chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
                }

                // 4. Stream Complete: Remove the cursor and fire Voice API
                agentBubble.innerHTML = fullText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                speakAgentText(fullText);

            } catch (error) { 
                agentBubble.innerHTML = "System Error: Failed to reach the Core router or stream interrupted."; 
            } finally {
                sendBtn.innerHTML = `<span class="hidden md:inline">SEND</span><svg class="w-4 h-4 md:w-3 md:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>`;
                sendBtn.disabled = false; 
                if (window.innerWidth > 768 && !isListening) messageInput.focus();
            }
        });
    }
}

// --- 🌍 GLOBAL EXPORTS FOR HTML INLINE EVENTS (MODULE FIX) ---
// By making script.js a module for the WASM engine, it isolates the scope.
// We must attach UI functions directly to the global window so HTML buttons can click them.
window.switchView = switchView;
window.handleSearch = handleSearch;
window.clearSearch = clearSearch;
window.toggleGhPagesInput = toggleGhPagesInput;
window.switchTab = switchTab;
window.toggleExpand = toggleExpand;
window.copyText = copyText;
window.handleDragOver = handleDragOver;
window.handleDragLeave = handleDragLeave;
window.handleDrop = handleDrop;
window.handleFileInput = handleFileInput;
window.openCreator = openCreator;
window.editProject = editProject;
window.handleBackdropClick = handleBackdropClick;
window.closeCreator = closeCreator;
window.backToStep1 = backToStep1;
window.processEnv = processEnv;
window.addNewRow = addNewRow;
window.removeTempVar = removeTempVar;
window.updateTempVar = updateTempVar;
window.saveProject = saveProject;
window.deleteProject = deleteProject;
window.exportData = exportData;
window.importData = importData;
window.clearAllData = clearAllData;
window.forcePing = forcePing;
window.clearChat = clearChat;
