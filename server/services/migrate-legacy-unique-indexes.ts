import { connectDB } from "@/server/db/connect";
import { CategoryModel, LeadModel, MergeFieldModel, TemplateModel, AppSettingsModel } from "@/server/db/models";

let migratedInFlight: Promise<void> | null = null;

async function dropLegacySingleFieldUniqueIndex(model: typeof CategoryModel | typeof MergeFieldModel | typeof TemplateModel | typeof LeadModel, field: string) {
  // Example legacy indexes: { name: 1 } unique, { key: 1 } unique, { googlePlaceId: 1 } unique.
  const indexes = await model.collection.listIndexes();
  const all = await indexes.toArray();

  for (const idx of all) {
    const keys = Object.keys(idx.key ?? {});
    if (
      idx.unique === true &&
      keys.length === 1 &&
      keys[0] === field &&
      // Keep the composite/indexes created by Mongoose if they already exist.
      typeof idx.name === "string" &&
      idx.name !== "_id_"
    ) {
      // Best-effort: if it doesn't exist, ignore.
      try {
        await model.collection.dropIndex(idx.name);
      } catch {
        // ignore
      }
    }
  }
}

export async function migrateLegacyUniqueIndexesToUserOwned(): Promise<void> {
  if (!migratedInFlight) {
    migratedInFlight = (async () => {
      await connectDB();

      // Drop legacy global uniqueness that would prevent per-user records.
      await dropLegacySingleFieldUniqueIndex(TemplateModel, "name");
      await dropLegacySingleFieldUniqueIndex(CategoryModel, "name");
      await dropLegacySingleFieldUniqueIndex(MergeFieldModel, "key");
      await dropLegacySingleFieldUniqueIndex(LeadModel, "googlePlaceId");

      // Recreate user-owned composite indexes explicitly (idempotent).
      await TemplateModel.collection.createIndex({ userId: 1, name: 1 }, { unique: true });
      await CategoryModel.collection.createIndex({ userId: 1, name: 1 }, { unique: true });
      await MergeFieldModel.collection.createIndex({ userId: 1, key: 1 }, { unique: true });
      await LeadModel.collection.createIndex({ userId: 1, googlePlaceId: 1 }, { unique: true });
      await AppSettingsModel.collection.createIndex({ userId: 1 }, { unique: true });
    })();
  }

  return migratedInFlight;
}

