import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import neo4j from 'neo4j-driver';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
// If using Node <18, uncomment the next line and install node-fetch:
// import fetch from 'node-fetch';

// --- Neo4j Driver Setup ---
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

const app = express();
const PORT = process.env.PORT || 8082;

app.use(cors());
app.use(express.json());

// --- Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.error("JWT Verification Error:", err.message);
            return res.sendStatus(403);
        }
        req.user = user;
        next();
    });
};

// --- Helper Functions ---
const getRecords = (result) => result.records.map(record => record.get(0).properties);
const getSingleRecord = (result) => result.records[0] ? result.records[0].get(0) : null;
const parseJsonProps = (item, props) => {
    if (!item) return item;
    const newItem = { ...item };
    for (const prop of props) {
        if (newItem[prop] && typeof newItem[prop] === 'string') {
            try {
                newItem[prop] = JSON.parse(newItem[prop]);
            } catch (e) {
                // If parsing fails, it's likely just a plain string. Keep it as is.
            }
        }
    }
    return newItem;
};

const lessonPropsToParse = ['introduction', 'sections', 'modelSpecificStrategies', 'commonMistakesAndTroubleshooting', 'advancedTechniques', 'practiceExercises', 'reflectionAndDiscussion', 'summary', 'quiz', 'tags', 'relatedLessons', 'prerequisites'];
const modelPropsToParse = ['capabilities'];
const tutorialPropsToParse = ['steps', 'troubleshooting', 'modelIds'];

// --- Auth Endpoints ---
app.post('/api/auth/register', async (req, res) => {
    const session = driver.session();
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) return res.status(400).json({ message: 'Username and a password of at least 6 characters are required.' });
    try {
        const existingUser = await session.run('MATCH (u:User {username: $username}) RETURN u', { username });
        if (existingUser.records.length > 0) return res.status(409).json({ message: 'Username already exists.' });
        const passwordHash = await bcrypt.hash(password, 10);
        const result = await session.run('CREATE (u:User {id: randomUUID(), username: $username, passwordHash: $passwordHash}) RETURN u', { username, passwordHash });
        const newUser = result.records[0].get('u').properties;
        res.status(201).json({ id: newUser.id, username: newUser.username });
    } catch (error) { res.status(500).json({ message: 'Error registering user', error: error.message }); } finally { await session.close(); }
});

app.post('/api/auth/login', async (req, res) => {
    const session = driver.session();
    const { username, password } = req.body;
    try {
        const result = await session.run('MATCH (u:User {username: $username}) RETURN u', { username });
        if (result.records.length === 0) return res.status(401).json({ message: 'Invalid username or password.' });
        const user = result.records[0].get('u').properties;
        const isPasswordCorrect = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordCorrect) return res.status(401).json({ message: 'Invalid username or password.' });
        const userForToken = { id: user.id, username: user.username };
        const token = jwt.sign(userForToken, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: userForToken });
    } catch (error) { res.status(500).json({ message: 'Error logging in', error: error.message }); } finally { await session.close(); }
});

// --- Public API Endpoints ---
app.get('/api/lessons', async (req, res) => {
  const session = driver.session();
  try { 
      const lessons = getRecords(await session.run('MATCH (l:Lesson) RETURN l'));
      const parsedLessons = lessons.map(l => parseJsonProps(l, lessonPropsToParse));
      res.json(parsedLessons);
  }
  catch (error) { res.status(500).json({ message: 'Error fetching lessons', error: error.message }); }
  finally { await session.close(); }
});

app.get('/api/lessons/:id', async (req, res) => {
  const session = driver.session();
  try {
    const lesson = getSingleRecord(await session.run('MATCH (l:Lesson {id: $id}) RETURN l', { id: req.params.id }))?.properties;
    if (lesson) {
        const parsedLesson = parseJsonProps(lesson, lessonPropsToParse);
        res.json(parsedLesson);
    } else {
        res.status(404).json({ message: 'Lesson not found' });
    }
  } catch (error) { res.status(500).json({ message: 'Error fetching lesson', error: error.message }); }
  finally { await session.close(); }
});

app.get('/api/models', async (req, res) => {
  const session = driver.session();
  try { 
      const models = getRecords(await session.run('MATCH (m:AIModel) RETURN m'));
      res.json(models.map(m => parseJsonProps(m, modelPropsToParse)));
  }
  catch (error) { res.status(500).json({ message: 'Error fetching AI models', error: error.message }); }
  finally { await session.close(); }
});

