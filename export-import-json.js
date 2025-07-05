// export-import-json.js
import neo4j from 'neo4j-driver';
import { promises as fs } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USER = process.env.NEO4J_USERNAME;
const NEO4J_PASS = process.env.NEO4J_PASSWORD;

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));

async function fetchAll(label) {
  const session = driver.session();
  try {
    const result = await session.run(`MATCH (n:${label}) RETURN n`);
    return result.records.map(record => record.get('n').properties);
  } finally {
    await session.close();
  }
}

async function fetchLessonsWithSections() {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (l:Lesson)
      OPTIONAL MATCH (l)-[:HAS_SECTION]->(s:Section)
      OPTIONAL MATCH (l)-[:HAS_QUIZ]->(q:Quiz)
      RETURN l, collect(DISTINCT s) as sections, collect(DISTINCT q) as quiz
    `);
    return result.records.map(record => {
      const lesson = record.get('l').properties;
      lesson.sections = record.get('sections').map(sec => sec && sec.properties ? sec.properties : null).filter(Boolean);
      lesson.quiz = record.get('quiz').map(qz => qz && qz.properties ? qz.properties : null).filter(Boolean);
      return lesson;
    });
  } finally {
    await session.close();
  }
}

async function main() {
  const lessons = await fetchLessonsWithSections();
  const models = await fetchAll('Model');
  const tutorials = await fetchAll('Tutorial');
  const prompts = await fetchAll('Prompt');
  const users = await fetchAll('User');

  const data = { lessons, models, tutorials, prompts, users };

  await fs.writeFile('import.json', JSON.stringify(data, null, 2));
  console.log('Exported data to import.json');
  await driver.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
