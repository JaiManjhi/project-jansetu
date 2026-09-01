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