app.get('/api/models/:id', async (req, res) => {
  const session = driver.session();
  try {
    const model = getSingleRecord(await session.run('MATCH (m:AIModel {id: $id}) RETURN m', { id: req.params.id }))?.properties;
    if (model) {
        res.json(parseJsonProps(model, modelPropsToParse));
    } else {
        res.status(404).json({ message: 'Model not found' });
    }
  } catch (error) { res.status(500).json({ message: 'Error fetching AI model', error: error.message }); }
  finally { await session.close(); }
});

app.get('/api/tutorials', async (req, res) => {
  const session = driver.session();
  try { 
      const tutorials = getRecords(await session.run('MATCH (t:Tutorial) RETURN t'));
      res.json(tutorials.map(t => parseJsonProps(t, tutorialPropsToParse)));
  }
  catch (error) { res.status(500).json({ message: 'Error fetching tutorials', error: error.message }); }
  finally { await session.close(); }
});

app.get('/api/tutorials/:id', async (req, res) => {
  const session = driver.session();
  try {
    const tutorial = getSingleRecord(await session.run('MATCH (t:Tutorial {id: $id}) RETURN t', { id: req.params.id }))?.properties;
    if (tutorial) {
        res.json(parseJsonProps(tutorial, tutorialPropsToParse));
    } else {
        res.status(404).json({ message: 'Tutorial not found' });
    }
  } catch (error) { res.status(500).json({ message: 'Error fetching tutorial', error: error.message }); }
  finally { await session.close(); }
});

// --- Gemini AI Proxy Endpoint ---
app.post('/api/gemini', authenticateToken, async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const { prompt, model } = req.body;
    const modelName = model || 'gemini-2.0-flash'; // Default to 'gemini-2.0-flash' if not provided

    if (!prompt) {
        return res.status(400).json({ message: "Prompt is required." });
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                }),
            }
        );

        if (!response.ok) {
            const err = await response.json();
            return res.status(500).json({ message: "Gemini API Error", error: err });
        }

        const data = await response.json();
        res.json(data);

    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// --- Protected API Endpoints ---

// User Progress
app.get('/api/progress', authenticateToken, async (req, res) => {
    const session = driver.session();
    const userId = req.user.id;
    try {
        const result = await session.run(
            'MATCH (u:User {id: $userId})-[r:COMPLETED]->(l:Lesson) RETURN l.id as lessonId, r.score as score',
            { userId }
        );
        const completedLessons = result.records.map(record => record.get('lessonId'));
        const quizScores = result.records.reduce((acc, record) => {
            acc[record.get('lessonId')] = record.get('score');
            return acc;
        }, {});

        // Mocking badges and streaks for now as they require more complex logic
        const userProgress = {
            completedLessons: completedLessons,
            quizScores: quizScores,
            badges: [], // TODO: Implement badge logic
            currentStreak: 0, // TODO: Implement streak logic
            longestStreak: 0,
        };
        res.json(userProgress);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user progress', error: error.message });
    } finally {
        await session.close();
    }
});

app.post('/api/progress/lesson/:lessonId', authenticateToken, async (req, res) => {
    const session = driver.session();
    const userId = req.user.id;
    const { lessonId } = req.params;
    const { score } = req.body;

    if (typeof score !== 'number') {
        return res.status(400).json({ message: 'A numeric score is required.' });
    }
    
    try {
        await session.run(
            'MATCH (u:User {id: $userId}) MATCH (l:Lesson {id: $lessonId}) MERGE (u)-[r:COMPLETED]->(l) SET r.score = $score, r.completedAt = timestamp() RETURN r',
            { userId, lessonId, score }
        );
        res.status(200).json({ message: "Lesson progress saved." });
    } catch (error) {
        res.status(500).json({ message: 'Error saving lesson progress', error: error.message });
    } finally {
        await session.close();
    }
});

// Saved Prompts
app.get('/api/prompts', authenticateToken, async (req, res) => {
    const session = driver.session();
    const userId = req.user.id;
    try {
        const result = await session.run(
            'MATCH (u:User {id: $userId})-[:SAVED_PROMPT]->(p:Prompt) RETURN p ORDER BY p.timestamp DESC',
            { userId }
        );
        const prompts = result.records.map(record => parseJsonProps(record.get('p').properties, ['tags']));
        res.json(prompts);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching saved prompts', error: error.message });
    } finally {
        await session.close();
    }
});

