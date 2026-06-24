// public/script.js

// --- Core Engine & Type-Safe State ---
let projects = JSON.parse(localStorage.getItem('rashboard_v13')) || [];
let tempParsedVars = []; 
let editingProjectId = null;
let activeTabs = JSON.parse(localStorage.getItem('rashboard_tabs')) || {}; 
let expandedCards = new Set(JSON.parse(localStorage.getItem('rashboard_expanded') || '[]'));
let searchTerm = '';

const DEFAULT_CATEGORIES = ['General', 'Database', 'Backend', 'Storage', 'AppScript', 'Frontend', 'Auth'];

const SERVICES = [
    { name: 'Supabase', regex: /https:\/\/([a-z0-9]+)\.supabase\.co/i, getUrl: m => `https://supabase.com/dashboard/project/${m[1]}`, color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
    { name: 'Render', regex: /\.onrender\.com/i, getUrl: () => `https://dashboard.render.com/`, color: 'text-purple-500 bg-purple-500/10 border-purple-500/20' },
    { name: 'Neon', regex: /\.neon\.tech/i, getUrl: () => `https://console.neon.tech/`, color: 'text-teal-500 bg-teal-500/10 border-teal-500/20' },
    { name: 'Clerk', regex: /clerk\./i, getUrl: () => `https://dashboard.clerk.com/`, color: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20' },
    { name: 'Stripe', regex: /sk_live|pk_live|sk_test|pk_test/i, getUrl: () => `https://dashboard.stripe.com/`, color: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
    { name: 'Vercel', regex: /\.vercel\.app/i, getUrl: () => `https://vercel.com/dashboard`, color: 'text-accent bg-elevated border-borderline/20' }
];

// --- THE BOOT SEQUENCE ---
window.onload = () => {
    init();
    switchView('workspace');
    
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if(splash) {
            splash.style.opacity = '0';
            splash.style.pointerEvents = 'none';
            setTimeout(() => splash.style.display = 'none', 700);
        }
    }, 1400); 
};

// --- DYNAMIC BACKGROUND SYNC ---
async function syncToBackend() {
    try {
        await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projects: JSON.parse(localStorage.getItem('rashboard_v13') || '[]') })
        });
    } catch(e) { console.error("Failed to sync with backend", e); }
}

// --- 📜 PERSISTENT CHAT HISTORY LOGIC ---
async function loadChatHistory() {
    try {
        const res = await fetch('/api/history');
        const data = await res.json();
        
        if (data.history && data.history.length > 0) {
            const wrapper = document.getElementById('chat-content-wrapper');
            wrapper.innerHTML = ''; // Clears the default message
            
            data.history.forEach(msg => {
                const isUser = msg.role === 'user';
                const div = document.createElement('div');
                div.className = `p-4 rounded-2xl max-w-[90%] md:max-w-[80%] text-sm shadow-inner-light leading-relaxed animate-slide-up ${isUser ? 'chat-bubble-user' : 'chat-bubble-agent'}`;
                div.innerHTML = msg.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                wrapper.appendChild(div);
            });

            const chatBox = document.getElementById('chat-box');
            setTimeout(() => chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' }), 100);
        }
    } catch(e) { console.error("No history found."); }
}

async function clearChat() {
    if(confirm("Wipe all AI chat history? This cannot be undone.")) {
        try {
            await fetch('/api/history', { method: 'DELETE' });
            const wrapper = document.getElementById('chat-content-wrapper');
            wrapper.innerHTML = `
                <div class="chat-bubble-agent p-4 rounded-2xl max-w-[90%] md:max-w-[80%] text-sm shadow-inner-light animate-slide-up">
                    <p>System memory wiped. Ready for new commands.</p>
                </div>`;
            showToast("Chat history cleared", "success");
        } catch(e) { showToast("Failed to clear history", "error"); }
    }
}

function init() {
    if (projects.length === 0 && localStorage.getItem('rashboard_v12')) {
        projects = JSON.parse(localStorage.getItem('rashboard_v12'));
        localStorage.setItem('rashboard_v13', JSON.stringify(projects));
    }
    
    projects.forEach(p => { const keys = Object.keys(p.tabs || {}); if(keys.length && !activeTabs[p.id]) activeTabs[p.id] = keys[0]; });
    saveStateMeta();
    setupKeyboardShortcuts();
    renderProjects();
    pingAll();
    
    syncToBackend(); 
    loadChatHistory(); // Auto-loads chats on boot!
    
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
            if (modal.classList.contains('active')) {
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
        document.getElementById(`nav-btn-${v}`).className = `nav-btn flex items-center gap-3 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${isV ? 'bg-elevated/50 text-accent border border-borderline/5 shadow-inner-light' : 'text-muted hover:text-accent hover:bg-elevated/30 border border-transparent'}`;
        document.getElementById(`mob-nav-btn-${v}`).className = `mob-nav-btn flex items-center justify-center w-12 h-12 rounded-full transition-colors ${isV ? 'bg-elevated/80 text-accent' : 'text-muted hover:text-accent'}`;
    });
}

