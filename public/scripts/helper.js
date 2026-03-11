let currentSessionId = 0;

window.onload = () => {
    loadSession(0);
    renderSidebar();
    renderLibrary();
};

function showUploadProgress(show, options = {}) {
    const wrap = document.getElementById('upload-progress-wrap');
    const bar = document.getElementById('upload-progress-bar');
    const label = document.getElementById('upload-progress-label');
    if (!wrap || !bar || !label) return;

    if (!show) {
        wrap.style.display = 'none';
        bar.style.width = '0%';
        bar.classList.remove('indeterminate');
        return;
    }

    wrap.style.display = 'block';
    label.textContent = options.label || 'Uploading…';
    if (options.indeterminate) {
        bar.classList.add('indeterminate');
        bar.style.width = '100%';
    } else {
        bar.classList.remove('indeterminate');
        bar.style.width = (options.percent != null ? options.percent : 0) + '%';
    }
}

async function uploadBook(input) {
    if (!input || !input.files || !input.files[0]) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);

    showUploadProgress(true, { label: 'Uploading…', percent: 0 });

    await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                if (percent >= 100) {
                    showUploadProgress(true, { label: 'Processing PDF…', indeterminate: true });
                } else {
                    showUploadProgress(true, { label: `Uploading… ${percent}%`, percent });
                }
            } else {
                showUploadProgress(true, { label: 'Uploading…' });
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                showUploadProgress(true, { label: 'Processing PDF…', indeterminate: true });
                try {
                    const data = JSON.parse(xhr.responseText);
                    showUploadProgress(true, { label: `Added "${(data.filename || file.name).substring(0, 30)}…" to library ✓` });
                    renderLibrary();
                    setTimeout(() => showUploadProgress(false), 2000);
                } catch (_) {
                    showUploadProgress(true, { label: 'Added to library ✓' });
                    renderLibrary();
                    setTimeout(() => showUploadProgress(false), 2000);
                }
            } else {
                showUploadProgress(true, { label: 'Upload failed' });
                setTimeout(() => showUploadProgress(false), 2500);
            }
            resolve();
        });

        xhr.addEventListener('error', () => {
            showUploadProgress(true, { label: 'Upload failed' });
            setTimeout(() => showUploadProgress(false), 2500);
            resolve();
        });

        xhr.open('POST', '/library/upload');
        xhr.send(formData);
    });

    input.value = '';
}

async function renderLibrary() {
    const res = await fetch('/library');
    const books = await res.json();
    const list = document.getElementById('library-list');
    list.innerHTML = books.map(b => `
        <div class="library-item">
            <span title="${b.filename}">📖 ${b.filename.length > 18 ? b.filename.substring(0, 18) + '…' : b.filename}</span>
            <span onclick="deleteBook(${b.id})" style="cursor:pointer">✕</span>
        </div>
    `).join('');

    const bookSelect = document.getElementById('book-select');
    if (bookSelect) {
        bookSelect.innerHTML = '<option value="">No book</option>' + books.map(b => 
            `<option value="${b.id}">${b.filename.length > 40 ? b.filename.substring(0, 40) + '…' : b.filename}</option>`
        ).join('');
        bookSelect.value = '';
    }
}

async function deleteBook(id) {
    if (confirm("Remove this book from library?")) {
        await fetch(`/library/${id}`, { method: 'DELETE' });
        renderLibrary();
    }
}

