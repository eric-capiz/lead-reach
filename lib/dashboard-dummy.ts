export const APP_NAME = "LeadReach";

export const categories = [
  "Barbers",
  "Florists",
  "Bakeries",
  "DJs",
  "Mechanics",
  "Cleaning Services",
] as const;

export const templateOptions = [
  "Barber Website Pitch",
  "Bakery Website Pitch",
  "Florist Website Pitch",
  "General Small Business Pitch",
] as const;

export type LeadStatus = "sent" | "pending" | "social_ready";

export type LeadRow = {
  id: string;
  businessName: string;
  category: string;
  location: string;
  phone: string;
  email: string | null;
  websiteStatus: string;
  googleMapsUrl: string;
  instagram: string | null;
  facebook: string | null;
  template: (typeof templateOptions)[number];
  status: LeadStatus;
};

export const stats = {
  leadsFound: 128,
  noWebsite: 94,
  emailsFound: 31,
  socialMatches: 47,
  messagesSent: 18,
} as const;

export const leadRows: LeadRow[] = [
  {
    id: "1",
    businessName: "Desert Line Cuts",
    category: "Barbers",
    location: "El Paso, TX",
    phone: "(915) 555-0142",
    email: "hello@desertlinecuts.test",
    websiteStatus: "No website",
    googleMapsUrl: "https://maps.google.com/?q=Desert+Line+Cuts+El+Paso",
    instagram: "https://instagram.com/desertlinecuts",
    facebook: null,
    template: "Barber Website Pitch",
    status: "sent",
  },
  {
    id: "2",
    businessName: "Sunrise Pastry Co.",
    category: "Bakeries",
    location: "El Paso, TX",
    phone: "(915) 555-0198",
    email: null,
    websiteStatus: "No website",
    googleMapsUrl: "https://maps.google.com/?q=Sunrise+Pastry+El+Paso",
    instagram: null,
    facebook: "https://facebook.com/sunrisepastryep",
    template: "Bakery Website Pitch",
    status: "pending",
  },
  {
    id: "3",
    businessName: "Bloom & Stem House",
    category: "Florists",
    location: "Horizon City, TX",
    phone: "(915) 555-0167",
    email: "orders@bloomstem.test",
    websiteStatus: "No website",
    googleMapsUrl: "https://maps.google.com/?q=Bloom+Stem+Horizon",
    instagram: "https://instagram.com/bloomstemep",
    facebook: "https://facebook.com/bloomstem",
    template: "Florist Website Pitch",
    status: "sent",
  },
  {
    id: "4",
    businessName: "Low Desert Audio",
    category: "DJs",
    location: "El Paso, TX",
    phone: "(915) 555-0233",
    email: null,
    websiteStatus: "Weak site",
    googleMapsUrl: "https://maps.google.com/?q=Low+Desert+Audio",
    instagram: "Possible IG match",
    facebook: null,
    template: "General Small Business Pitch",
    status: "social_ready",
  },
  {
    id: "5",
    businessName: "Rios Mobile Mechanics",
    category: "Mechanics",
    location: "Socorro, TX",
    phone: "(915) 555-0104",
    email: "Email found",
    websiteStatus: "No website",
    googleMapsUrl: "https://maps.google.com/?q=Rios+Mobile+Mechanics",
    instagram: null,
    facebook: null,
    template: "General Small Business Pitch",
    status: "pending",
  },
  {
    id: "6",
    businessName: "Sparkle Haus Cleaning",
    category: "Cleaning Services",
    location: "El Paso, TX",
    phone: "(915) 555-0277",
    email: null,
    websiteStatus: "No website",
    googleMapsUrl: "https://maps.google.com/?q=Sparkle+Haus",
    instagram: "Possible IG match",
    facebook: "Possible FB match",
    template: "General Small Business Pitch",
    status: "pending",
  },
];

export const ownerPlaceholders = {
  ownerName: "Eric Capiz",
  phone: "(555) 010-4421",
  portfolioLink: "https://portfolio.example.com/eric-capiz",
  linkedIn: "https://linkedin.com/in/eric-capiz",
  sampleProjectLink: "https://demo.example.com/barber-booking",
} as const;

export const emailTemplateLibrary = [
  {
    id: "tpl-barber",
    name: "Barber Website Pitch" as const,
    category: "Barbers",
    subject: "Website / booking page for your barbershop",
    isActive: true,
  },
  {
    id: "tpl-bakery",
    name: "Bakery Website Pitch" as const,
    category: "Bakeries",
    subject: "A cleaner online presence for your bakery",
    isActive: true,
  },
  {
    id: "tpl-florist",
    name: "Florist Website Pitch" as const,
    category: "Florists",
    subject: "Showcase arrangements & delivery zones online",
    isActive: true,
  },
  {
    id: "tpl-general",
    name: "General Small Business Pitch" as const,
    category: "Any",
    subject: "Quick win: a simple site for {{businessName}}",
    isActive: true,
  },
] as const;