function handleSearch(val) { searchTerm = val.toLowerCase().trim(); renderProjects(); }
function clearSearch() { document.getElementById('global-search').value = ''; handleSearch(''); }
function toggleGhPagesInput(isChecked) {
    const container = document.getElementById('gh-pages-custom-container');
    if(isChecked) container.classList.add('hidden'); else container.classList.remove('hidden');
}

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
    const grid = document.getElementById('project-grid'); const emptyState = document.getElementById('empty-state');
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
    }).join(''); if(!searchTerm) pingAll();
}

function switchTab(projectId, tabName) { activeTabs[projectId] = tabName; saveStateMeta(); renderProjects(); }
function toggleExpand(projectId) { expandedCards.has(projectId) ? expandedCards.delete(projectId) : expandedCards.add(projectId); saveStateMeta(); renderProjects(); }
function copyText(t, k) { navigator.clipboard.writeText(t).then(() => showToast(`Value for ${k} secured to clipboard`, "success")); }

function openCreator() { editingProjectId = null; document.getElementById('proj-name').value = ''; document.getElementById('proj-live-url').value = ''; document.getElementById('proj-gh').value = ''; document.getElementById('env-input').value = ''; showModalStep(1); }
function editProject(id) { const p = projects.find(x => x.id === id); if (!p) return; editingProjectId = id; document.getElementById('proj-name').value = p.name || ''; document.getElementById('proj-live-url').value = p.liveUrl || ''; document.getElementById('proj-gh').value = p.ghRepo || ''; let raw = ""; for (const t in (p.tabs || {})) (p.tabs[t] || []).forEach(v => { if(v.key) raw += `${v.key}=${v.value}\n`; }); document.getElementById('env-input').value = raw.trim(); showModalStep(1); }
function handleBackdropClick(e) { if(e.target === e.currentTarget) closeCreator(); }
function showModalStep(step) { document.getElementById('creator-backdrop').classList.add('active'); if (step === 1) { document.getElementById('step-1').classList.remove('hidden'); document.getElementById('step-2').classList.add('hidden'); document.getElementById('step-2').classList.remove('flex'); } else { document.getElementById('step-1').classList.add('hidden'); document.getElementById('step-2').classList.remove('hidden'); document.getElementById('step-2').classList.add('flex'); } }
function closeCreator() { document.getElementById('creator-backdrop').classList.remove('active'); tempParsedVars = []; }
function backToStep1() { showModalStep(1); }

function processEnv() {
    const n = document.getElementById('proj-name').value.trim(), e = document.getElementById('env-input').value;
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
    showModalStep(2); renderCategorizationStep();
}

function renderCategorizationStep() {
    const list = document.getElementById('parsed-vars-list');
    if (!tempParsedVars.length) { list.innerHTML = `<div class="text-center py-10 text-muted text-sm border border-dashed border-borderline/20 rounded-xl bg-base">No variables extracted. Setup is currently blank.</div>`; return; }
    list.innerHTML = tempParsedVars.map((v, i) => `<div class="flex flex-col md:flex-row gap-3 items-start md:items-center bg-elevated/50 p-4 rounded-xl border border-borderline/10 shadow-inner-light"><div class="flex-grow w-full md:w-auto flex flex-col gap-1.5"><input type="text" value="${v.key || ''}" onchange="updateTempVar(${i}, 'key', this.value)" class="w-full bg-transparent border-b border-borderline/10 px-1 py-1 text-sm font-bold text-accent outline-none focus:border-accent transition-colors"><input type="text" value="${v.value || ''}" onchange="updateTempVar(${i}, 'value', this.value)" class="w-full bg-transparent border-b border-borderline/10 px-1 py-1 text-[11px] font-mono text-muted outline-none focus:border-accent transition-colors"></div><div class="flex items-center gap-2 w-full md:w-auto shrink-0"><select onchange="updateTempVar(${i}, 'tab', this.value)" class="flex-1 md:w-36 bg-surface border border-borderline/10 text-xs text-accent font-semibold rounded-lg px-2 py-2 outline-none shadow-inner-light">${DEFAULT_CATEGORIES.map(cat => `<option value="${cat}" ${v.tab === cat ? 'selected' : ''}>${cat}</option>`).join('')}<option value="NEW">+ Custom...</option></select><button onclick="removeTempVar(${i})" class="w-9 h-9 rounded-lg bg-surface border border-borderline/10 flex items-center justify-center text-muted hover:text-red-500 hover:border-red-500/30 transition-all shrink-0"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></div></div>`).join('');
}

