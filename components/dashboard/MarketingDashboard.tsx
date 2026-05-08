"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_NAME } from "@/lib/constants";
import type { LeadStatus, WebsiteFilter } from "@/lib/constants";
import { applyMergeTemplate, buildMergeMap } from "@/lib/merge";
import { LeadCard } from "./LeadCard";
import type { LeadApi, MergeFieldLite, TemplateLite } from "@/lib/types/dashboard";

type TabId = "overview" | "leads" | "templates";

type CategoryRow = { _id: string; name: string; order: number };

type SettingsRow = {
  _id: string;
  locationAddress: string;
  radiusMiles: number;
  websiteFilter: WebsiteFilter;
};

const statAccentColors = [
  "var(--color-lux-gold)",
  "var(--color-lux-crimson)",
  "var(--color-lux-teal)",
  "var(--color-lux-gold-bright)",
  "var(--color-lux-gold-muted)",
] as const;

const gridBg =
  "linear-gradient(rgba(201,162,39,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(201,162,39,0.04)_1px,transparent_1px)";

const tabs: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "leads", label: "Leads table" },
  { id: "templates", label: "Email templates" },
];

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error((j as { error?: string }).error || r.statusText);
  return j;
}

function normalizeLead(raw: Record<string, unknown>): LeadApi {
  let templateId: string | null = null;
  const tp = raw.templateId;
  if (tp && typeof tp === "object" && "_id" in (tp as object)) {
    templateId = String((tp as { _id: unknown })._id);
  } else if (typeof tp === "string") templateId = tp;

  return {
    _id: String(raw._id),
    businessName: String(raw.businessName ?? ""),
    category: String(raw.category ?? ""),
    location: String(raw.location ?? ""),
    phone: String(raw.phone ?? ""),
    email: (raw.email as string | null) ?? null,
    websiteStatus: String(raw.websiteStatus ?? ""),
    googleMapsUrl: String(raw.googleMapsUrl ?? ""),
    instagram: (raw.instagram as string | null) ?? null,
    facebook: (raw.facebook as string | null) ?? null,
    status: raw.status as LeadStatus,
    templateId,
    templateName: (raw.templateName as string | null) ?? null,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : "",
  };
}

