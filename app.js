const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage() });

let db;
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Initialize Database
(async () => {
    db = await open({ filename: './database.db', driver: sqlite3.Database });
    
    // Core structure
    await db.exec(`
        CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);
        CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER, subtitle TEXT);
        CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, role TEXT, content TEXT);
        
        -- Library for PDF content
        CREATE TABLE IF NOT EXISTS library (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            filename TEXT, 
            content TEXT
        );

        INSERT OR IGNORE INTO topics (id, title) VALUES (0, 'System');
        INSERT OR IGNORE INTO sessions (id, topic_id, subtitle) VALUES (0, 0, 'Quick Chat');
    `);
    try {
        await db.run('ALTER TABLE messages ADD COLUMN book_id INTEGER');
    } catch (e) { /* column already exists */ }
    try {
        await db.run('ALTER TABLE messages ADD COLUMN model TEXT');
    } catch (e) { /* column already exists */ }

    app.listen(3000, () => console.log("Rakesh's Personal AI running at http://localhost:3000"));
})();

// --- LIBRARY ACTIONS ---

app.post('/library/upload', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const parser = new PDFParse({ data: req.file.buffer });
    const data = await parser.getText();
    const result = await db.run('INSERT INTO library (filename, content) VALUES (?, ?)', [req.file.originalname, data.text]);
    res.json({ id: result.lastID, filename: req.file.originalname });
}));

app.get('/library', wrap(async (req, res) => {
    const books = await db.all('SELECT id, filename FROM library');
    res.json(books);
}));

app.delete('/library/:id', wrap(async (req, res) => {
    await db.run('DELETE FROM library WHERE id = ?', [req.params.id]);
    res.json({ success: true });
}));

// --- TOPIC & SESSION ACTIONS ---

app.get('/topics', wrap(async (req, res) => {
    const topics = await db.all('SELECT * FROM topics WHERE id != 0');
    res.json(topics);
}));

app.post('/topics', wrap(async (req, res) => {
    const result = await db.run('INSERT INTO topics (title) VALUES (?)', [req.body.title]);
    res.json({ id: result.lastID });
}));

app.delete('/topics/:id', wrap(async (req, res) => {
    const id = req.params.id;
    await db.run('DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE topic_id = ?)', [id]);
    await db.run('DELETE FROM sessions WHERE topic_id = ?', [id]);
    await db.run('DELETE FROM topics WHERE id = ?', [id]);
    res.json({ success: true });
}));

app.get('/topics/:id/sessions', wrap(async (req, res) => {
    const sessions = await db.all('SELECT * FROM sessions WHERE topic_id = ?', [req.params.id]);
    res.json(sessions);
}));

app.post('/topics/:id/sessions', wrap(async (req, res) => {
    const result = await db.run('INSERT INTO sessions (topic_id, subtitle) VALUES (?, ?)', [req.params.id, req.body.subtitle]);
    res.json({ id: result.lastID });
}));

app.delete('/sessions/:id', wrap(async (req, res) => {
    await db.run('DELETE FROM messages WHERE session_id = ?', [req.params.id]);
    await db.run('DELETE FROM sessions WHERE id = ?', [req.params.id]);
    res.json({ success: true });
}));

app.get('/sessions/:id/messages', wrap(async (req, res) => {
    const messages = await db.all('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC', [req.params.id]);
    res.json(messages);
}));

// --- CHAT LOGIC ---

// How many prior Q&A turns to send (0 = only current; 1 = last exchange; 2 = last 2 exchanges).
// For tutoring: we also always include the first Q&A ("index" reply) so the model can refer back to it.
const MAX_HISTORY_TURNS = 2;
const KEEP_INDEX_IN_CONTEXT = true; // first user + first assistant message always sent when present

