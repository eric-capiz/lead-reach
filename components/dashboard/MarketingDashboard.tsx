"use client";

import { useMemo, useState } from "react";
import {
  APP_NAME,
  categories,
  emailTemplateLibrary,
  leadRows,
  ownerPlaceholders,
  stats,
  templateOptions,
  type LeadRow,
} from "@/lib/dashboard-dummy";

type TabId = "overview" | "leads" | "templates";

const statAccentColors = [
  "var(--color-lux-gold)",
  "var(--color-lux-crimson)",
  "var(--color-lux-teal)",
  "var(--color-lux-gold-bright)",
  "var(--color-lux-gold-muted)",
] as const;

const gridBg =
  "linear-gradient(rgba(201,162,39,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(201,162,39,0.04)_1px,transparent_1px)";

function templateBody(
  templateName: (typeof templateOptions)[number],
  o: typeof ownerPlaceholders,
) {
  const lines: Record<(typeof templateOptions)[number], string[]> = {
    "Barber Website Pitch": [
      `Hi {{businessName}},`,
      "",
      `I'm ${o.ownerName}. I build booking-ready sites for barbershops—clean, fast, mobile-first.`,
      "",
      `Sample booking flow: ${o.sampleProjectLink}`,
      `Portfolio: ${o.portfolioLink}`,
      "",
      `Happy to sketch something for your shop.`,
      `${o.phone} · ${o.linkedIn}`,
    ],
    "Bakery Website Pitch": [
      `Hello {{businessName}},`,
      "",
      `${o.ownerName} here—I craft landing pages that showcase menus and pickup windows.`,
      "",
      `Live bakery demo: ${o.sampleProjectLink}`,
      `Work: ${o.portfolioLink}`,
      "",
      `${o.phone}`,
    ],
    "Florist Website Pitch": [
      `Hi {{businessName}},`,
      "",
      `I'm ${o.ownerName}. Florists thrive when seasonal galleries and delivery zones read effortlessly.`,
      "",
      `${o.portfolioLink} · ${o.sampleProjectLink}`,
      "",
      `${o.linkedIn} · ${o.phone}`,
    ],
    "General Small Business Pitch": [
      `Hi {{businessName}},`,
      "",
      `${o.ownerName} · small-business websites & light booking flows.`,
      "",
      `${o.portfolioLink}`,
      `${o.sampleProjectLink}`,
      `${o.linkedIn} · ${o.phone}`,
    ],
  };
  return lines[templateName].join("\n");
}

function TemplatePreviewBody({ templateName }: { templateName: (typeof templateOptions)[number] }) {
  const body = useMemo(
    () => templateBody(templateName, ownerPlaceholders),
    [templateName],
  );
  return (
    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-lux-muted">
      {body}
    </pre>
  );
}

function statusLabel(s: LeadRow["status"]) {
  if (s === "sent") return "Contacted";
  if (s === "social_ready") return "Social ready";
  return "Pending";
}

