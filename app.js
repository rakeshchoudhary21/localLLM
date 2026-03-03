const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const app = express();

app.use(express.json());
app.use(express.static('public'));

let db;
// Standard async wrapper to catch errors
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

(async () => {
    db = await open({ filename: './database.db', driver: sqlite3.Database });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);
        CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER, subtitle TEXT);
        CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, role TEXT, content TEXT);

        -- Use ID 0 for the Quick Chat system. 
        -- This ensures frontend loadSession(0) always finds the right data.
        INSERT OR IGNORE INTO topics (id, title) VALUES (0, 'System');
        INSERT OR IGNORE INTO sessions (id, topic_id, subtitle) VALUES (0, 0, 'Quick Chat');
    `);

    app.listen(3000, () => console.log('Study App running at http://localhost:3000'));
})();

// --- API ROUTES ---

// GET topics (Exclude the System topic ID 0 from the sidebar list)
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
    // Explicitly fetching by session_id ensures history is never lost on switch
    const messages = await db.all('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC', [req.params.id]);
    res.json(messages);
}));

app.post('/ask', wrap(async (req, res) => {
    const { prompt, sessionId, model } = req.body;
    const activeSession = (sessionId === undefined || sessionId === null) ? 0 : sessionId;

    // 1. Get previous messages for this session from the global 'db' variable
    // This allows the new model to see what the previous model said
    const history = await db.all(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC",
        [activeSession]
    );

    // 2. Format history for Ollama (role must be 'assistant' or 'user')
    const messages = history.map(m => ({
        role: m.role,
        content: m.content
    }));

    // 3. Add the NEW user prompt to the history array
    messages.push({ role: 'user', content: prompt });

    // 4. Save the NEW user prompt to the database immediately
    await db.run('INSERT INTO messages (session_id, role, content) VALUES (?, "user", ?)', [activeSession, prompt]);

    try {
        const response = await axios({
            method: 'post',
            url: 'http://127.0.0.1:11434/api/chat',
            data: {
                model: model || 'gemma3:4b',
                messages: messages, // Send the WHOLE conversation history here
                stream: true
            },
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
                    // Note: Ollama /api/chat uses json.message.content
                    if (json.message && json.message.content) {
                        const content = json.message.content;
                        fullAiText += content;
                        res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
                    }
                } catch (e) {}
            }
        });

        response.data.on('end', async () => {
            // 5. Save the AI's response to the database so it's remembered next time
            await db.run('INSERT INTO messages (session_id, role, content) VALUES (?, "assistant", ?)', [activeSession, fullAiText]);
            res.end();
        });
    } catch (err) {
        console.error("Ollama connection error:", err.message);
        res.status(500).json({ error: "Ollama connection failed." });
    }
}));

// DELETE a specific message by its ID
app.delete('/messages/:id', wrap(async (req, res) => {
    await db.run('DELETE FROM messages WHERE id = ?', [req.params.id]);
    res.json({ success: true });
}));