function addNewRow() { tempParsedVars.push({ key: '', value: '', tab: 'General' }); renderCategorizationStep(); }
function removeTempVar(index) { tempParsedVars.splice(index, 1); renderCategorizationStep(); }
function updateTempVar(index, field, val) { tempParsedVars[index][field] = val; }

function saveProject() {
    const n = document.getElementById('proj-name').value.trim(); const l = document.getElementById('proj-live-url').value.trim(); const g = document.getElementById('proj-gh').value.trim();
    const grp = {}; tempParsedVars.filter(v => v.key || v.value).forEach(v => { const t = v.tab || 'General'; if (!grp[t]) grp[t] = []; grp[t].push({ key: v.key, value: v.value }); });
    if (editingProjectId) { const i = projects.findIndex(p => p.id === editingProjectId); if (i > -1) { projects[i] = { ...projects[i], name: n, liveUrl: l, ghRepo: g, tabs: grp }; } } else { const id = crypto.randomUUID(); projects.unshift({ id, name: n, liveUrl: l, ghRepo: g, tabs: grp }); activeTabs[id] = Object.keys(grp)[0] || null; }
    localStorage.setItem('rashboard_v13', JSON.stringify(projects)); saveStateMeta(); renderProjects(); pingAll(); syncToBackend(); closeCreator(); showToast("System synchronized", "success");
}

function deleteProject(id) { if(confirm("Delete environment?")) { projects = projects.filter(p => p.id !== id); delete activeTabs[id]; expandedCards.delete(id); localStorage.setItem('rashboard_v13', JSON.stringify(projects)); saveStateMeta(); renderProjects(); syncToBackend(); } }
function exportData() { if(!projects.length) return; const str = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(projects, null, 2)); const a = document.createElement('a'); a.href = str; a.download = `rashboard-vault-${new Date().toISOString().split('T')[0]}.json`; a.click(); showToast("Vault exported securely", "success"); }
function importData(e) { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = event => { try { const imp = JSON.parse(event.target.result); if (Array.isArray(imp)) { projects = imp; localStorage.setItem('rashboard_v13', JSON.stringify(projects)); projects.forEach(p => { const k = Object.keys(p.tabs || {}); if(k.length) activeTabs[p.id] = k[0]; }); saveStateMeta(); switchView('workspace'); renderProjects(); pingAll(); syncToBackend(); showToast("System restored", "success"); } } catch(err) { showToast("Failed reading payload", "error"); } }; r.readAsText(f); e.target.value = ""; }
function clearAllData() { if(confirm("Wipe all local Rashboard data? Cannot be undone.")) { projects = []; localStorage.removeItem('rashboard_v13'); renderProjects(); syncToBackend(); showToast("System wiped", "success"); } }

function showToast(msg, type = "success") {
    const t = document.getElementById('toast'), i = document.getElementById('toast-icon'); document.getElementById('toast-msg').innerText = msg;
    i.className = `w-5 h-5 shrink-0 rounded-full flex items-center justify-center border ${type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-500' : 'border-blue-500/30 bg-blue-500/10 text-blue-500'}`;
    i.innerHTML = type === 'error' ? '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>' : '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>';
    t.classList.remove('opacity-0', 'pointer-events-none'); t.classList.remove(window.innerWidth < 768 ? '-translate-y-20' : 'translate-y-20'); t.classList.add('translate-y-0');
    setTimeout(() => { t.classList.add('opacity-0', 'pointer-events-none'); t.classList.remove('translate-y-0'); t.classList.add(window.innerWidth < 768 ? '-translate-y-20' : 'translate-y-20'); }, 3000);
}

function forcePing(id) { const p = projects.find(x => x.id === id); if(p) autoPingMainUrl(p); }
function pingAll() { projects.forEach(p => autoPingMainUrl(p)); }

