import neo4j from 'neo4j-driver';
import { AI_MODELS, LESSONS, TUTORIALS } from './data/mockData.js';
import 'dotenv/config';

// Ensure environment variables are loaded
if (!process.env.NEO4J_URI || !process.env.NEO4J_USERNAME || !process.env.NEO4J_PASSWORD) {
    console.error("Database credentials are not configured. Please create a .env file in the 'backend' directory with NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD.");
    process.exit(1);
}

const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

const stringifyComplexProps = (obj, propsToConvert) => {
    const newObj = { ...obj };
    for(const prop of propsToConvert) {
        if (newObj[prop] !== undefined && typeof newObj[prop] !== 'string') {
            newObj[prop] = JSON.stringify(newObj[prop]);
        }
    }
    return newObj;
}

async function seedDatabase() {
    console.log('--- Starting Database Seeding Process ---');
    const session = driver.session();
    try {
        console.log('Step 1: Verifying database connection...');
        await driver.verifyConnectivity();
        console.log('✅ Connection successful!');

        console.log('\nStep 2: Clearing existing data...');
        await session.run('MATCH (n) DETACH DELETE n');
        console.log('✅ Existing data cleared.');

        console.log('\nStep 3: Creating constraints for uniqueness...');
        await session.run('CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE');
        await session.run('CREATE CONSTRAINT user_username IF NOT EXISTS FOR (u:User) REQUIRE u.username IS UNIQUE');
        await session.run('CREATE CONSTRAINT lesson_id IF NOT EXISTS FOR (l:Lesson) REQUIRE l.id IS UNIQUE');
        await session.run('CREATE CONSTRAINT model_id IF NOT EXISTS FOR (m:AIModel) REQUIRE m.id IS UNIQUE');
        await session.run('CREATE CONSTRAINT tutorial_id IF NOT EXISTS FOR (t:Tutorial) REQUIRE t.id IS UNIQUE');
        await session.run('CREATE CONSTRAINT prompt_id IF NOT EXISTS FOR (p:Prompt) REQUIRE p.id IS UNIQUE');
        console.log('✅ Constraints created.');

        console.log('\nStep 4: Seeding AI Models...');
        for (const model of AI_MODELS) {
            const props = stringifyComplexProps(model, ['capabilities']);
            await session.run('CREATE (m:AIModel $props)', { props });
        }
        console.log(`✅ Seeded ${AI_MODELS.length} AI Models.`);

        console.log('\nStep 5: Seeding Lessons...');
        for (const lesson of LESSONS) {
            const { prerequisites, modelId, ...lessonProperties } = lesson;
            // Stringify all potentially complex fields before saving
            const props = stringifyComplexProps(lessonProperties, ['introduction', 'sections', 'modelSpecificStrategies', 'commonMistakesAndTroubleshooting', 'advancedTechniques', 'practiceExercises', 'reflectionAndDiscussion', 'summary', 'quiz', 'tags', 'relatedLessons']);
            await session.run('CREATE (l:Lesson $props)', { props });
        }
        console.log(`✅ Seeded ${LESSONS.length} Lessons.`);
        
        console.log('\nStep 6: Seeding Tutorials...');
        for (const tutorial of TUTORIALS) {
            const { modelIds, ...tutorialProperties } = tutorial;
            const props = stringifyComplexProps(tutorialProperties, ['steps', 'troubleshooting']);
            await session.run('CREATE (t:Tutorial $props)', { props });
        }
        console.log(`✅ Seeded ${TUTORIALS.length} Tutorials.`);


        console.log('\nStep 7: Creating relationships between nodes...');
        for (const lesson of LESSONS) {
            if (lesson.modelId) {
                await session.run(
                    'MATCH (l:Lesson {id: $lessonId}), (m:AIModel {id: $modelId}) CREATE (l)-[:USES_MODEL]->(m)',
                    { lessonId: lesson.id, modelId: lesson.modelId }
                );
            }
            if (lesson.prerequisites && lesson.prerequisites.length > 0) {
                for (const prereqId of lesson.prerequisites) {
                    await session.run(
                        'MATCH (l1:Lesson {id: $lessonId}), (l2:Lesson {id: $prereqId}) CREATE (l2)-[:IS_PREREQUISITE_FOR]->(l1)',
                        { lessonId: lesson.id, prereqId: prereqId }
                    );
                }
            }
        }
        
        for (const tutorial of TUTORIALS) {
             if (tutorial.modelIds && tutorial.modelIds.length > 0) {
                for (const modelId of tutorial.modelIds) {
                    await session.run(
                        'MATCH (t:Tutorial {id: $tutorialId}), (m:AIModel {id: $modelId}) CREATE (t)-[:USES_MODEL]->(m)',
                        { tutorialId: tutorial.id, modelId: modelId }
                    );
                }
            }
        }
        console.log('✅ Relationships created successfully.');
        
        console.log('\n--- 🎉 Database seeded successfully! ---');
    } catch (error) {
        console.error('\n--- ❌ Error during database seeding ---');
        console.error(error);
        if (error.code === 'Neo.ClientError.Security.AuthenticationRateLimit') {
            console.error('\nTroubleshooting: You have hit the authentication rate limit. Please wait a few moments and try again.');
        } else if (error.code === 'Neo.ClientError.Security.CredentialsExpired') {
             console.error('\nTroubleshooting: Your database credentials have expired. Please check your Neo4j Aura console.');
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ServiceUnavailable')) {
            console.error('\nTroubleshooting: Could not connect to the database. Please check your NEO4J_URI in the .env file and ensure the database is running and not paused.');
        } else {
             console.error('\nTroubleshooting: An unexpected error occurred. Please check your .env file credentials and network connection.');
        }
    } finally {
        await session.close();
        await driver.close();
        console.log('\nSeeding script finished.');
    }
}

seedDatabase();
