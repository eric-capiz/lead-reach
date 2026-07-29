import mongoose from "mongoose";
import { connectDB } from "@/server/db/connect";
import { AppSettingsModel, CategoryModel, TemplateModel } from "@/server/db/models";
import { looseNameKey, normalizeName } from "@/server/lib/category-key";
import {
  DEFAULT_CATEGORY_NAMES,
  defaultDmBody,
  defaultTemplateFor,
  generalTemplateDefaults,
} from "@/server/services/default-templates";

type ObjId = mongoose.Types.ObjectId;

function looksGeneral(t: { name?: unknown; categoryTag?: unknown }): boolean {
  const candidates = [normalizeName(t.name), normalizeName(t.categoryTag)];
  return candidates.some(
    (c) => c === "general" || c === "default" || c === "catchall" || c === "any" || c.startsWith("general "),
  );
}

/** Duplicate-key races (two tabs bootstrapping at once) are expected and safe to swallow. */
function isDuplicateKeyError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;
}

async function upsertTemplate(
  userId: ObjId | string,
  fields: { name: string; subject: string; body: string; dmBody: string; categoryTag: string },
  extra: { categoryId?: ObjId | null; order?: number; isDefault?: boolean } = {},
) {
  try {
    return await TemplateModel.findOneAndUpdate(
      { userId, name: fields.name },
      { $setOnInsert: { userId, ...fields, ...extra } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    return TemplateModel.findOne({ userId, name: fields.name });
  }
}

/**
 * Brings a user up to the current baseline: settings, the default categories, a template per
 * category, and a catch-all. Purely additive and idempotent — existing categories, templates,
 * and leads are never renamed or removed, so it is safe to run on every request.
 *
 * A user's own category matching a default by loose name (case and plural insensitive) is
 * adopted as that default rather than duplicated.
 */
export async function ensureUserSeeded(userId: ObjId | string): Promise<void> {
  await connectDB();

  const existingSettings = await AppSettingsModel.findOne({ userId }).select("_id").lean();
  if (!existingSettings) {
    await AppSettingsModel.create({
      userId,
      locationAddress: "",
      radiusMiles: 50,
      websiteFilter: "no_website",
    });
  }

  let categories = await CategoryModel.find({ userId }).sort({ order: 1, name: 1 }).lean();

  for (const [i, defaultName] of DEFAULT_CATEGORY_NAMES.entries()) {
    const existing = categories.find((c) => looseNameKey(c.name) === looseNameKey(defaultName));
    if (existing) {
      if (!existing.isDefault) {
        await CategoryModel.updateOne({ _id: existing._id, userId }, { $set: { isDefault: true } });
      }
      continue;
    }
    try {
      await CategoryModel.findOneAndUpdate(
        { userId, name: defaultName },
        { $setOnInsert: { userId, name: defaultName, isDefault: true, order: 1000 + i } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
    }
  }

  categories = await CategoryModel.find({ userId }).sort({ order: 1, name: 1 }).lean();

  const templates = await TemplateModel.find({ userId }).sort({ order: 1, name: 1 }).lean();

  // Adopt hand-made templates that clearly belong to a category ("Barber Website Pitch"
  // tagged "Barbers") instead of creating a near-duplicate beside them.
  const claimed = new Set<string>();
  for (const t of templates) {
    if (t.categoryId) {
      claimed.add(String(t.categoryId));
      continue;
    }
    const match = categories.find(
      (c) =>
        looseNameKey(c.name) === looseNameKey(t.categoryTag) || looseNameKey(c.name) === looseNameKey(t.name),
    );
    if (!match || claimed.has(String(match._id))) continue;
    await TemplateModel.updateOne({ _id: t._id, userId }, { $set: { categoryId: match._id } });
    claimed.add(String(match._id));
  }

  // Templates are created when a category is added (POST), or here only for seeded defaults.
  // Do NOT recreate templates for every category missing one — users can delete a template and
  // keep the category; a refresh must leave that choice alone.
  const nameTaken = new Set(templates.map((t) => normalizeName(t.name)));
  let order = templates.length;
  for (const category of categories) {
    if (!category.isDefault) continue;
    if (claimed.has(String(category._id))) continue;
    const fields = defaultTemplateFor(category.name);
    if (nameTaken.has(normalizeName(fields.name))) fields.name = `${fields.name} Outreach`;
    const doc = await upsertTemplate(userId, fields, {
      categoryId: category._id,
      order: order++,
      isDefault: true,
    });
    if (doc) {
      claimed.add(String(category._id));
      nameTaken.add(normalizeName(doc.name));
      if (!doc.categoryId) {
        await TemplateModel.updateOne({ _id: doc._id, userId }, { $set: { categoryId: category._id } });
      }
    }
  }

  // A template attached to a protected category is protected too, however it was created.
  const defaultCategoryIds = categories.filter((c) => c.isDefault).map((c) => c._id);
  if (defaultCategoryIds.length) {
    await TemplateModel.updateMany(
      { userId, categoryId: { $in: defaultCategoryIds }, isDefault: { $ne: true } },
      { $set: { isDefault: true } },
    );
  }

  const afterCategories = await TemplateModel.find({ userId }).sort({ order: 1, name: 1 }).lean();

  // Exactly one catch-all, so a run for an unmatched category still resolves to something.
  const flaggedCatchAll = afterCategories.find((t) => t.useWhenNoCategoryMatch === true);
  const catchAll =
    flaggedCatchAll ??
    afterCategories.find((t) => !t.categoryId && looksGeneral(t)) ??
    (await upsertTemplate(userId, generalTemplateDefaults(), {
      categoryId: null,
      order: afterCategories.length,
      isDefault: true,
    }));

  if (catchAll) {
    await TemplateModel.updateOne(
      { _id: catchAll._id, userId },
      { $set: { useWhenNoCategoryMatch: true, isDefault: true } },
    );
  }

  // Templates written before DM support have no dmBody; give them usable starter copy.
  const missingDm = await TemplateModel.find({
    userId,
    $or: [{ dmBody: { $exists: false } }, { dmBody: "" }, { dmBody: null }],
  })
    .select("_id name categoryTag")
    .lean();

  for (const t of missingDm) {
    const label = looksGeneral(t) ? undefined : String(t.categoryTag || t.name || "");
    await TemplateModel.updateOne({ _id: t._id, userId }, { $set: { dmBody: defaultDmBody(label || undefined) } });
  }
}

export async function ensureSeeded(): Promise<void> {
  await connectDB();
}
