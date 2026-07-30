import mongoose from "mongoose";

declare global {
  var mongooseConn: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
}

const cached = global.mongooseConn ?? { conn: null, promise: null };
global.mongooseConn = cached;

function isConnected(): boolean {
  // 1 = connected
  return mongoose.connection.readyState === 1 && cached.conn !== null;
}

export async function connectDB(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI");

  if (isConnected()) return cached.conn!;

  // Drop a failed/stale in-flight connect so the next request can retry cleanly
  if (cached.promise && !isConnected()) {
    try {
      await cached.promise;
      if (isConnected()) return cached.conn!;
    } catch {
      cached.promise = null;
      cached.conn = null;
    }
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: 12_000,
        maxPoolSize: 10,
      })
      .then((m) => {
        cached.conn = m;
        return m;
      })
      .catch((err) => {
        cached.promise = null;
        cached.conn = null;
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
