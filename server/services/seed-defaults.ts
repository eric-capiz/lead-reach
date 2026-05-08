import { connectDB } from "@/server/db/connect";
import {
  AppSettingsModel,
  CategoryModel,
  MergeFieldModel,
  TemplateModel,
} from "@/server/db/models";

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
  { key: "phone", label: "Phone", value: "(555) 010-4421" },
  { key: "portfoliolink", label: "Portfolio URL", value: "https://portfolio.example.com/eric-capiz" },
  { key: "linkedinlink", label: "LinkedIn URL", value: "https://linkedin.com/in/eric-capiz" },
  { key: "sampleprojectlink", label: "Sample project URL", value: "https://demo.example.com/barber-booking" },
];

const DEFAULT_TEMPLATES: { name: string; subject: string; body: string; categoryTag: string; order: number }[] = [
  {
    name: "Barber Website Pitch",
    categoryTag: "Barbers",
    order: 0,
    subject: "Website / booking page for your barbershop",
    body: `Hi {{businessName}},

I'm {{myName}}. I build booking-ready sites for barbershops.

Sample booking flow: {{sampleProjectLink}}
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

Live bakery demo: {{sampleProjectLink}}
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

{{portfolioLink}} · {{sampleProjectLink}}

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
{{sampleProjectLink}}
{{linkedinLink}} · {{phone}}`,
  },
];

export async function ensureSeeded(): Promise<void> {
  await connectDB();

  if ((await AppSettingsModel.countDocuments()) === 0) {
    await AppSettingsModel.create({
      locationAddress: "El Paso, TX",
      radiusMiles: 50,
      websiteFilter: "no_website",
    });
  }

  if ((await CategoryModel.countDocuments()) === 0) {
    await CategoryModel.insertMany(
      DEFAULT_CATEGORIES.map((name, order) => ({ name, order })),
    );
  }

  if ((await MergeFieldModel.countDocuments()) === 0) {
    await MergeFieldModel.insertMany(DEFAULT_MERGE_FIELDS);
  }

  if ((await TemplateModel.countDocuments()) === 0) {
    await TemplateModel.insertMany(DEFAULT_TEMPLATES);
  }
}