async function autoPingMainUrl(p) {
    const d = document.getElementById(`status-${p.id}`); if (!d) return; let u = p.liveUrl; 
    if (!u) { const safeTabs = p.tabs || {}; for (const t in safeTabs) { const f = (safeTabs[t] || []).find(c => c.value && c.value.startsWith('http')); if (f) { u = f.value; break; } } }
    if (!u) { d.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-muted"></span><span class="text-[9px] text-muted font-bold tracking-widest uppercase">IDLE</span>`; return; }
    d.innerHTML = `<span class="flex h-1.5 w-1.5 relative"><span class="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75"></span><span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span></span><span class="text-[9px] text-blue-500 font-bold tracking-widest uppercase">PINGING</span>`;
    const c = new AbortController(); const tId = setTimeout(() => c.abort(), 3500);
    try { await fetch(u, { mode: 'no-cors', signal: c.signal, cache: 'no-store' }); clearTimeout(tId); d.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span><span class="text-[9px] text-emerald-500 font-bold tracking-widest uppercase">ONLINE</span>`;
    } catch (err) { if (err.name === 'AbortError') { d.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse"></span><span class="text-[9px] text-amber-500 font-bold tracking-widest uppercase">WAKING SERVER</span>`; setTimeout(() => autoPingMainUrl(p), 8000); } else { d.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></span><span class="text-[9px] text-red-500 font-bold tracking-widest uppercase">OFFLINE</span>`; } }
}

// --- 🎙️ VOICE ENGINE & AGENT LOGIC ---
let voiceResponseEnabled = false;
const voiceToggleBtn = document.getElementById('voice-toggle-btn'); const voiceIcon = document.getElementById('voice-icon'); const voiceStatusText = document.getElementById('voice-status-text');
voiceToggleBtn.addEventListener('click', () => { voiceResponseEnabled = !voiceResponseEnabled; if (voiceResponseEnabled) { voiceStatusText.textContent = "AUDIO ON"; voiceToggleBtn.classList.replace('text-muted', 'text-blue-400'); voiceIcon.classList.replace('text-muted', 'text-blue-400'); voiceIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.898a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path>`; } else { voiceStatusText.textContent = "SILENT"; voiceToggleBtn.classList.replace('text-blue-400', 'text-muted'); voiceIcon.classList.replace('text-blue-400', 'text-muted'); window.speechSynthesis.cancel(); voiceIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clip-rule="evenodd"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>`; } });
function speakAgentText(text) { if (!voiceResponseEnabled || !window.speechSynthesis) return; window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text.replace(/[*#]/g, '').replace(/_/g, ' ')); utterance.rate = 1.05; utterance.pitch = 1.0; window.speechSynthesis.speak(utterance); }

const micBtn = document.getElementById('mic-btn'); const messageInput = document.getElementById('message-input'); const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition; let recognition = null; let isListening = false;
if (SpeechRecognition) {
    recognition = new SpeechRecognition(); recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US';
    recognition.onstart = () => { isListening = true; micBtn.classList.add('mic-active', 'animate-pulse-fast'); messageInput.placeholder = "Listening..."; messageInput.disabled = true; };
    recognition.onresult = (e) => { messageInput.value = e.results[0][0].transcript; document.getElementById('chat-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); };
    recognition.onerror = () => resetMicState(); recognition.onend = () => resetMicState();
    micBtn.addEventListener('click', () => { if (isListening) recognition.stop(); else { try { recognition.start(); } catch (e) {} } });
} else { micBtn.style.display = 'none'; messageInput.classList.remove('pl-12'); messageInput.classList.add('pl-4'); }
function resetMicState() { isListening = false; micBtn.classList.remove('mic-active', 'animate-pulse-fast'); messageInput.placeholder = "Ask agent..."; messageInput.disabled = false; }

const chatForm = document.getElementById('chat-form'); const chatBox = document.getElementById('chat-box'); const chatWrapper = document.getElementById('chat-content-wrapper'); const sendBtn = document.getElementById('send-btn');
function appendMessage(text, isUser) {
    const div = document.createElement('div'); div.className = `p-4 rounded-2xl max-w-[90%] md:max-w-[80%] text-sm shadow-inner-light animate-slide-up leading-relaxed ${isUser ? 'chat-bubble-user' : 'chat-bubble-agent'}`;
    div.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); chatWrapper.appendChild(div);
    setTimeout(() => { chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' }); }, 50);
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault(); const message = messageInput.value.trim(); if (!message) return;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    appendMessage(message, true); messageInput.value = ''; sendBtn.innerHTML = `<span class="w-4 h-4 border-2 border-accentInv border-t-transparent rounded-full animate-spin"></span>`; sendBtn.disabled = true;
    try {
        const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
        const data = await response.json(); appendMessage(data.response, false); speakAgentText(data.response);
    } catch (error) { appendMessage("System Error: Failed to reach the Core router.", false); } finally {
        sendBtn.innerHTML = `<span class="hidden md:inline">SEND</span><svg class="w-4 h-4 md:w-3 md:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>`;
        sendBtn.disabled = false; if (window.innerWidth > 768 && !isListening) messageInput.focus();
    }
});
