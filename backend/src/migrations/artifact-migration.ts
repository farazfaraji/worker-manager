import mongoose, { Connection, Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Artifact, ArtifactSchema } from '../blocks/schemas/artifact.schema';
import {
  ArtifactRelation,
  ArtifactRelationSchema,
} from '../blocks/schemas/artifact-relation.schema';
import { computeContentHash } from '../blocks/artifact.service';

export interface MigrationReport {
  dryRun: boolean;
  totalArtifacts: number;
  migratedCount: number;
  skippedCount: number;
  unresolvedRelationCount: number;
  conflictingChainCount: number;
  invalidRecordCount: number;
  relationsCreatedCount: number;
  errors: string[];
}

export async function runArtifactMigration(
  connection: Connection,
  options: { dryRun?: boolean } = {},
): Promise<MigrationReport> {
  const dryRun = options.dryRun !== false;

  const artifactModel: Model<any> =
    connection.models[Artifact.name] ||
    connection.model(Artifact.name, ArtifactSchema);

  const relationModel: Model<any> =
    connection.models[ArtifactRelation.name] ||
    connection.model(ArtifactRelation.name, ArtifactRelationSchema);

  const report: MigrationReport = {
    dryRun,
    totalArtifacts: 0,
    migratedCount: 0,
    skippedCount: 0,
    unresolvedRelationCount: 0,
    conflictingChainCount: 0,
    invalidRecordCount: 0,
    relationsCreatedCount: 0,
    errors: [],
  };

  // 1. Ensure indexes
  if (!dryRun) {
    try {
      await artifactModel.syncIndexes();
      await relationModel.syncIndexes();
    } catch (idxErr: any) {
      report.errors.push(`Error syncing indexes: ${idxErr.message}`);
    }
  }

  // 2. Fetch all artifacts
  const allDocs = await artifactModel.find({}).lean().exec();
  report.totalArtifacts = allDocs.length;

  if (allDocs.length === 0) {
    return report;
  }

  // Map for fast lookup by artifactId
  const byArtifactId = new Map<string, any>();
  for (const doc of allDocs) {
    if (!doc.artifactId) {
      report.invalidRecordCount++;
      continue;
    }
    byArtifactId.set(doc.artifactId, doc);
  }

  // Helper to trace back parent chain to find rootArtifactId
  function findRootArtifactId(doc: any): string {
    const visited = new Set<string>();
    let curr = doc;
    while (curr.parentArtifactId && byArtifactId.has(curr.parentArtifactId)) {
      if (visited.has(curr.parentArtifactId)) {
        report.conflictingChainCount++;
        break; // Cycle detected
      }
      visited.add(curr.artifactId);
      curr = byArtifactId.get(curr.parentArtifactId);
    }
    return curr.artifactId;
  }

  // Group into logical chains by rootArtifactId
  const chains = new Map<string, any[]>();
  for (const doc of allDocs) {
    if (!doc.artifactId) continue;
    const rootId = findRootArtifactId(doc);
    if (!chains.has(rootId)) chains.set(rootId, []);
    chains.get(rootId)!.push(doc);
  }

  // Process each chain
  for (const [rootId, versions] of chains.entries()) {
    // Sort ascending by version
    versions.sort((a, b) => Number(a.version || 1) - Number(b.version || 1));
    const highestVersionNumber = Math.max(...versions.map((v) => Number(v.version || 1)));

    for (const doc of versions) {
      const isLatestExpected = Number(doc.version || 1) === highestVersionNumber;
      const rootArtifactId = rootId;

      // Derive logicalId from existing metadata if present, otherwise use rootArtifactId
      const logicalId =
        doc.metadata?.logicalId ||
        doc.metadata?.logicalArtifactId ||
        doc.logicalId ||
        rootArtifactId;

      // Normalize keywords
      let keywords = doc.keywords;
      if (!Array.isArray(keywords) || keywords.length === 0) {
        keywords = Array.isArray(doc.keyword) ? doc.keyword : [];
      }

      // Compute contentHash
      const contentHash = computeContentHash(doc.format || 'markdown', doc.content);
      const schemaVersion = doc.schemaVersion || 1;

      const needsMigration =
        doc.logicalId !== logicalId ||
        doc.rootArtifactId !== rootArtifactId ||
        doc.isLatest !== isLatestExpected ||
        doc.contentHash !== contentHash ||
        doc.schemaVersion !== schemaVersion ||
        (!doc.keywords && keywords.length > 0);

      if (needsMigration) {
        report.migratedCount++;
        if (!dryRun) {
          await artifactModel.updateOne(
            { _id: doc._id },
            {
              $set: {
                logicalId,
                rootArtifactId,
                isLatest: isLatestExpected,
                contentHash,
                schemaVersion,
                keywords,
              },
            },
          );
        }
      } else {
        report.skippedCount++;
      }

      // 3. Process legacy linkedArtifactIds to typed 'relates-to' relations
      const linkedIds = Array.isArray(doc.linkedArtifactIds) ? doc.linkedArtifactIds : [];
      for (const targetId of linkedIds) {
        const targetDoc = byArtifactId.get(targetId);
        if (!targetDoc) {
          report.unresolvedRelationCount++;
          continue;
        }

        const targetLogicalId =
          targetDoc.metadata?.logicalId ||
          targetDoc.logicalId ||
          findRootArtifactId(targetDoc);

        if (!targetLogicalId || targetLogicalId === logicalId) {
          continue;
        }

        const projectId = doc.projectId || '';

        // Check if relation already exists
        const existingRel = await relationModel.findOne({
          projectId,
          sourceLogicalId: logicalId,
          targetLogicalId,
          type: 'relates-to',
        });

        if (!existingRel) {
          report.relationsCreatedCount += 2; // Forward + inverse
          if (!dryRun) {
            const relId1 = `rel_${randomUUID()}`;
            const relId2 = `rel_${randomUUID()}`;
            try {
              await relationModel.create([
                {
                  relationId: relId1,
                  projectId,
                  sourceLogicalId: logicalId,
                  targetLogicalId,
                  type: 'relates-to',
                  inverseType: 'relates-to',
                  status: 'active',
                  metadata: { migratedFromLinkedArtifactId: targetId },
                },
                {
                  relationId: relId2,
                  projectId,
                  sourceLogicalId: targetLogicalId,
                  targetLogicalId: logicalId,
                  type: 'relates-to',
                  inverseType: 'relates-to',
                  status: 'active',
                  metadata: { migratedFromLinkedArtifactId: doc.artifactId },
                },
              ]);
            } catch (relErr: any) {
              if (relErr.code !== 11000) {
                report.errors.push(`Failed to migrate relation: ${relErr.message}`);
              }
            }
          }
        }
      }
    }
  }

  return report;
}

// Standalone CLI runner
if (require.main === module) {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const dryRun = !isApply;

  const mongoUri =
    process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/flow_builder';

  console.log('=============================================');
  console.log(`🚀 ARTIFACT SCHEMA MIGRATION (${dryRun ? 'DRY-RUN' : 'APPLY'})`);
  console.log(`Target: ${mongoUri}`);
  console.log('=============================================');

  mongoose
    .connect(mongoUri)
    .then(async () => {
      const report = await runArtifactMigration(mongoose.connection, { dryRun });
      console.log('\nMigration Report:');
      console.log(JSON.stringify(report, null, 2));
      await mongoose.disconnect();
      process.exit(report.errors.length > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Migration failed to start:', err);
      process.exit(1);
    });
}