async function loadSession(id) {
    currentSessionId = id;
    document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
    const homeBrand = document.querySelector('.top-bar-brand');
    if (homeBrand) homeBrand.classList.toggle('active', id === 0);

    const chatContainer = document.getElementById('chat-container');
    chatContainer.innerHTML = '';

    try {
        const res = await fetch(`/sessions/${id}/messages`);
        const messages = await res.json();
        if (messages.length === 0) {
            appendMsg('ai', id === 0 ? "Welcome Home, Rakesh." : "New study session started.");
        } else {
            messages.forEach(m => appendMsg(m.role === 'assistant' ? 'ai' : 'user', m.content, m.id, m.role === 'assistant' ? (m.model || null) : null));
        }
        renderSidebar();
    } catch (err) { console.error(err); }
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
                <div class="topic-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <span>📘 ${t.title}</span>
                    <button type="button" class="delete-btn delete-topic-btn" onclick="event.stopPropagation(); deleteTopic(${t.id})" title="Delete topic" aria-label="Delete topic"></button>
                </div>
                <div id="sbox-${t.id}" style="padding-left:10px; margin-top:5px;"></div>
                <button onclick="showSubInput(${t.id})" style="background:none; border:none; color:#666; font-size:11px; cursor:pointer;">+ Session</button>
                <input type="text" id="sub-input-${t.id}" style="display:none; width:100%; background:#2d2d2d; color:white; border:1px solid #444; padding:5px; margin-top:5px;" onkeydown="if(event.key==='Enter') saveSubSession(${t.id})">
            `;
            list.appendChild(topicGroup);

            const sRes = await fetch(`/topics/${t.id}/sessions`);
            const sessions = await sRes.json();
            const sContainer = topicGroup.querySelector(`#sbox-${t.id}`);
            sessions.forEach(s => {
                const sItem = document.createElement('div');
                sItem.className = 'session-item' + (currentSessionId === s.id ? ' active' : '');
                sItem.innerHTML = `<span>${s.subtitle}</span><button type="button" class="delete-btn delete-session-btn" onclick="event.stopPropagation(); deleteSession(${s.id})" title="Delete chat" aria-label="Delete chat"></button>`;
                sItem.onclick = () => loadSession(s.id);
                sContainer.appendChild(sItem);
            });
        }
    } catch (e) { console.error(e); }
}

function appendMsg(role, text, msgId = null, modelLabel = null) {
    const chatContainer = document.getElementById('chat-container');
    const div = document.createElement('div');
    div.className = `message ${role === 'user' ? 'user-message' : 'ai-message'}`;

    let headerLabel = modelLabel || (role === 'ai' ? "AI Knowledge Results" : "");
    let headerHtml = (role === 'ai') ? `<h3>${headerLabel} <span class="loader-target"></span></h3>` : '';
    let bodyContent = (role === 'ai') ? (text ? marked.parse(text) : '') : text;
    let loadingClass = (role === 'ai' && !text) ? 'loading' : '';
    const thinkingBlock = (role === 'ai') ? `<div class="thinking-block" style="display:none"><span class="thinking-label">Thinking…</span><div class="thinking-content"></div></div>` : '';

    div.innerHTML = `
        <button type="button" class="delete-btn delete-msg-btn" onclick="deleteSingleMessage(${msgId}, this)" title="Delete message" aria-label="Delete message"></button>
        ${headerHtml}
        ${thinkingBlock}
        <div class="content ${loadingClass}">${bodyContent || (role === 'ai' ? 'Consulting local brain...' : '')}</div>
    `;

    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return div;
}