export function MarketingDashboard() {
  const [tab, setTab] = useState<TabId>("overview");
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [runBusy, setRunBusy] = useState(false);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [locDraft, setLocDraft] = useState("");
  const [radiusDraft, setRadiusDraft] = useState(50);
  const [filterDraft, setFilterDraft] = useState<WebsiteFilter>("no_website");

  const [categoryId, setCategoryId] = useState("");
  const [nameQuery, setNameQuery] = useState("");

  const categorySelectValue = useMemo(() => {
    if (!categories.length) return "";
    if (categoryId && categories.some((c) => c._id === categoryId)) return categoryId;
    return categories[0]!._id;
  }, [categories, categoryId]);

  const [templates, setTemplates] = useState<TemplateLite[]>([]);
  const [mergeFields, setMergeFields] = useState<MergeFieldLite[]>([]);
  const [leads, setLeads] = useState<LeadApi[]>([]);
  const [stats, setStats] = useState({
    leadsFound: 0,
    noWebsite: 0,
    emailsFound: 0,
    socialMatches: 0,
    messagesSent: 0,
  });

  const [selectedTplId, setSelectedTplId] = useState<string | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplSubject, setTplSubject] = useState("");
  const [tplBody, setTplBody] = useState("");
  const [tplDirty, setTplDirty] = useState(false);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newMergeKey, setNewMergeKey] = useState("");
  const [newMergeLabel, setNewMergeLabel] = useState("");
  const [newMergeValue, setNewMergeValue] = useState("");

  const refresh = useCallback(
    async (options?: { forceTemplateSync?: boolean }) => {
      const ignoreTplDirty = options?.forceTemplateSync === true;
    const [c, s, t, m, l, st] = await Promise.all([
      apiJson<{ items: CategoryRow[] }>("/api/categories"),
      apiJson<{ settings: SettingsRow | null }>("/api/settings"),
      apiJson<{ items: Record<string, unknown>[] }>("/api/templates"),
      apiJson<{ items: MergeFieldLite[] }>("/api/merge-fields"),
      apiJson<{ items: Record<string, unknown>[] }>("/api/leads"),
      apiJson<{
        stats: {
          leadsFound: number;
          noWebsite: number;
          emailsFound: number;
          socialMatches: number;
          messagesSent: number;
        };
      }>("/api/stats"),
    ]);

    setCategories(c.items);
    if (s.settings) {
      setLocDraft(s.settings.locationAddress);
      setRadiusDraft(s.settings.radiusMiles);
      setFilterDraft(s.settings.websiteFilter);
    }
    const tItems = t.items.map((row) => ({
      _id: String(row._id),
      name: String(row.name),
      subject: String(row.subject ?? ""),
      body: String(row.body ?? ""),
    }));
    setTemplates(tItems);
    const templateLocked = tplDirty && !ignoreTplDirty;
    if (!templateLocked && tItems.length) {
      let pickId = selectedTplId;
      if (!pickId || !tItems.some((x) => x._id === pickId)) pickId = tItems[0]!._id;
      const row = tItems.find((x) => x._id === pickId)!;
      setSelectedTplId(row._id);
      setTplName(row.name);
      setTplSubject(row.subject);
      setTplBody(row.body);
    } else if (!tItems.length) {
      setSelectedTplId(null);
      setTplName("");
      setTplSubject("");
      setTplBody("");
    }
    setMergeFields(m.items);
    setLeads(l.items.map((x) => normalizeLead(x)));
    setStats(st.stats);
  },
  [tplDirty, selectedTplId],
);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await apiJson("/api/bootstrap");
        if (!cancelled) await refresh();
      } catch (e) {
        if (!cancelled) setBootError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const selectedCategoryName = useMemo(() => {
    return categories.find((c) => c._id === categorySelectValue)?.name ?? "";
  }, [categories, categorySelectValue]);

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t._id === selectedTplId) ?? templates[0] ?? null;
  }, [templates, selectedTplId]);

  const previewMerged = useMemo(() => {
    if (!selectedTemplate) return "";
    const map = buildMergeMap(
      mergeFields.map((f) => ({ key: f.key, value: f.value })),
      {
        businessname: "Sample Business LLC",
        category: selectedCategoryName || "General",
      },
    );
    return applyMergeTemplate(selectedTemplate.body, map);
  }, [selectedTemplate, mergeFields, selectedCategoryName]);

  const saveSettings = async () => {
    try {
      await apiJson<{ settings: SettingsRow }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          locationAddress: locDraft,
          radiusMiles: radiusDraft,
          websiteFilter: filterDraft,
        }),
      });
      await refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Save failed");
    }
  };

  const runPlaces = async (mode: "category" | "name") => {
    try {
      setRunBusy(true);
      const res = await apiJson<{
        ok: boolean;
        textQuery: string;
        rawCount: number;
        matchedCount: number;
        savedCount: number;
      }>("/api/runs/places", {
        method: "POST",
        body: JSON.stringify({
          mode,
          categoryName: mode === "category" ? selectedCategoryName : undefined,
          nameQuery: nameQuery.trim() || undefined,
          websiteFilter: filterDraft,
        }),
      });
      await refresh();
      window.alert(
        `Run complete.\nQuery: ${res.textQuery}\nPlaces returned: ${res.rawCount}\nAfter website filter: ${res.matchedCount}\nUpserted leads: ${res.savedCount}`,
      );
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunBusy(false);
    }
  };

  const addCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      await apiJson("/api/categories", { method: "POST", body: JSON.stringify({ name }) });
      setNewCategoryName("");
      await refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const deleteCategory = async (id: string) => {
    if (!window.confirm("Delete this category?")) return;
    try {
      await apiJson(`/api/categories/${id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const saveTemplate = async () => {
    if (!selectedTplId) return;
    try {
      await apiJson(`/api/templates/${selectedTplId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: tplName, subject: tplSubject, body: tplBody }),
      });
      setTplDirty(false);
      await refresh({ forceTemplateSync: true });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const addTemplate = async () => {
    const name = window.prompt("New template name");
    if (!name?.trim()) return;
    try {
      await apiJson("/api/templates", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          subject: "New outreach",
          body: "Hi {{businessName}},\n\n{{myName}}",
        }),
      });
      setTplDirty(false);
      await refresh({ forceTemplateSync: true });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const deleteTemplate = async () => {
    if (!selectedTplId) return;
    if (!window.confirm("Delete this template? Leads using it will be reassigned.")) return;
    try {
      await apiJson(`/api/templates/${selectedTplId}`, { method: "DELETE" });
      setTplDirty(false);
      await refresh({ forceTemplateSync: true });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const patchMergeField = async (id: string, patch: Partial<MergeFieldLite>) => {
    await apiJson(`/api/merge-fields/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await refresh();
  };

  const addMergeField = async () => {
    const key = newMergeKey.trim();
    const label = newMergeLabel.trim();
    if (!key || !label) {
      window.alert("Key and label required");
      return;
    }
    try {
      await apiJson("/api/merge-fields", {
        method: "POST",
        body: JSON.stringify({ key, label, value: newMergeValue }),
      });
      setNewMergeKey("");
      setNewMergeLabel("");
      setNewMergeValue("");
      await refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const deleteMergeField = async (id: string) => {
    if (!window.confirm("Delete this merge field?")) return;
    try {
      await apiJson(`/api/merge-fields/${id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const onTemplateChange = async (leadId: string, templateId: string) => {
    await apiJson(`/api/leads/${leadId}`, {
      method: "PATCH",
      body: JSON.stringify({ templateId }),
    });
    await refresh();
  };

  const onStatusChange = async (leadId: string, status: LeadStatus) => {
    await apiJson(`/api/leads/${leadId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await refresh();
  };

  const onContactPatch = async (
    leadId: string,
    patch: { email?: string | null; instagram?: string | null; facebook?: string | null },
  ) => {
    await apiJson(`/api/leads/${leadId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await refresh();
  };

  const onDeleteLead = async (leadId: string) => {
    await apiJson(`/api/leads/${leadId}`, { method: "DELETE" });
    await refresh();
  };

  const statRows = [
    { label: "Leads found", value: stats.leadsFound },
    { label: "No website", value: stats.noWebsite },
    { label: "Emails found", value: stats.emailsFound },
    { label: "Social matches", value: stats.socialMatches },
    { label: "Messages sent", value: stats.messagesSent },
  ] as const;

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-lux-bg font-sans text-lux-muted">
        Loading workspace…
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-lux-bg px-6 text-center font-sans text-lux-crimson">
        <p>{bootError}</p>
        <p className="max-w-md text-sm text-lux-muted">Check MONGODB_URI and that MongoDB Atlas allows your IP.</p>
      </div>
    );
  }

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
                disabled={runBusy}
                onClick={() => void runPlaces("category")}
                className="rounded-sm border border-[color:var(--color-lux-gold-line)] bg-lux-panel px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-lux-gold-bright shadow-[0_0_0_1px_rgba(201,162,39,0.12),0_12px_36px_-10px_rgba(0,0,0,0.5)] transition hover:bg-lux-gold-soft/30 hover:text-lux-fg disabled:opacity-40"
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
                Find category-based local businesses, flag weak or missing web presence, attach maps and social hints,
                then run templated outreach.{" "}
                <span className="text-lux-fg">
                  Hard cap of <strong className="text-lux-gold-bright">20 leads per search run</strong>.
                </span>
              </p>
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
              <p className="mt-1 text-xs text-lux-muted">Saves to MongoDB. Uses Google Places + Geocoding.</p>
              <div className="mt-8 grid gap-6 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-gold-bright">
                    Category
                  </span>
                  <select
                    value={categorySelectValue}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full cursor-pointer rounded-sm border border-lux-line bg-lux-field px-3 py-3 text-sm text-lux-fg-dim outline-none transition focus:border-lux-gold focus:ring-1 focus:ring-lux-gold-soft"
                  >
                    {categories.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-teal">
                    Name contains (optional)
                  </span>
                  <input
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    placeholder="e.g. bakery, barber, or business name"
                    className="w-full rounded-sm border border-lux-line bg-lux-field px-3 py-3 text-sm text-lux-fg-dim outline-none transition focus:border-lux-gold focus:ring-1 focus:ring-lux-gold-soft"
                  />
                </label>
                <label className="block space-y-2 sm:col-span-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-teal">
                    Location (geocoded)
                  </span>
                  <input
                    value={locDraft}
                    onChange={(e) => setLocDraft(e.target.value)}
                    className="w-full rounded-sm border border-lux-line bg-lux-field px-3 py-3 font-mono text-xs text-lux-fg-dim outline-none transition focus:border-lux-gold focus:ring-1 focus:ring-lux-gold-soft"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-gold-bright">
                    Radius (miles)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={radiusDraft}
                    onChange={(e) => setRadiusDraft(Number(e.target.value))}
                    className="w-full rounded-sm border border-lux-line bg-lux-field px-3 py-3 font-mono text-sm text-lux-fg-dim outline-none focus:border-lux-gold"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-gold-bright">
                    Website filter for run
                  </span>
                  <select
                    value={filterDraft}
                    onChange={(e) => setFilterDraft(e.target.value as WebsiteFilter)}
                    className="w-full cursor-pointer rounded-sm border border-lux-line bg-lux-field px-3 py-3 text-sm outline-none focus:border-lux-gold"
                  >
                    <option value="no_website">No public website only</option>
                    <option value="any">Any</option>
                    <option value="has_website">Has website only</option>
                  </select>
                </label>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void saveSettings()}
                  className="rounded-sm border border-lux-gold/50 bg-lux-gold-soft/20 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-gold-bright transition hover:bg-lux-gold-soft/40"
                >
                  Save search settings
                </button>
                <button
                  type="button"
                  disabled={runBusy}
                  onClick={() => void runPlaces("category")}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-fg-dim transition hover:border-lux-gold/40 hover:text-lux-gold-bright disabled:opacity-40"
                >
                  Category search run
                </button>
                <button
                  type="button"
                  disabled={runBusy}
                  onClick={() => void runPlaces("name")}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-fg-dim transition hover:border-lux-teal/40 hover:text-lux-link disabled:opacity-40"
                >
                  Direct name run
                </button>
              </div>
            </section>

            <section className="rounded-sm border border-lux-line bg-lux-panel/95 p-8 shadow-[0_1px_0_var(--color-lux-rim)_inset] sm:p-10">
              <h2 className="font-serif text-xl font-semibold text-lux-fg">Categories</h2>
              <p className="mt-1 text-xs text-lux-muted">Add or remove labels used for search and leads.</p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {categories.map((c) => (
                  <li
                    key={c._id}
                    className="flex items-center gap-2 rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-xs"
                  >
                    <span>{c.name}</span>
                    <button
                      type="button"
                      onClick={() => void deleteCategory(c._id)}
                      className="text-lux-crimson hover:underline"
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  className="min-w-[200px] flex-1 rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-sm outline-none focus:border-lux-gold"
                />
                <button
                  type="button"
                  onClick={() => void addCategory()}
                  className="rounded-sm bg-lux-primary px-4 py-2 text-xs font-semibold text-lux-primary-fg"
                >
                  Add category
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
                <p className="text-xs text-lux-muted">Stored in MongoDB · up to 20 new matches per Places run</p>
              </div>
            </div>
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              {leads.map((row) => (
                <LeadCard
                  key={`${row._id}-${row.updatedAt ?? ""}`}
                  row={row}
                  templates={templates}
                  mergeFields={mergeFields}
                  onTemplateChange={onTemplateChange}
                  onStatusChange={onStatusChange}
                  onContactPatch={onContactPatch}
                  onDelete={onDeleteLead}
                />
              ))}
              {!leads.length && (
                <p className="col-span-full text-sm text-lux-muted">No leads yet. Run a search from Overview.</p>
              )}
            </div>
          </div>
        )}

        {tab === "templates" && (
          <div className="mt-12 grid gap-10 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="space-y-3 border-l-2 border-[color:var(--color-lux-gold)]/60 pl-6">
              <h2 className="font-serif text-2xl font-semibold text-lux-gold-bright">Library</h2>
              <p className="text-xs text-lux-muted">Correspondence templates</p>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void addTemplate()}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-lux-muted hover:border-lux-gold/40"
                >
                  New template
                </button>
                <button
                  type="button"
                  onClick={() => void deleteTemplate()}
                  className="rounded-sm border border-lux-crimson/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-lux-crimson hover:bg-lux-crimson-soft"
                >
                  Delete selected
                </button>
              </div>
              <ul className="mt-4 space-y-2">
                {templates.map((tpl) => (
                  <li key={tpl._id}>
                    <button
                      type="button"
                      onClick={() => {
                        setTplDirty(false);
                        setSelectedTplId(tpl._id);
                        setTplName(tpl.name);
                        setTplSubject(tpl.subject);
                        setTplBody(tpl.body);
                      }}
                      className={`flex w-full flex-col rounded-sm border px-4 py-3.5 text-left transition ${
                        selectedTplId === tpl._id
                          ? "border-lux-gold bg-lux-raised shadow-md ring-1 ring-[color:var(--color-lux-gold-line)]"
                          : "border-lux-line bg-lux-panel/80 hover:border-lux-gold/35"
                      }`}
                    >
                      <span className="text-sm font-medium text-lux-fg">{tpl.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <div className="space-y-8">
              <div className="rounded-sm border border-lux-line bg-lux-panel/95 p-8 shadow-[0_1px_0_var(--color-lux-rim)_inset,0_16px_40px_-18px_rgba(0,0,0,0.45)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-gold-bright">Edit</p>
                <label className="mt-4 block text-xs text-lux-muted">
                  Name
                  <input
                    value={tplName}
                    onChange={(e) => {
                      setTplDirty(true);
                      setTplName(e.target.value);
                    }}
                    className="mt-1 w-full rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-sm text-lux-fg outline-none focus:border-lux-gold"
                  />
                </label>
                <label className="mt-3 block text-xs text-lux-muted">
                  Subject
                  <input
                    value={tplSubject}
                    onChange={(e) => {
                      setTplDirty(true);
                      setTplSubject(e.target.value);
                    }}
                    className="mt-1 w-full rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-sm text-lux-fg outline-none focus:border-lux-gold"
                  />
                </label>
                <label className="mt-3 block text-xs text-lux-muted">
                  Body (use {"{{myName}}"}, {"{{businessName}}"}, etc.)
                  <textarea
                    value={tplBody}
                    onChange={(e) => {
                      setTplDirty(true);
                      setTplBody(e.target.value);
                    }}
                    rows={12}
                    className="mt-1 w-full rounded-sm border border-lux-line bg-lux-field px-3 py-2 font-mono text-xs text-lux-fg-dim outline-none focus:border-lux-gold"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void saveTemplate()}
                  className="mt-4 rounded-sm bg-lux-primary px-5 py-2 text-xs font-semibold text-lux-primary-fg"
                >
                  Save template
                </button>
              </div>
              <div className="rounded-sm border border-lux-line bg-lux-canvas p-8 shadow-[0_14px_40px_-16px_rgba(0,0,0,0.4)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-teal">Body preview</p>
                <div className="mt-4 max-h-[340px] overflow-auto rounded-sm border border-lux-line bg-lux-field p-4 shadow-[inset_0_2px_14px_rgba(0,0,0,0.5)]">
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-lux-muted">
                    {previewMerged}
                  </pre>
                </div>
              </div>
              <div className="rounded-sm border border-lux-line bg-lux-panel/90 p-8 shadow-[0_1px_0_var(--color-lux-rim)_inset]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-crimson">Merge fields</p>
                <p className="mt-1 text-[10px] uppercase tracking-widest text-lux-subtle">
                  Keys are lowercased. Use in templates as {"{{key}}"}. Business fields: {"{{businessName}}"}{" "}
                  {"{{category}}"}.
                </p>
                <ul className="mt-6 space-y-4">
                  {mergeFields.map((mf) => (
                    <li key={mf._id} className="grid gap-2 border-b border-lux-line-soft pb-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                      <label className="text-[10px] uppercase text-lux-muted">
                        Key
                        <input
                          defaultValue={mf.key}
                          key={mf._id + mf.key}
                          onBlur={(e) => {
                            const v = e.target.value.trim().toLowerCase();
                            if (v && v !== mf.key) void patchMergeField(mf._id, { key: v });
                          }}
                          className="mt-1 block w-full rounded-sm border border-lux-line bg-lux-field px-2 py-1 font-mono text-xs outline-none focus:border-lux-gold"
                        />
                      </label>
                      <label className="text-[10px] uppercase text-lux-muted">
                        Label / value
                        <div className="mt-1 flex flex-col gap-1 sm:flex-row">
                          <input
                            defaultValue={mf.label}
                            key={mf._id + "l" + mf.label}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && v !== mf.label) void patchMergeField(mf._id, { label: v });
                            }}
                            className="w-full rounded-sm border border-lux-line bg-lux-field px-2 py-1 text-xs outline-none sm:w-1/3"
                          />
                          <input
                            defaultValue={mf.value}
                            key={mf._id + "v" + mf.value}
                            onBlur={(e) => {
                              const v = e.target.value;
                              if (v !== mf.value) void patchMergeField(mf._id, { value: v });
                            }}
                            className="w-full flex-1 rounded-sm border border-lux-line bg-lux-field px-2 py-1 font-mono text-xs outline-none"
                          />
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={() => void deleteMergeField(mf._id)}
                        className="text-[10px] font-semibold uppercase text-lux-crimson hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 grid gap-2 border-t border-lux-line-soft pt-4 sm:grid-cols-3">
                  <input
                    value={newMergeKey}
                    onChange={(e) => setNewMergeKey(e.target.value)}
                    placeholder="key e.g. myName"
                    className="rounded-sm border border-lux-line bg-lux-field px-2 py-2 font-mono text-xs outline-none"
                  />
                  <input
                    value={newMergeLabel}
                    onChange={(e) => setNewMergeLabel(e.target.value)}
                    placeholder="Label"
                    className="rounded-sm border border-lux-line bg-lux-field px-2 py-2 text-xs outline-none"
                  />
                  <div className="flex gap-2">
                    <input
                      value={newMergeValue}
                      onChange={(e) => setNewMergeValue(e.target.value)}
                      placeholder="Value / URL"
                      className="min-w-0 flex-1 rounded-sm border border-lux-line bg-lux-field px-2 py-2 font-mono text-xs outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void addMergeField()}
                      className="shrink-0 rounded-sm bg-lux-teal/20 px-3 py-2 text-[10px] font-semibold uppercase text-lux-link"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
