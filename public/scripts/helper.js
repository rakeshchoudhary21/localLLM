let currentSessionId = 0;

const THEME_STORAGE_KEY = 'rakesh-ai-theme';

function getStoredTheme() {
    try {
        const t = localStorage.getItem(THEME_STORAGE_KEY);
        return (t === 'light' || t === 'dark') ? t : 'dark';
    } catch (_) { return 'dark'; }
}

function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
}

function toggleTheme() {
    const next = document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
}

function toggleSidebarSection(headerEl) {
    if (!headerEl) return;
    const bodyId = headerEl.getAttribute('aria-controls');
    const body = bodyId ? document.getElementById(bodyId) : headerEl.nextElementSibling;
    const expanded = headerEl.getAttribute('aria-expanded') === 'true';
    headerEl.setAttribute('aria-expanded', !expanded);
    if (body) body.classList.toggle('is-collapsed', expanded);
}

function toggleTopicGroup(headerEl) {
    if (!headerEl) return;
    const group = headerEl.closest('.topic-group');
    const body = group && group.querySelector('.topic-group-body');
    const expanded = headerEl.getAttribute('aria-expanded') !== 'false';
    headerEl.setAttribute('aria-expanded', !expanded);
    if (body) body.classList.toggle('is-collapsed', expanded);
    const topicId = headerEl.getAttribute('data-topic-id');
    if (topicId) saveTopicCollapseState(topicId, !expanded);
}

function getTopicCollapseState(topicId) {
    try {
        const raw = localStorage.getItem('rakesh-ai-topic-collapse');
        const state = raw ? JSON.parse(raw) : {};
        return state[topicId] === true;
    } catch (_) { return false; }
}

function saveTopicCollapseState(topicId, collapsed) {
    try {
        const raw = localStorage.getItem('rakesh-ai-topic-collapse') || '{}';
        const state = JSON.parse(raw);
        state[topicId] = collapsed;
        localStorage.setItem('rakesh-ai-topic-collapse', JSON.stringify(state));
    } catch (_) {}
}

window.onload = () => {
    applyTheme(getStoredTheme());
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    const libraryHeader = document.getElementById('library-section-header');
    if (libraryHeader) libraryHeader.addEventListener('click', () => toggleSidebarSection(libraryHeader));
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
            <span class="library-item-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><path d="M8 7h8"/><path d="M8 11h8"/></svg>
            </span>
            <span class="library-item-name" title="${escapeHtml(b.filename)}">${escapeHtml(b.filename.length > 18 ? b.filename.substring(0, 18) + '…' : b.filename)}</span>
            <button type="button" class="delete-btn library-item-delete" onclick="deleteBook(${b.id})" title="Remove from library" aria-label="Remove">×</button>
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function renderSidebar() {
    try {
        const res = await fetch('/topics');
        const topics = await res.json();
        const sessionsByTopicId = await Promise.all(
            topics.map(t => fetch(`/topics/${t.id}/sessions`).then(r => r.json()))
        );

        const fragment = document.createDocumentFragment();
        topics.forEach((t, i) => {
            const sessions = sessionsByTopicId[i] || [];
            const collapsed = getTopicCollapseState(String(t.id));
            const topicGroup = document.createElement('div');
            topicGroup.className = 'topic-group';
            topicGroup.innerHTML = `
                <div class="topic-group-header" data-topic-id="${t.id}" aria-expanded="${!collapsed}" aria-controls="sbox-${t.id}">
                    <button type="button" class="topic-group-header-trigger">
                        <span class="topic-group-chevron" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                        </span>
                        <span class="topic-group-title">${escapeHtml(t.title)}</span>
                    </button>
                    <button type="button" class="delete-btn delete-btn-icon delete-topic-btn" onclick="event.stopPropagation(); deleteTopic(${t.id})" title="Delete topic" aria-label="Delete topic"><span class="delete-btn-icon-inner"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></span></button>
                </div>
                <div class="topic-group-body" id="sbox-${t.id}" ${collapsed ? ' class="is-collapsed"' : ''}>
                    <div class="topic-group-body-inner">
                        <div class="topic-group-sessions"></div>
                        <button type="button" class="sidebar-action-link add-session-link" onclick="event.stopPropagation(); showSubInput(${t.id})">
                            <span class="add-session-icon" aria-hidden="true">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                            </span>
                            Session
                        </button>
                        <input type="text" id="sub-input-${t.id}" class="sidebar-inline-input sidebar-sub-input" style="display:none;" placeholder="Session name..." onkeydown="if(event.key==='Enter') saveSubSession(${t.id})">
                    </div>
                </div>
            `;

            const headerEl = topicGroup.querySelector('.topic-group-header');
            const headerTrigger = topicGroup.querySelector('.topic-group-header-trigger');
            if (headerTrigger) headerTrigger.addEventListener('click', () => toggleTopicGroup(headerEl));

            const sContainer = topicGroup.querySelector('.topic-group-sessions');
            if (sContainer) {
                sessions.forEach(s => {
                    const sItem = document.createElement('div');
                    sItem.className = 'session-item' + (currentSessionId === s.id ? ' active' : '');
                    sItem.innerHTML = `
                        <span class="session-item-dot" aria-hidden="true"></span>
                        <span class="session-item-label">${escapeHtml(s.subtitle)}</span>
                        <button type="button" class="delete-btn delete-btn-icon delete-session-btn" onclick="event.stopPropagation(); deleteSession(${s.id})" title="Delete chat" aria-label="Delete chat"><span class="delete-btn-icon-inner"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></span></button>
                    `;
                    sItem.onclick = (e) => { if (!e.target.closest('.delete-session-btn')) loadSession(s.id); };
                    sContainer.appendChild(sItem);
                });
            }
            fragment.appendChild(topicGroup);
        });

        const list = document.getElementById('history-list');
        list.innerHTML = '';
        list.appendChild(fragment);
    } catch (e) { console.error(e); }
}

function injectCodeBlockCopyButtons(container) {
    if (!container) return;
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.closest('.code-block-wrapper')) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        const codeEl = pre.querySelector('code') || pre;
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'code-block-copy';
        copyBtn.textContent = 'Copy';
        copyBtn.title = 'Copy code';
        copyBtn.setAttribute('aria-label', 'Copy code');
        copyBtn.addEventListener('click', () => {
            const text = codeEl.textContent || '';
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = 'Copy';
                    copyBtn.classList.remove('copied');
                }, 2000);
            });
        });
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);
        wrapper.appendChild(copyBtn);
    });
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
    if (role === 'ai') injectCodeBlockCopyButtons(div.querySelector('.content'));
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
                        injectCodeBlockCopyButtons(contentDiv);
                        document.getElementById('chat-container').scrollTop = document.getElementById('chat-container').scrollHeight;
                    } else if (data.type === 'done') {
                        if (thinkingBlock) {
                            thinkingBlock.style.display = 'none';
                            if (thinkingContent) thinkingContent.textContent = '';
                        }
                        contentDiv.innerHTML = marked.parse(fullText);
                        injectCodeBlockCopyButtons(contentDiv);
                        document.getElementById('chat-container').scrollTop = document.getElementById('chat-container').scrollHeight;
                    } else if (text !== undefined && data.type !== 'thinking') {
                        // Legacy: plain { text } without type
                        fullText += text;
                        contentDiv.innerHTML = marked.parse(fullText);
                        injectCodeBlockCopyButtons(contentDiv);
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
        injectCodeBlockCopyButtons(contentDiv);
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