async function sendQuery() {
    const pInput = document.getElementById('prompt');
    const modelSelect = document.getElementById('model-select');
    const modelName = modelSelect.options[modelSelect.selectedIndex].text;
    const promptText = pInput.value.trim();
    if (!promptText) return;

    appendMsg('user', promptText);
    pInput.value = '';
    pInput.style.height = '44px';

    const aiDiv = appendMsg('ai', '', null, modelName);
    const contentDiv = aiDiv.querySelector('.content');
    const thinkingBlock = aiDiv.querySelector('.thinking-block');
    const thinkingContent = aiDiv.querySelector('.thinking-content');
    const loaderTarget = aiDiv.querySelector('.loader-target');
    loaderTarget.innerHTML = '<div class="spinner"></div>';

    try {
        const res = await fetch('/ask', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
            prompt: promptText,
            sessionId: (currentSessionId !== undefined && currentSessionId !== null) ? Number(currentSessionId) : 0,
            model: modelSelect.value,
            modelLabel: modelName,
            bookId: (document.getElementById('book-select') || {}).value || undefined
        })
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        let firstChunk = true;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (firstChunk) {
                loaderTarget.innerHTML = '';
                contentDiv.classList.remove('loading');
                contentDiv.innerHTML = '';
                firstChunk = false;
            }

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const data = JSON.parse(line.substring(6));
                    const text = data.text;

                    if (data.type === 'thinking' && text !== undefined) {
                        if (thinkingBlock && thinkingContent) {
                            thinkingBlock.style.display = 'block';
                            thinkingContent.textContent += text;
                            thinkingContent.scrollTop = thinkingContent.scrollHeight;
                        }
                        document.getElementById('chat-container').scrollTop = document.getElementById('chat-container').scrollHeight;
                    } else if (data.type === 'content' && text !== undefined) {
                        fullText += text;
                        contentDiv.innerHTML = marked.parse(fullText);
                        document.getElementById('chat-container').scrollTop = document.getElementById('chat-container').scrollHeight;
                    } else if (data.type === 'done') {
                        if (thinkingBlock) {
                            thinkingBlock.style.display = 'none';
                            if (thinkingContent) thinkingContent.textContent = '';
                        }
                        contentDiv.innerHTML = marked.parse(fullText);
                        document.getElementById('chat-container').scrollTop = document.getElementById('chat-container').scrollHeight;
                    } else if (text !== undefined && data.type !== 'thinking') {
                        // Legacy: plain { text } without type
                        fullText += text;
                        contentDiv.innerHTML = marked.parse(fullText);
                        document.getElementById('chat-container').scrollTop = document.getElementById('chat-container').scrollHeight;
                    }
                } catch (e) {}
            }
        }
        // Ensure thinking is hidden and final answer shown when stream ends normally
        if (thinkingBlock) {
            thinkingBlock.style.display = 'none';
            if (thinkingContent) thinkingContent.textContent = '';
        }
        contentDiv.innerHTML = marked.parse(fullText);
    } catch (err) {
        loaderTarget.innerHTML = '';
        contentDiv.innerHTML = "Error: Local AI connection lost.";
    }
}

function showTopicInput() { const el = document.getElementById('inline-topic-input'); el.style.display = 'block'; el.focus(); }
async function saveInlineTopic() {
    const input = document.getElementById('inline-topic-input');
    const title = input.value.trim();
    if (!title) { input.style.display = 'none'; return; }
    const res = await fetch('/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    const data = await res.json();
    input.value = ''; input.style.display = 'none';
    await fetch(`/topics/${data.id}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subtitle: "General" }) });
    renderSidebar();
}
function showSubInput(id) { document.getElementById(`sub-input-${id}`).style.display = 'block'; }
async function saveSubSession(topicId) {
    const input = document.getElementById(`sub-input-${topicId}`);
    const subtitle = input.value.trim();
    if (subtitle) {
        const res = await fetch(`/topics/${topicId}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subtitle }) });
        const data = await res.json();
        loadSession(data.id);
    }
    input.value = ''; input.style.display = 'none';
}
async function deleteSingleMessage(msgId, btn) {
    if (msgId && confirm("Delete message?")) {
        await fetch(`/messages/${msgId}`, { method: 'DELETE' });
        btn.parentElement.remove();
    } else if (!msgId) btn.parentElement.remove();
}
async function deleteSession(id) { if (confirm("Delete session?")) { await fetch(`/sessions/${id}`, { method: 'DELETE' }); if (currentSessionId === id) loadSession(0); else renderSidebar(); } }
async function deleteTopic(id) { if (confirm("Delete topic?")) { await fetch(`/topics/${id}`, { method: 'DELETE' }); loadSession(0); renderSidebar(); } }

document.getElementById('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(); } });