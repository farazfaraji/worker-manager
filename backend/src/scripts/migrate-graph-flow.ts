import { MongoClient } from 'mongodb';
import { GraphShapeService } from '../graphs/graph-shape.service';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/flow_builder';
const dryRun = process.argv.includes('--dry-run');

async function runMigration() {
  const client = new MongoClient(MONGODB_URI);
  const shapeService = new GraphShapeService();

  try {
    await client.connect();
    const graphs = client.db().collection('graphs');
    const candidates = graphs.find({
      $or: [
        { flow: { $exists: false } },
        { nodes: { $exists: true } },
        { edges: { $exists: true } },
        { viewport: { $exists: true } },
      ],
    });

    let migrated = 0;
    let skipped = 0;
    for await (const graph of candidates) {
      const shaped = shapeService.reshapeForSave({
        flow: graph.flow,
        nodes: graph.nodes,
        edges: graph.edges,
        layout: graph.layout,
        viewport: graph.viewport,
      });

      if (dryRun) {
        console.log(`Would migrate ${graph._id} (${graph.name || 'untitled'})`);
        skipped++;
        continue;
      }

      await graphs.updateOne(
        { _id: graph._id },
        {
          $set: {
            flow: shaped.flow,
            layout: shaped.layout,
            updatedAt: new Date(),
          },
          $unset: { nodes: '', edges: '', viewport: '' },
        },
      );
      migrated++;
    }

    console.log(
      dryRun
        ? `Dry run complete: ${skipped} graph(s) would be migrated.`
        : `Graph flow migration complete: ${migrated} graph(s) migrated.`,
    );
  } finally {
    await client.close();
  }
}

runMigration().catch((error) => {
  console.error('Graph flow migration failed:', error);
  process.exitCode = 1;
});