function LeadCard({
  row,
  onTemplateChange,
}: {
  row: LeadRow;
  onTemplateChange: (id: string, t: (typeof templateOptions)[number]) => void;
}) {
  const done = row.status === "sent";
  const social = row.status === "social_ready";

  return (
    <article
      className={`group relative flex flex-col rounded-2xl border p-5 transition ${
        done
          ? "border-[color:var(--color-lux-emerald-ring)] bg-gradient-to-br from-lux-emerald-soft to-lux-panel shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55)] ring-1 ring-[color:var(--color-lux-gold-line)]/40"
          : social
            ? "border-[color:var(--color-lux-rose-ring)] bg-gradient-to-br from-lux-rose-soft to-lux-panel shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55)] ring-1 ring-[color:var(--color-lux-gold-line)]/35"
            : "border-lux-line bg-lux-panel shadow-[0_1px_0_var(--color-lux-rim)_inset,0_20px_50px_-18px_rgba(0,0,0,0.5)] ring-1 ring-[color:var(--color-lux-gold-line)]/15 hover:ring-[color:var(--color-lux-gold-line)]/35"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg font-semibold tracking-tight text-lux-fg">{row.businessName}</h3>
          <p className="mt-0.5 text-xs text-lux-muted">
            {row.category} · {row.location}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] ${
            done
              ? "border border-[color:var(--color-lux-emerald-ring)] bg-lux-emerald-soft/80 text-lux-done-fg"
              : social
                ? "border border-[color:var(--color-lux-rose-ring)] bg-lux-rose-soft/90 text-lux-social-fg"
                : "border border-[color:var(--color-lux-gold-line)] bg-lux-gold-soft text-lux-gold-bright"
          }`}
        >
          {statusLabel(row.status)}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div className="col-span-2 flex flex-wrap gap-2">
          <span className="rounded-sm border border-[color:var(--color-lux-gold-line)]/30 bg-lux-gold-soft px-2 py-1 font-mono text-[11px] text-lux-gold-bright">
            {row.phone}
          </span>
          <span className="rounded-sm border border-[color:var(--color-lux-crimson)]/25 bg-lux-crimson-soft px-2 py-1 text-[11px] font-medium text-lux-fg">
            {row.websiteStatus}
          </span>
        </div>
        <div className="col-span-2 text-lux-muted">
          <span className="text-lux-subtle">Email </span>
          {row.email ?? "—"}
        </div>
        <div className="col-span-2 flex flex-wrap gap-3 text-[11px]">
          <a href={row.googleMapsUrl} className="font-medium text-lux-link transition hover:text-lux-link-hover">
            Maps ↗
          </a>
          <span className="text-lux-subtle">
            IG:{" "}
            {row.instagram ? (
              row.instagram.startsWith("http") ? (
                <a href={row.instagram} className="font-medium text-lux-link transition hover:text-lux-link-hover">
                  open
                </a>
              ) : (
                <span className="font-medium text-lux-gold-bright">{row.instagram}</span>
              )
            ) : (
              "—"
            )}
          </span>
          <span className="text-lux-subtle">
            FB:{" "}
            {row.facebook ? (
              row.facebook.startsWith("http") ? (
                <a href={row.facebook} className="font-medium text-lux-link transition hover:text-lux-link-hover">
                  open
                </a>
              ) : (
                <span className="font-medium text-lux-gold-bright">{row.facebook}</span>
              )
            ) : (
              "—"
            )}
          </span>
        </div>
      </dl>

      <div className="mt-5 flex flex-col gap-3 border-t border-lux-line-soft pt-4 sm:flex-row sm:items-center">
        <select
          value={row.template}
          onChange={(e) =>
            onTemplateChange(row.id, e.target.value as (typeof templateOptions)[number])
          }
          className="min-w-0 flex-1 cursor-pointer rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-xs text-lux-fg-dim outline-none transition focus:border-lux-gold focus:ring-1 focus:ring-lux-gold-soft"
        >
          {templateOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded-sm bg-lux-primary px-4 py-2 text-xs font-semibold tracking-wide text-lux-primary-fg shadow-[0_6px_24px_-6px_rgba(201,162,39,0.45)] transition hover:bg-lux-primary-hover"
        >
          Send
        </button>
      </div>
    </article>
  );
}

const tabs: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "leads", label: "Leads table" },
  { id: "templates", label: "Email templates" },
];

const statRows = [
  { label: "Leads found", value: stats.leadsFound },
  { label: "No website", value: stats.noWebsite },
  { label: "Emails found", value: stats.emailsFound },
  { label: "Social matches", value: stats.socialMatches },
  { label: "Messages sent", value: stats.messagesSent },
] as const;

