import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/flow_builder';

async function runMigration() {
  console.log(`\n🔄 Connecting to MongoDB at: ${MONGODB_URI}`);
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();
    console.log(` Connected to database: ${db.databaseName}\n`);

    const projectsCol = db.collection('projects');
    const graphsCol = db.collection('graphs');
    const runsCol = db.collection('runs');
    const artifactsCol = db.collection('artifacts');
    const memoriesCol = db.collection('memories');
    const tracesCol = db.collection('traces');
    const vectorrecordsCol = db.collection('vectorrecords');

    // 1. Ensure Default Project exists
    let defaultProject = await projectsCol.findOne({});
    if (!defaultProject) {
      console.log('📌 No existing project found. Creating "Default Project"...');
      const insertResult = await projectsCol.insertOne({
        name: 'Default Project',
        description: 'Default project workspace for flows and agents',
        color: '#4f46e5',
        metadata: { isDefault: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      defaultProject = { _id: insertResult.insertedId, name: 'Default Project' };
      console.log(` Created Default Project with ID: ${defaultProject._id}`);
    } else {
      console.log(` Existing Project found: "${defaultProject.name}" (ID: ${defaultProject._id})`);
    }

    const defaultProjectId = defaultProject._id.toString();

    // 2. Migrate Graphs
    const graphsResult = await graphsCol.updateMany(
      {
        $or: [
          { projectId: { $exists: false } },
          { projectId: null },
          { projectId: '' },
        ],
      },
      { $set: { projectId: defaultProjectId } },
    );
    console.log(`📊 Graphs migrated: ${graphsResult.modifiedCount} updated (matched ${graphsResult.matchedCount})`);

    // 3. Migrate Runs
    const runsResult = await runsCol.updateMany(
      {
        $or: [
          { projectId: { $exists: false } },
          { projectId: null },
          { projectId: '' },
        ],
      },
      { $set: { projectId: defaultProjectId } },
    );
    console.log(`🏃 Runs migrated: ${runsResult.modifiedCount} updated (matched ${runsResult.matchedCount})`);

    // 4. Migrate Artifacts
    const artifactsResult = await artifactsCol.updateMany(
      {
        $or: [
          { projectId: { $exists: false } },
          { projectId: null },
          { projectId: '' },
        ],
      },
      { $set: { projectId: defaultProjectId } },
    );
    console.log(`📄 Artifacts migrated: ${artifactsResult.modifiedCount} updated (matched ${artifactsResult.matchedCount})`);

    // 5. Migrate Memories
    const memoriesResult = await memoriesCol.updateMany(
      {
        $or: [
          { projectId: { $exists: false } },
          { projectId: null },
          { projectId: '' },
        ],
      },
      { $set: { projectId: defaultProjectId } },
    );
    console.log(`🧠 Memories migrated: ${memoriesResult.modifiedCount} updated (matched ${memoriesResult.matchedCount})`);

    // 6. Migrate Traces
    const tracesResult = await tracesCol.updateMany(
      {
        $or: [
          { projectId: { $exists: false } },
          { projectId: null },
          { projectId: '' },
        ],
      },
      { $set: { projectId: defaultProjectId } },
    );
    console.log(`🔍 Traces migrated: ${tracesResult.modifiedCount} updated (matched ${tracesResult.matchedCount})`);

    // 7. Migrate Vector Records
    const vectorsResult = await vectorrecordsCol.updateMany(
      {
        $or: [
          { projectId: { $exists: false } },
          { projectId: null },
          { projectId: '' },
        ],
      },
      { $set: { projectId: defaultProjectId } },
    );
    console.log(`📐 Vector Records migrated: ${vectorsResult.modifiedCount} updated (matched ${vectorsResult.matchedCount})`);

    console.log('\n🎉 Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

runMigration();