app.post('/ask', wrap(async (req, res) => {
    let { prompt, sessionId, model, modelLabel, bookId, bookName } = req.body;
    const activeSession = (sessionId !== undefined && sessionId !== null && sessionId !== '') ? Number(sessionId) : 0;

    // 1. Get context from a single book only (user picks which book)
    const SKIP_FRONT_CHARS = 2000;   // Skip TOC/index at start of book
    const CHARS_BEFORE = 500;        // Chars before each keyword occurrence
    const CHARS_AFTER = 500;         // Chars after (1000 total per occurrence)
    const MAX_SNIPPETS_PER_BOOK = 20; // Cap to avoid blowing context window

    let context = "";
    let book = null;
    if (bookId != null && bookId !== '') {
        book = await db.get('SELECT id, filename, content FROM library WHERE id = ?', [bookId]);
    } else if (bookName != null && String(bookName).trim() !== '') {
        book = await db.get('SELECT id, filename, content FROM library WHERE filename = ?', [String(bookName).trim()]);
    }

    if (book && book.content) {
        const text = book.content;
        const textLower = (text || '').toLowerCase();
        const keywords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        const positions = [];

        for (const k of keywords) {
            let pos = textLower.indexOf(k, SKIP_FRONT_CHARS);
            while (pos !== -1) {
                positions.push(pos);
                pos = textLower.indexOf(k, pos + 1);
            }
        }

        const unique = [...new Set(positions)].sort((a, b) => a - b);

        for (let i = 0; i < Math.min(unique.length, MAX_SNIPPETS_PER_BOOK); i++) {
            const pos = unique[i];
            const start = Math.max(SKIP_FRONT_CHARS, pos - CHARS_BEFORE);
            const end = Math.min(text.length, pos + CHARS_AFTER);
            context += text.substring(start, end) + "\n---\n";
        }
    }

    // 2. Save User Message (and which book was selected for this turn)
    const savedBookId = (bookId != null && bookId !== '') ? Number(bookId) : null;
    await db.run(
        'INSERT INTO messages (session_id, role, content, book_id) VALUES (?, "user", ?, ?)',
        [activeSession, prompt, savedBookId]
    );

    // 3. Prepare Chat History: last N turns + current; optionally keep first Q&A ("index") in context for tutoring
    const history = await db.all("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC", [activeSession]);
    const maxRecent = MAX_HISTORY_TURNS === 0 ? 1 : 2 * MAX_HISTORY_TURNS + 1;
    let combined;
    if (KEEP_INDEX_IN_CONTEXT && history.length > maxRecent && history.length >= 2) {
        const indexMsgs = history.slice(0, 2);
        const recentStart = Math.max(2, history.length - maxRecent);
        combined = indexMsgs.concat(history.slice(recentStart));
    } else {
        combined = history.slice(-maxRecent);
    }
    const messagesForAi = combined.map(m => ({ role: m.role, content: m.content }));

    // 4. Inject Library Context into the latest user prompt if found (from the selected book only)
    if (context) {
        const lastMsgIndex = messagesForAi.length - 1;
        const bookLabel = book ? ` (from "${book.filename || 'book'}")` : '';
        messagesForAi[lastMsgIndex].content = `
            Use the following context from the user's library${bookLabel} to help answer the question.
            LIBRARY CONTEXT:
            ${context}
            
            USER QUESTION: 
            ${prompt}
        `.trim();
    }

    // 5. Stream from Ollama (only send think:true for models that support it)
    const modelId = (model || 'gemma3:latest').toLowerCase();
    const isThinkingModel = /deepseek-r1|deepseek-v3|qwen3|gpt-oss/.test(modelId);
    const isNonThinking = /qwen2\.5|qwen2\.5-coder|gemma/.test(modelId);
    const supportsThinking = isThinkingModel && !isNonThinking;

    try {
        const requestBody = {
            model: model || 'gemma3:latest',
            messages: messagesForAi,
            stream: true
        };
        if (supportsThinking) requestBody.think = true;

        const response = await axios({
            method: 'post',
            url: 'http://127.0.0.1:11434/api/chat',
            data: requestBody,
            responseType: 'stream'
        });

        res.setHeader('Content-Type', 'text/event-stream');
        let fullAiText = "";

        response.data.on('data', chunk => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    const msg = json.message || {};
                    if (msg.thinking != null && msg.thinking !== '') {
                        res.write(`data: ${JSON.stringify({ type: 'thinking', text: msg.thinking })}\n\n`);
                    }
                    if (msg.content != null && msg.content !== '') {
                        fullAiText += msg.content;
                        res.write(`data: ${JSON.stringify({ type: 'content', text: msg.content })}\n\n`);
                    }
                } catch (e) {}
            }
        });

        response.data.on('end', async () => {
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            const savedModelLabel = (modelLabel != null && String(modelLabel).trim() !== '') ? String(modelLabel).trim() : null;
            await db.run(
                'INSERT INTO messages (session_id, role, content, model) VALUES (?, "assistant", ?, ?)',
                [activeSession, fullAiText, savedModelLabel]
            );
            res.end();
        });
    } catch (err) {
        console.error("Ollama error:", err.message);
        res.status(500).json({ error: "Ollama connection failed." });
    }
}));

app.delete('/messages/:id', wrap(async (req, res) => {
    await db.run('DELETE FROM messages WHERE id = ?', [req.params.id]);
    res.json({ success: true });
}));