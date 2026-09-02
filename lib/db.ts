import mongoose, { type Mongoose } from "mongoose";

/**
 * MongoDB connection singleton.
 *
 * Next.js hot-reloads modules in development and runs API routes in
 * short-lived serverless invocations in production. Both will happily open a
 * new connection per module evaluation and exhaust the Atlas M0 connection
 * limit (500) surprisingly fast. Caching the connection — and the in-flight
 * promise, so concurrent first-callers share one dial-up — is the standard fix.
 */

interface MongooseCache {
  conn: Mongoose | null;
  promise: Promise<Mongoose> | null;
}

const globalForMongoose = globalThis as unknown as {
  _mongooseCache?: MongooseCache;
};

const cached: MongooseCache = globalForMongoose._mongooseCache ?? {
  conn: null,
  promise: null,
};

globalForMongoose._mongooseCache = cached;

export async function connectToDatabase(): Promise<Mongoose> {
  if (cached.conn) return cached.conn;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env.local and fill it in — see SETUP.md.",
    );
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, {
      // Fail fast rather than buffering queries against a dead connection:
      // a hung request is much harder to diagnose on stage than a clear error.
      bufferCommands: false,

      /**
       * The driver default is 30 SECONDS, and it is badly wrong here.
       *
       * Measured with Atlas unreachable: POST /api/problems took 30.03s to
       * return its 503. Three things break at that number — PRD §9 targets a
       * sub-5-second submission, Vercel's Hobby function ceiling is 10s so the
       * platform would kill the request and replace our clear error with a
       * generic 504, and the offline queue would stall for 30s per row while
       * flushing.
       *
       * 5s is longer than a healthy Atlas handshake (measured ~0.5s) and short
       * enough that a real outage surfaces as a fast, honest error.
       */
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,

      // M0 allows 500 connections cluster-wide; a serverless deployment can
      // open a pool per instance, so keep each pool small.
      maxPoolSize: 10,
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    // Clear the rejected promise so the next request retries instead of
    // re-awaiting a permanently failed connection for the process lifetime.
    cached.promise = null;
    throw error;
  }

  return cached.conn;
}
