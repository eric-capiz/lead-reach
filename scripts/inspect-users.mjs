import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Missing MONGODB_URI (use: node --env-file=.env.local scripts/inspect-users.mjs)");
  process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
const db = mongoose.connection.db;

const users = await db.collection("users").find({}).project({ usernameLower: 1, setupCompleted: 1, createdAt: 1 }).toArray();

console.log(`\nUsers: ${users.length}\n${"=".repeat(60)}`);

for (const u of users) {
  const uid = u._id;
  const [cats, tpls, leads, mfs, settings] = await Promise.all([
    db.collection("categories").find({ userId: uid }).project({ name: 1 }).toArray(),
    db.collection("templates").find({ userId: uid }).toArray(),
    db.collection("leads").countDocuments({ userId: uid }),
    db.collection("mergefields").countDocuments({ userId: uid }),
    db.collection("appsettings").findOne({ userId: uid }, { projection: { locationAddress: 1 } }),
  ]);

  console.log(`\nuser: ${u.usernameLower}  (setupCompleted: ${u.setupCompleted === true})`);
  console.log(`  created:    ${u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : "n/a"}`);
  console.log(`  leads:      ${leads}`);
  console.log(`  mergeFields:${mfs}`);
  console.log(`  settings:   ${settings ? `yes (location: "${settings.locationAddress ?? ""}")` : "MISSING"}`);
  console.log(`  categories: ${cats.length}${cats.length ? ` -> ${cats.map((c) => c.name).join(", ")}` : ""}`);
  console.log(`  templates:  ${tpls.length}`);
  const catNameById = new Map(cats.map((c) => [String(c._id), c.name]));
  for (const t of tpls) {
    const linked = t.categoryId ? (catNameById.get(String(t.categoryId)) ?? "(deleted category)") : "none (hand-made)";
    console.log(
      `     - "${t.name}" | linked: ${linked} | catchAll: ${t.useWhenNoCategoryMatch === true}` +
        ` | emailLen: ${(t.body ?? "").length} | dmLen: ${(t.dmBody ?? "").length}`,
    );
  }

  const leadsWithTpl = await db.collection("leads").countDocuments({ userId: uid, templateId: { $ne: null } });
  const leadsWithEmail = await db.collection("leads").countDocuments({ userId: uid, email: { $type: "string", $ne: "" } });
  const leadsWithSocial = await db.collection("leads").countDocuments({
    userId: uid,
    $or: [{ instagram: { $nin: [null, ""] } }, { facebook: { $nin: [null, ""] } }],
  });
  console.log(`  leads w/ templateId: ${leadsWithTpl} | w/ email: ${leadsWithEmail} | w/ social: ${leadsWithSocial}`);
}

const missingDm = await db
  .collection("templates")
  .countDocuments({ $or: [{ dmBody: { $exists: false } }, { dmBody: "" }] });
const cacheCount = await db.collection("socialresolvecaches").countDocuments({});
console.log(`\n${"=".repeat(60)}`);
console.log(`templates still missing a DM body (seed on next login): ${missingDm}`);
console.log(`shared socialResolveCache entries: ${cacheCount}`);

await mongoose.disconnect();
process.exit(0);