export function MarketingDashboard() {
  const [tab, setTab] = useState<TabId>("overview");
  const [rows, setRows] = useState(leadRows);
  const [selectedLibraryTemplate, setSelectedLibraryTemplate] = useState<
    (typeof emailTemplateLibrary)[number]["name"]
  >(emailTemplateLibrary[0]!.name);
  const [noWebsiteOnly, setNoWebsiteOnly] = useState(true);
  const [category, setCategory] = useState<string>(categories[0]!);
  const [locationText] = useState("El Paso, TX · 50 mile radius");

  const onTemplateChange = (id: string, t: (typeof templateOptions)[number]) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, template: t } : r)));
  };

  return (
    <div className="min-h-full bg-lux-bg text-lux-fg-dim">
      <div
        className="pointer-events-none fixed inset-0 bg-[length:48px_48px] opacity-[0.35]"
        style={{ backgroundImage: gridBg }}
      />
      <div
        className="pointer-events-none fixed inset-0 opacity-100"
        style={{
          backgroundImage: [
            "radial-gradient(ellipse 70% 50% at 50% -20%, var(--color-lux-gold-glow), transparent 55%)",
            "radial-gradient(ellipse 45% 40% at 100% 0%, rgba(45, 212, 191, 0.06), transparent 50%)",
            "radial-gradient(ellipse 40% 35% at 0% 80%, rgba(159, 27, 61, 0.07), transparent 50%)",
          ].join(", "),
        }}
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
        <header className="border-b border-[color:var(--color-lux-gold-line)]/50 pb-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.38em] text-lux-gold-bright">
                Outreach workspace
              </p>
              <h1 className="mt-2 font-serif text-4xl font-semibold tracking-[0.02em] text-lux-fg sm:text-5xl">
                {APP_NAME}
              </h1>
              <p className="mt-2 max-w-md text-sm text-lux-muted">
                Precision outreach intelligence — composed like briefings, built for outcomes.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <nav
                className="flex rounded-sm border border-lux-line bg-lux-panel/90 p-1 shadow-[0_1px_0_var(--color-lux-rim)_inset,0_12px_40px_-12px_rgba(0,0,0,0.45)] backdrop-blur-md"
                aria-label="Dashboard sections"
              >
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`rounded-sm px-4 py-2 text-xs font-semibold uppercase tracking-wider transition sm:px-5 ${
                      tab === t.id
                        ? "bg-gradient-to-b from-lux-primary to-[#8a721f] text-lux-primary-fg shadow-[0_4px_20px_-4px_rgba(201,162,39,0.4)]"
                        : "text-lux-muted hover:bg-lux-gold-soft/50 hover:text-lux-fg"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
              <button
                type="button"
                className="rounded-sm border border-[color:var(--color-lux-gold-line)] bg-lux-panel px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-lux-gold-bright shadow-[0_0_0_1px_rgba(201,162,39,0.12),0_12px_36px_-10px_rgba(0,0,0,0.5)] transition hover:bg-lux-gold-soft/30 hover:text-lux-fg"
              >
                Run Bot
              </button>
            </div>
          </div>
        </header>

        {tab === "overview" && (
          <div className="mt-12 space-y-12">
            <section className="rounded-sm border border-lux-line bg-lux-panel/95 p-8 shadow-[0_1px_0_var(--color-lux-rim)_inset,0_24px_60px_-28px_rgba(0,0,0,0.55)] sm:p-10">
              <p className="max-w-2xl font-serif text-lg leading-relaxed text-lux-fg-dim">
                Find category-based local businesses, flag weak or missing web presence, attach maps
                and social hints, then run templated outreach.{" "}
                <span className="text-lux-fg">
                  Hard cap of <strong className="text-lux-gold-bright">20 leads per search run</strong>.
                </span>
              </p>
              <p className="mt-4 text-xs uppercase tracking-widest text-lux-subtle">Preview · no backend</p>
            </section>

            <section className="grid gap-3 sm:grid-cols-5">
              {statRows.map((m, i) => (
                <div
                  key={m.label}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-4 py-5 shadow-[0_1px_0_var(--color-lux-rim)_inset,0_14px_32px_-14px_rgba(0,0,0,0.45)]"
                  style={{ borderTop: `3px solid ${statAccentColors[i]}` }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lux-gold-muted">
                    {m.label}
                  </p>
                  <p className="mt-2 font-mono text-3xl font-medium tabular-nums tracking-tight text-lux-fg">
                    {m.value}
                  </p>
                </div>
              ))}
            </section>

            <section className="rounded-sm border border-lux-line bg-lux-panel/95 p-8 shadow-[0_1px_0_var(--color-lux-rim)_inset,0_20px_50px_-24px_rgba(0,0,0,0.5)] sm:p-10">
              <h2 className="font-serif text-xl font-semibold text-lux-fg">Search</h2>
              <p className="mt-1 text-xs text-lux-muted">Controls are visual only for this pass.</p>
              <div className="mt-8 grid gap-6 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-gold-bright">
                    Category
                  </span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full cursor-pointer rounded-sm border border-lux-line bg-lux-field px-3 py-3 text-sm text-lux-fg-dim outline-none transition focus:border-lux-gold focus:ring-1 focus:ring-lux-gold-soft"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-2 sm:col-span-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-teal">
                    Location
                  </span>
                  <input
                    readOnly
                    value={locationText}
                    className="w-full rounded-sm border border-lux-line-soft bg-lux-raised px-3 py-3 font-mono text-xs text-lux-muted"
                  />
                </label>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={noWebsiteOnly}
                onClick={() => setNoWebsiteOnly((v) => !v)}
                className="mt-8 flex w-full max-w-md items-center justify-between gap-4 rounded-sm border border-lux-line bg-lux-field px-4 py-3.5 text-left text-sm text-lux-fg-dim transition hover:border-lux-gold/40"
              >
                Only businesses without websites
                <span
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    noWebsiteOnly ? "bg-gradient-to-r from-lux-gold to-[#8a721f]" : "bg-lux-line-soft"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-lux-fg shadow-sm ring-1 ring-lux-line transition-transform ${
                      noWebsiteOnly ? "translate-x-5" : ""
                    }`}
                  />
                </span>
              </button>
              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-sm border border-lux-line bg-lux-canvas px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-fg-dim transition hover:border-lux-gold/40 hover:text-lux-gold-bright"
                >
                  Category search
                </button>
                <button
                  type="button"
                  className="rounded-sm border border-lux-line bg-lux-canvas px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-fg-dim transition hover:border-lux-teal/40 hover:text-lux-link"
                >
                  Direct name search
                </button>
              </div>
            </section>
          </div>
        )}

        {tab === "leads" && (
          <div className="mt-12">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-serif text-2xl font-semibold text-lux-fg">Leads</h2>
                <p className="text-xs text-lux-muted">Ledger layout · dummy data</p>
              </div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-lux-gold-muted">
                20 leads max per run
              </p>
            </div>
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              {rows.map((row) => (
                <LeadCard key={row.id} row={row} onTemplateChange={onTemplateChange} />
              ))}
            </div>
          </div>
        )}

        {tab === "templates" && (
          <div className="mt-12 grid gap-10 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="space-y-3 border-l-2 border-[color:var(--color-lux-gold)]/60 pl-6">
              <h2 className="font-serif text-2xl font-semibold text-lux-gold-bright">Library</h2>
              <p className="text-xs text-lux-muted">Correspondence templates</p>
              <ul className="mt-6 space-y-2">
                {emailTemplateLibrary.map((tpl) => (
                  <li key={tpl.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedLibraryTemplate(tpl.name)}
                      className={`flex w-full flex-col rounded-sm border px-4 py-3.5 text-left transition ${
                        selectedLibraryTemplate === tpl.name
                          ? "border-lux-gold bg-lux-raised shadow-md ring-1 ring-[color:var(--color-lux-gold-line)]"
                          : "border-lux-line bg-lux-panel/80 hover:border-lux-gold/35"
                      }`}
                    >
                      <span className="text-sm font-medium text-lux-fg">{tpl.name}</span>
                      <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-lux-teal">
                        {tpl.category}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <div className="space-y-8">
              <div className="rounded-sm border border-lux-line bg-lux-panel/95 p-8 shadow-[0_1px_0_var(--color-lux-rim)_inset,0_16px_40px_-18px_rgba(0,0,0,0.45)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-gold-bright">
                  Subject
                </p>
                <p className="mt-3 font-serif text-base text-lux-fg-dim">
                  {emailTemplateLibrary.find((t) => t.name === selectedLibraryTemplate)?.subject}
                </p>
              </div>
              <div className="rounded-sm border border-lux-line bg-lux-canvas p-8 shadow-[0_14px_40px_-16px_rgba(0,0,0,0.4)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-teal">
                  Body preview
                </p>
                <div className="mt-4 max-h-[340px] overflow-auto rounded-sm border border-lux-line bg-lux-field p-4 shadow-[inset_0_2px_14px_rgba(0,0,0,0.5)]">
                  <TemplatePreviewBody templateName={selectedLibraryTemplate} />
                </div>
              </div>
              <div className="rounded-sm border border-lux-line bg-lux-panel/90 p-8 shadow-[0_1px_0_var(--color-lux-rim)_inset]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-crimson">
                  Merge fields
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-widest text-lux-subtle">Static mock</p>
                <dl className="mt-6 grid gap-4 text-xs sm:grid-cols-2">
                  <div className="border-b border-lux-line-soft pb-3 sm:border-0 sm:pb-0">
                    <dt className="text-lux-muted">Name</dt>
                    <dd className="mt-1 font-mono text-lux-fg-dim">{ownerPlaceholders.ownerName}</dd>
                  </div>
                  <div className="border-b border-lux-line-soft pb-3 sm:border-0 sm:pb-0">
                    <dt className="text-lux-muted">Phone</dt>
                    <dd className="mt-1 font-mono text-lux-fg-dim">{ownerPlaceholders.phone}</dd>
                  </div>
                  <div className="col-span-full border-b border-lux-line-soft pb-3">
                    <dt className="text-lux-muted">Portfolio</dt>
                    <dd className="mt-1">
                      <a href="#" className="break-all font-mono text-lux-link hover:text-lux-link-hover">
                        {ownerPlaceholders.portfolioLink}
                      </a>
                    </dd>
                  </div>
                  <div className="col-span-full border-b border-lux-line-soft pb-3">
                    <dt className="text-lux-muted">LinkedIn</dt>
                    <dd className="mt-1">
                      <a href="#" className="break-all font-mono text-lux-gold-bright hover:underline">
                        {ownerPlaceholders.linkedIn}
                      </a>
                    </dd>
                  </div>
                  <div className="col-span-full">
                    <dt className="text-lux-muted">Sample project</dt>
                    <dd className="mt-1">
                      <a href="#" className="break-all font-mono text-lux-teal hover:text-lux-link-hover">
                        {ownerPlaceholders.sampleProjectLink}
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
