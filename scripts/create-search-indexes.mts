/**
 * Creates the two Atlas Vector Search indexes from DATA_MODEL.md.
 *
 * Run with:  npm run db:indexes
 *
 * These cannot live in the Mongoose schemas — Atlas Search indexes are a
 * separate Atlas-side construct with their own API. The ordinary indexes
 * (2dsphere, compound) DO live in models/ and Mongoose creates them itself, so
 * they are deliberately not duplicated here.
 *
 * Safe to re-run: existing indexes are reported and skipped, not recreated.
 */
import mongoose from "mongoose";

interface VectorFieldDef {
  type: "vector";
  path: string;
  numDimensions: number;
  similarity: "cosine" | "euclidean" | "dotProduct";
}

interface FilterFieldDef {
  type: "filter";
  path: string;
}

interface SearchIndexSpec {
  name: string;
  collection: string;
  definition: { fields: Array<VectorFieldDef | FilterFieldDef> };
}

// gemini-embedding-2 at outputDimensionality 768 — see AI_ENGINE.md §2.
const NUM_DIMENSIONS = 768;

const INDEXES: SearchIndexSpec[] = [
  {
    name: "problem_embedding_index",
    collection: "problems",
    definition: {
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions: NUM_DIMENSIONS,
          similarity: "cosine",
        },
        // Required by the dedup query in AI_ENGINE.md §3. Atlas rejects a
        // $vectorSearch filter on any path not declared here — and it rejects
        // it at QUERY time, not now, so omitting one looks fine until Day 3.
        { type: "filter", path: "district" },
        { type: "filter", path: "status" },
        { type: "filter", path: "createdAt" },
      ],
    },
  },
  {
    name: "institution_capability_index",
    collection: "institutions",
    definition: {
      fields: [
        {
          type: "vector",
          path: "capabilityEmbedding",
          numDimensions: NUM_DIMENSIONS,
          similarity: "cosine",
        },
      ],
    },
  },
];

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — see SETUP.md");

  await mongoose.connect(uri, { bufferCommands: false });
  const db = mongoose.connection.db;
  if (!db) throw new Error("no database handle after connect");

  console.log(`database: ${db.databaseName}\n`);

  const existingCollections = new Set(
    (await db.listCollections().toArray()).map((c) => c.name),
  );

  for (const spec of INDEXES) {
    // Atlas will not create a search index on a collection that does not
    // exist yet, and on a fresh cluster none of them do.
    if (!existingCollections.has(spec.collection)) {
      await db.createCollection(spec.collection);
      console.log(`created empty collection "${spec.collection}"`);
    }

    const collection = db.collection(spec.collection);
    const existing = await collection.listSearchIndexes().toArray();
    const already = existing.find((i) => i.name === spec.name);

    if (already) {
      console.log(
        `· ${spec.name} already exists (status: ${already.status ?? "unknown"}) — skipped`,
      );
      continue;
    }

    await collection.createSearchIndex({
      name: spec.name,
      type: "vectorSearch",
      definition: spec.definition,
    });
    console.log(`✓ ${spec.name} created on "${spec.collection}"`);
  }

  // Creation is asynchronous on Atlas: the index exists immediately but is not
  // queryable until it finishes building. Report the real state rather than
  // letting Day 3 discover it.
  console.log("\nwaiting for indexes to become queryable...");
  const deadline = Date.now() + 180_000;

  for (;;) {
    const statuses: string[] = [];
    let allReady = true;

    for (const spec of INDEXES) {
      const list = await db
        .collection(spec.collection)
        .listSearchIndexes()
        .toArray();
      const found = list.find((i) => i.name === spec.name);
      const status = found?.status ?? "MISSING";
      const queryable = found?.queryable === true;
      statuses.push(`${spec.name}=${status}${queryable ? " (queryable)" : ""}`);
      if (!queryable) allReady = false;
    }

    console.log("  " + statuses.join("  |  "));
    if (allReady) {
      console.log("\nboth indexes are queryable.");
      break;
    }
    if (Date.now() > deadline) {
      console.log(
        "\nstill building after 3 minutes. This is normal on a shared M0 tier —" +
          " re-run this script to check status. Nothing is wrong.",
      );
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
