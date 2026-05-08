import { connectDB } from "@/server/db/connect";
import {
  AppSettingsModel,
  CategoryModel,
  LeadModel,
  MergeFieldModel,
  TemplateModel,
  UserModel,
} from "@/server/db/models";
import { syncOwnerMergeFieldsAndCleanup } from "@/server/services/sync-owner-merge-fields";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { migrateLegacyUniqueIndexesToUserOwned } from "@/server/services/migrate-legacy-unique-indexes";

const DEFAULT_CATEGORIES = [
  "Barbers",
  "Florists",
  "Bakeries",
  "DJs",
  "Mechanics",
  "Cleaning Services",
];

const DEFAULT_MERGE_FIELDS = [
  { key: "myname", label: "Your name", value: "Eric Capiz" },
  { key: "phone", label: "Phone", value: "443-307-3937" },
  { key: "email", label: "Email", value: "ericcapiz@gmail.com" },
  { key: "portfoliolink", label: "Portfolio URL", value: "https://ericcapiz.com" },
  { key: "linkedinlink", label: "LinkedIn URL", value: "https://linkedin.com/in/eric-capiz" },
];

const DEFAULT_TEMPLATES: { name: string; subject: string; body: string; categoryTag: string; order: number }[] = [
  {
    name: "Barber Website Pitch",
    categoryTag: "Barbers",
    order: 0,
    subject: "Website / booking page for your barbershop",
    body: `Hi {{businessName}},

I'm {{myName}}. I build booking-ready sites for barbershops.

Portfolio: {{portfolioLink}}

Happy to sketch something for your shop.
{{phone}} · {{linkedinLink}}`,
  },
  {
    name: "Bakery Website Pitch",
    categoryTag: "Bakeries",
    order: 1,
    subject: "A cleaner online presence for your bakery",
    body: `Hello {{businessName}},

{{myName}} here. Landing pages that showcase menus and pickup windows.

Work: {{portfolioLink}}

{{phone}}`,
  },
  {
    name: "Florist Website Pitch",
    categoryTag: "Florists",
    order: 2,
    subject: "Showcase arrangements & delivery zones online",
    body: `Hi {{businessName}},

I'm {{myName}}. Florists thrive when seasonal galleries read effortlessly.

{{portfolioLink}}

{{linkedinLink}} · {{phone}}`,
  },
  {
    name: "General Small Business Pitch",
    categoryTag: "Any",
    order: 3,
    subject: "Quick win: a simple site for {{businessName}}",
    body: `Hi {{businessName}},

{{myName}} · small-business websites & light booking flows.

{{portfolioLink}}
{{linkedinLink}} · {{phone}}`,
  },
];

let ensureSeededInFlight: Promise<void> | null = null;

export async function ensureUserSeeded(userId: mongoose.Types.ObjectId | string): Promise<void> {
  await connectDB();
  await migrateLegacyUniqueIndexesToUserOwned();

  // Settings
  if ((await AppSettingsModel.countDocuments({ userId })) === 0) {
    await AppSettingsModel.create({
      userId,
      locationAddress: "El Paso, TX",
      radiusMiles: 50,
      websiteFilter: "no_website",
    });
  }

  // Categories
  if ((await CategoryModel.countDocuments({ userId })) === 0) {
    await CategoryModel.insertMany(
      DEFAULT_CATEGORIES.map((name, order) => ({ userId, name, order })),
    );
  }

  // Merge fields
  if ((await MergeFieldModel.countDocuments({ userId })) === 0) {
    await MergeFieldModel.insertMany(DEFAULT_MERGE_FIELDS.map((f) => ({ ...f, userId })));
  }

  await syncOwnerMergeFieldsAndCleanup(userId);

  // Templates
  if ((await TemplateModel.countDocuments({ userId })) === 0) {
    await TemplateModel.insertMany(DEFAULT_TEMPLATES.map((t) => ({ ...t, userId })));
  }

  // Keep the UI clean for each user.
  await LeadModel.deleteMany({ userId, isSample: true });
}

async function runEnsureSeeded(): Promise<void> {
  await connectDB();

  // During the transition to auth, keep the app working by seeding defaults
  // for the built-in "breezy" user.
  const usernameLower = "breezy";
  const breezy = await UserModel.findOne({ usernameLower }).select("_id passwordHash");
  const breezyId =
    breezy?._id ??
    (await UserModel.create({ usernameLower, passwordHash: bcrypt.hashSync("breezy", 10) }))._id;

  await ensureUserSeeded(breezyId);
}

/** One completed run per server process; concurrent calls share the same work. */
export async function ensureSeeded(): Promise<void> {
  if (!ensureSeededInFlight) {
    ensureSeededInFlight = runEnsureSeeded().catch((err) => {
      ensureSeededInFlight = null;
      throw err;
    });
  }
  return ensureSeededInFlight;
}
