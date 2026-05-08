import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Missing MONGODB_URI (use: node --env-file=.env.local scripts/test-mongodb.mjs)");
  process.exit(1);
}

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const admin = mongoose.connection.db.admin();
  const ping = await admin.ping();
  console.log("MongoDB: connected OK");
  console.log("Ping:", JSON.stringify(ping));
  await mongoose.disconnect();
  console.log("Disconnected.");
  process.exit(0);
} catch (err) {
  console.error("MongoDB connection failed:", err.message);
  process.exit(1);
}