app.post('/api/prompts', authenticateToken, async (req, res) => {
    const session = driver.session();
    const userId = req.user.id;
    let { id, name, promptText, modelId, tags, isFavorite, responsePreview } = req.body;
    
    const promptId = id || uuidv4();
    const timestamp = Date.now();
    tags = JSON.stringify(tags || []);

    try {
        await session.run(
            'MATCH (u:User {id: $userId}) MERGE (p:Prompt {id: $promptId}) ON CREATE SET p.id = $promptId MERGE (u)-[:SAVED_PROMPT]->(p) SET p.name = $name, p.promptText = $promptText, p.modelId = $modelId, p.tags = $tags, p.isFavorite = $isFavorite, p.responsePreview = $responsePreview, p.timestamp = $timestamp RETURN p', { userId, promptId, name, promptText, modelId, tags, isFavorite, responsePreview, timestamp }
        );
        res.status(200).json({ message: "Prompt saved successfully." });
    } catch (error) {
        res.status(500).json({ message: 'Error saving prompt', error: error.message });
    } finally {
        await session.close();
    }
});

app.delete('/api/prompts/:id', authenticateToken, async (req, res) => {
    const session = driver.session();
    const userId = req.user.id;
    const promptId = req.params.id;
    try {
        await session.run(
            'MATCH (u:User {id: $userId})-[:SAVED_PROMPT]->(p:Prompt {id: $promptId}) DETACH DELETE p',
            { userId, promptId }
        );
        res.status(200).json({ message: 'Prompt deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting prompt', error: error.message });
    } finally {
        await session.close();
    }
});

// Lesson Notes
app.get('/api/notes/:lessonId', authenticateToken, async (req, res) => {
    const session = driver.session();
    const userId = req.user.id;
    const { lessonId } = req.params;
    try {
        const result = await session.run(
            'MATCH (u:User {id: $userId})-[r:HAS_NOTE {lessonId: $lessonId}]->(n:Note) RETURN n',
            { userId, lessonId }
        );
        const noteNode = getSingleRecord(result);
        if (noteNode && noteNode.properties.content) {
            res.json(JSON.parse(noteNode.properties.content));
        } else {
            res.json({}); 
        }
    } catch (error) {
        res.status(500).json({ message: 'Error fetching notes', error: error.message });
    } finally {
        await session.close();
    }
});

app.post('/api/notes/:lessonId', authenticateToken, async (req, res) => {
    const session = driver.session();
    const userId = req.user.id;
    const { lessonId } = req.params;
    const { content } = req.body;
    try {
        await session.run('MATCH (u:User {id: $userId}) MERGE (u)-[r:HAS_NOTE {lessonId: $lessonId}]->(n:Note) SET n.content = $content, n.lessonId = $lessonId', { userId, lessonId, content: JSON.stringify(content) });
        res.status(200).json({ message: "Notes saved." });
    } catch (error) {
        res.status(500).json({ message: 'Error saving notes', error: error.message });
    } finally {
        await session.close();
    }
});

// --- Import Data Endpoint (Authenticated + Neo4j Import) ---
app.post('/api/import-data', authenticateToken, async (req, res) => {
    const session = driver.session();
    const importData = req.body;
    let lessonsCount = 0, modelsCount = 0, tutorialsCount = 0;
    try {
        // Import Lessons
        if (Array.isArray(importData.lessons)) {
            for (const lesson of importData.lessons) {
                await session.run(
                    `MERGE (l:Lesson {id: $id})
                     SET l += $props`,
                    { id: lesson.id || uuidv4(), props: lesson }
                );
                lessonsCount++;
            }
        }
        // Import Models
        if (Array.isArray(importData.models)) {
            for (const model of importData.models) {
                await session.run(
                    `MERGE (m:AIModel {id: $id})
                     SET m += $props`,
                    { id: model.id || uuidv4(), props: model }
                );
                modelsCount++;
            }
        }
        // Import Tutorials
        if (Array.isArray(importData.tutorials)) {
            for (const tutorial of importData.tutorials) {
                await session.run(
                    `MERGE (t:Tutorial {id: $id})
                     SET t += $props`,
                    { id: tutorial.id || uuidv4(), props: tutorial }
                );
                tutorialsCount++;
            }
        }
        res.status(200).json({
            message: 'Data imported successfully!',
            summary: {
                lessons: lessonsCount,
                models: modelsCount,
                tutorials: tutorialsCount
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error importing data', error: error.message });
    } finally {
        await session.close();
    }
});

// --- Server Startup ---
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('server is running');
});
