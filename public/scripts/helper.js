let currentSessionId = 0;

window.onload = () => {
    loadSession(0);
    loadHistory();
};

async function loadSession(id) {
    currentSessionId = id;

    // UI Highlight logic
    document.querySelectorAll('.session-item, .quick-chat-btn').forEach(el => el.classList.remove('active'));
    if (id === 0) {
        document.getElementById('quick-chat-btn').classList.add('active');
    }

    const chatContainer = document.getElementById('chat-container');
    chatContainer.innerHTML = '';

    try {
        const res = await fetch(`/sessions/${id}/messages`);
        const messages = await res.json();

        if (messages.length === 0) {
            appendMsg('ai', id === 0 ? "Quick Chat ready. How can I help?" : "New session started.");
        } else {
            messages.forEach(m => appendMsg(m.role === 'assistant' ? 'ai' : 'user', m.content));
        }
        renderSidebar();
    } catch (err) {
        console.error("Load Session Error:", err);
    }
}

async function renderSidebar() {
    try {
        const res = await fetch('/topics');
        const topics = await res.json();
        const list = document.getElementById('history-list');
        list.innerHTML = '';

        for (const t of topics) {
            const topicGroup = document.createElement('div');
            topicGroup.style.marginBottom = "15px";
            topicGroup.innerHTML = `
                <div class="topic-header" style="display: flex; justify-content: space-between; align-items: center;">
                    <span>📘 ${t.title}</span>
                    <span onclick="deleteTopic(${t.id})" style="cursor:pointer; opacity: 0.5;">🗑️</span>
                </div>
                <div id="sbox-${t.id}" style="padding-left:10px; margin-top: 5px;"></div>
                <button onclick="showSubInput(${t.id})" style="background:none; border:none; color:#666; font-size:11px; cursor:pointer; padding:5px;">+ Session</button>
                <input type="text" id="sub-input-${t.id}" style="display:none; width:100%; background:#222; color:white; border:1px solid #444; font-size:12px; padding:5px; margin-top:5px;" placeholder="Name..." onkeydown="if(event.key==='Enter') saveSubSession(${t.id})">
            `;
            list.appendChild(topicGroup);

            const sRes = await fetch(`/topics/${t.id}/sessions`);
            const sessions = await sRes.json();
            const sContainer = topicGroup.querySelector(`#sbox-${t.id}`);

            sessions.forEach(s => {
                const sItem = document.createElement('div');
                sItem.className = 'session-item' + (currentSessionId === s.id ? ' active' : '');
                sItem.innerHTML = `<span>${s.subtitle}</span><span onclick="event.stopPropagation(); deleteSession(${s.id})" style="font-size:10px; opacity:0.4;">✕</span>`;
                sItem.onclick = () => loadSession(s.id);
                sContainer.appendChild(sItem);
            });
        }
    } catch (e) { console.error("Sidebar Error:", e); }
}

async function loadHistory() { renderSidebar(); }

function showTopicInput() {
    const el = document.getElementById('inline-topic-input');
    el.style.display = 'block';
    el.focus();
}

async function saveInlineTopic() {
    const input = document.getElementById('inline-topic-input');
    const title = input.value.trim();
    if (!title) { input.style.display = 'none'; return; }

    const res = await fetch('/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
    });
    const data = await res.json();
    input.value = ''; input.style.display = 'none';

    await fetch(`/topics/${data.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtitle: "General" })
    });
    loadHistory();
}

function showSubInput(id) { document.getElementById(`sub-input-${id}`).style.display = 'block'; }

async function saveSubSession(topicId) {
    const input = document.getElementById(`sub-input-${topicId}`);
    const subtitle = input.value.trim();
    if (subtitle) {
        const res = await fetch(`/topics/${topicId}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subtitle })
        });
        const data = await res.json();
        loadSession(data.id);
    }
    input.value = ''; input.style.display = 'none';
}

function appendMsg(role, text) {
    const chatContainer = document.getElementById('chat-container');
    const div = document.createElement('div');
    div.className = `message ${role === 'user' ? 'user-message' : 'ai-message'}`;
    div.innerHTML = `<div class="content">${role === 'ai' ? marked.parse(text) : text}</div>`;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return div;
}

async function sendQuery() {
    const pInput = document.getElementById('prompt');
    const promptText = pInput.value.trim();
    if (!promptText) return;

    // Command Interceptor: Matches 'clear', 'clear chat', or 'clear all' (case-insensitive)
    const clearPattern = /^(clear|clear chat|clear all)$/i;

    if (clearPattern.test(promptText)) {
        document.getElementById('chat-container').innerHTML = '';
        pInput.value = '';
        pInput.style.height = 'auto';
        appendMsg('ai', 'Display cleared. Click sidebar to restore history view.');
        return;
    }

    appendMsg('user', promptText);
    pInput.value = '';
    pInput.style.height = 'auto';

    const aiDiv = appendMsg('ai', '...');
    const contentDiv = aiDiv.querySelector('.content');

    try {
        const res = await fetch('/ask', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                prompt: promptText,
                sessionId: currentSessionId,
                model: document.getElementById('model-select').value
            })
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    fullText += JSON.parse(line.substring(6)).text;
                    contentDiv.innerHTML = marked.parse(fullText);
                    document.getElementById('chat-container').scrollTop = document.getElementById('chat-container').scrollHeight;
                }
            }
        }
    } catch (err) { contentDiv.innerHTML = "Error: " + err.message; }
}

async function deleteSession(id) {
    if (confirm("Delete session history?")) {
        await fetch(`/sessions/${id}`, { method: 'DELETE' });
        if (currentSessionId === id) loadSession(0); else loadHistory();
    }
}

async function deleteTopic(id) {
    if (confirm("Delete Topic and all its sessions?")) {
        await fetch(`/topics/${id}`, { method: 'DELETE' });
        loadSession(0);
        loadHistory();
    }
}

document.getElementById('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(); }
});