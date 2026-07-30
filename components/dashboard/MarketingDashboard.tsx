"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_NAME } from "@/lib/constants";
import { LEADS_PAGE_SIZE } from "@/lib/leads-page";
import type { LeadStatus, WebsiteFilter } from "@/lib/constants";
import { applyMergeTemplate, buildMergeMap } from "@/lib/merge";
import { LeadCard } from "./LeadCard";
import type { LeadApi, MergeFieldLite, TemplateLite } from "@/lib/types/dashboard";

type TabId = "overview" | "leads" | "templates";

type CategoryRow = { _id: string; name: string; order: number; isDefault?: boolean };

type SettingsRow = {
  _id: string;
  locationAddress: string;
  radiusMiles: number;
  websiteFilter: WebsiteFilter;
};

type LeadsApiResponse = {
  items: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
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

const RUN_SUCCESS_AUTO_DISMISS_MS = 10_000;
type RunSuccessSummary = {
  textQuery: string;
  rawCount: number;
  matchedCount: number;
  savedCount: number;
};

type SocialBatchSummary = {
  updatedLeads: number;
  processedLeads: number;
  scrapeNote?: string;
  skipReason?: string;
};

type SocialSearchApiResponse = {
  note?: string;
  network?: string;
  skipped?: boolean;
  skipReason?: string;
  batch?: boolean;
  processed?: number;
  updatedCount?: number;
  pageSize?: number;
  results?: unknown[];
  businessName?: string;
  facebook?: string | null;
  instagram?: string | null;
  updated?: boolean;
  socialDebug?: unknown;
  urlsFromSearchResults?: {
    facebook: {
      query: string | null;
      winningQuery: string | null;
      urls: string[];
      serpSearchUrlForDisplayQuery?: string;
    };
    instagram: { query: string | null; winningQuery: string | null; urls: string[] };
  };
};

/** Same rules as server leadNeedsSocialEnrichment: which rows on this page can still get socials. */
function pageLeadNeedsSocialEnrichment(lead: LeadApi): boolean {
  const hasFb = typeof lead.facebook === "string" && lead.facebook.trim().length > 0;
  const hasIg = typeof lead.instagram === "string" && lead.instagram.trim().length > 0;
  if (hasFb && hasIg) return false;
  return `${lead.businessName ?? ""} ${lead.location ?? ""}`.trim().length > 0;
}

type SocialProgressState = {
  batchDone: number;
  totalBatches: number;
  checkedSoFar: number;
  updatedSoFar: number;
  currentLeadName?: string;
};

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
  const raw = await r.text();
  const trimmed = raw.trim();

  // Turbopack sometimes returns an HTML error page instead of the route JSON after HMR/long runs.
  if (trimmed.startsWith("<!") || trimmed.toLowerCase().startsWith("<html")) {
    throw new Error(
      "Dev server returned HTML instead of JSON (hot-reload glitch). Refresh the page, or restart `npm run dev` if it keeps happening.",
    );
  }

  let j: T & { error?: string };
  try {
    j = JSON.parse(raw || "{}") as T & { error?: string };
  } catch {
    throw new Error(
      `Bad response from ${path} (not JSON). Refresh the page or restart the dev server.`,
    );
  }
  if (!r.ok) throw new Error(j.error || r.statusText);
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
    websiteUri: (() => {
      const w = raw.websiteUri;
      if (typeof w === "string" && w.trim()) return w.trim();
      return null;
    })(),
    googleMapsUrl: String(raw.googleMapsUrl ?? ""),
    instagram: (raw.instagram as string | null) ?? null,
    facebook: (raw.facebook as string | null) ?? null,
    status: raw.status as LeadStatus,
    templateId,
    templateName: (raw.templateName as string | null) ?? null,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : "",
    isSample: raw.isSample === true,
  };
}

export function MarketingDashboard({
  showSetupPopup,
  currentUsername,
}: {
  showSetupPopup?: boolean;
  currentUsername?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("overview");
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [runBusy, setRunBusy] = useState(false);
  const [socialsBusy, setSocialsBusy] = useState(false);
  const [runSuccess, setRunSuccess] = useState<RunSuccessSummary | null>(null);
  const runSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [socialSuccess, setSocialSuccess] = useState<SocialBatchSummary | null>(null);
  const socialSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [socialProgress, setSocialProgress] = useState<SocialProgressState | null>(null);
  const [setupModalOpen, setSetupModalOpen] = useState(Boolean(showSetupPopup));
  const [setupBusy, setSetupBusy] = useState(false);

  const clearRunSuccessTimer = useCallback(() => {
    if (runSuccessTimerRef.current) {
      clearTimeout(runSuccessTimerRef.current);
      runSuccessTimerRef.current = null;
    }
  }, []);

  const dismissRunSuccess = useCallback(() => {
    clearRunSuccessTimer();
    setRunSuccess(null);
  }, [clearRunSuccessTimer]);

  const clearSocialSuccessTimer = useCallback(() => {
    if (socialSuccessTimerRef.current) {
      clearTimeout(socialSuccessTimerRef.current);
      socialSuccessTimerRef.current = null;
    }
  }, []);

  const dismissSocialSuccess = useCallback(() => {
    clearSocialSuccessTimer();
    setSocialSuccess(null);
  }, [clearSocialSuccessTimer]);

  const showSocialSuccess = useCallback(
    (summary: SocialBatchSummary) => {
      clearSocialSuccessTimer();
      setSocialSuccess(summary);
      socialSuccessTimerRef.current = setTimeout(() => {
        setSocialSuccess(null);
        socialSuccessTimerRef.current = null;
      }, RUN_SUCCESS_AUTO_DISMISS_MS);
    },
    [clearSocialSuccessTimer],
  );

  const showRunSuccess = useCallback(
    (summary: RunSuccessSummary) => {
      clearRunSuccessTimer();
      setRunSuccess(summary);
      runSuccessTimerRef.current = setTimeout(() => {
        setRunSuccess(null);
        runSuccessTimerRef.current = null;
      }, RUN_SUCCESS_AUTO_DISMISS_MS);
    },
    [clearRunSuccessTimer],
  );

  useEffect(() => () => clearRunSuccessTimer(), [clearRunSuccessTimer]);
  useEffect(() => () => clearSocialSuccessTimer(), [clearSocialSuccessTimer]);
  useEffect(() => {
    setSetupModalOpen(Boolean(showSetupPopup));
  }, [showSetupPopup]);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [locDraft, setLocDraft] = useState("");
  const [useLocationBusy, setUseLocationBusy] = useState(false);
  const [useLocationError, setUseLocationError] = useState<string | null>(null);
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
  const [leadsPage, setLeadsPage] = useState(1);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsTotalPages, setLeadsTotalPages] = useState(1);
  const [leadsSearchDraft, setLeadsSearchDraft] = useState("");
  const [leadsSearchQuery, setLeadsSearchQuery] = useState("");
  const [leadsSort, setLeadsSort] = useState<"new" | "old">("new");
  const [stats, setStats] = useState({
    leadsFound: 0,
    noWebsite: 0,
    emailsFound: 0,
    socialMatches: 0,
    messagesSent: 0,
    leadsNeedingSocials: 0,
  });

  const [selectedTplId, setSelectedTplId] = useState<string | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplSubject, setTplSubject] = useState("");
  const [tplBody, setTplBody] = useState("");
  const [tplDmBody, setTplDmBody] = useState("");
  const [tplCategoryTag, setTplCategoryTag] = useState("");
  const [tplUseWhenNoCategoryMatch, setTplUseWhenNoCategoryMatch] = useState(false);
  const [tplDirty, setTplDirty] = useState(false);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newMergeKey, setNewMergeKey] = useState("");
  const [newMergeLabel, setNewMergeLabel] = useState("");
  const [newMergeValue, setNewMergeValue] = useState("");
  const [deleteAllModalOpen, setDeleteAllModalOpen] = useState(false);
  const [deleteAllBusy, setDeleteAllBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [newTemplateModalOpen, setNewTemplateModalOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateBusy, setNewTemplateBusy] = useState(false);
  const [deleteTemplateModalOpen, setDeleteTemplateModalOpen] = useState(false);
  const [deleteTemplateBusy, setDeleteTemplateBusy] = useState(false);
  const [leadDeleteTarget, setLeadDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteLeadBusy, setDeleteLeadBusy] = useState(false);

  const confirmSetup = async () => {
    try {
      setSetupBusy(true);
      await apiJson("/api/auth/setup-complete", { method: "POST" });
      setSetupModalOpen(false);
      router.replace("/");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed to save setup");
    } finally {
      setSetupBusy(false);
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    } catch {
      window.alert("Logout failed");
    }
  };

  useEffect(() => {
    if (!deleteAllModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleteAllBusy) setDeleteAllModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteAllModalOpen, deleteAllBusy]);

  const fetchLeadsPage = useCallback(async (page: number, search: string, sort: "new" | "old") => {
    const q = new URLSearchParams({ page: String(page), limit: String(LEADS_PAGE_SIZE), sort });
    if (search) q.set("search", search);
    return apiJson<LeadsApiResponse>(`/api/leads?${q}`);
  }, []);

  const loadLeads = useCallback(
    async (page: number, search: string, sort: "new" | "old") => {
      const res = await fetchLeadsPage(page, search, sort);
      setLeadsPage(res.page);
      setLeadsSearchQuery(search);
      setLeadsSort(sort);
      setLeads(res.items.map((x) => normalizeLead(x)));
      setLeadsTotal(res.total);
      setLeadsTotalPages(res.totalPages);
    },
    [fetchLeadsPage],
  );

  const refresh = useCallback(
    async (options?: { forceTemplateSync?: boolean; resetLeadsPage?: number }) => {
      const ignoreTplDirty = options?.forceTemplateSync === true;
      const page = options?.resetLeadsPage ?? leadsPage;

      // Brings older accounts up to the current baseline (default categories + templates)
      // before anything reads them.
      await apiJson<{ ok: boolean }>("/api/bootstrap");

      const [c, s, t, m, st, leadsRes] = await Promise.all([
        apiJson<{ items: CategoryRow[] }>("/api/categories"),
        apiJson<{ settings: SettingsRow | null }>("/api/settings"),
        apiJson<{ items: Record<string, unknown>[] }>("/api/templates"),
        apiJson<{ items: MergeFieldLite[] }>("/api/merge-fields"),
        apiJson<{
          stats: {
            leadsFound: number;
            noWebsite: number;
            emailsFound: number;
            socialMatches: number;
            messagesSent: number;
            leadsNeedingSocials: number;
          };
        }>("/api/stats"),
        fetchLeadsPage(page, leadsSearchQuery, leadsSort),
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
        dmBody: String(row.dmBody ?? ""),
        categoryTag: String(row.categoryTag ?? ""),
        categoryId: row.categoryId ? String(row.categoryId) : null,
        isDefault: Boolean(row.isDefault),
        useWhenNoCategoryMatch: Boolean(row.useWhenNoCategoryMatch),
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
        setTplDmBody(row.dmBody);
        setTplCategoryTag(row.categoryTag ?? "");
        setTplUseWhenNoCategoryMatch(Boolean(row.useWhenNoCategoryMatch));
      } else if (!tItems.length) {
        setSelectedTplId(null);
        setTplName("");
        setTplSubject("");
        setTplBody("");
        setTplDmBody("");
        setTplCategoryTag("");
        setTplUseWhenNoCategoryMatch(false);
      }
      setMergeFields(m.items);
      setStats(st.stats);

      setLeadsPage(leadsRes.page);
      setLeadsSearchQuery(leadsSearchQuery);
      setLeadsSort(leadsSort);
      setLeads(leadsRes.items.map((x) => normalizeLead(x)));
      setLeadsTotal(leadsRes.total);
      setLeadsTotalPages(leadsRes.totalPages);
    },
    [
      tplDirty,
      selectedTplId,
      leadsPage,
      leadsSearchQuery,
      leadsSort,
      fetchLeadsPage,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
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

  const selectedTemplateIsDefault = useMemo(() => {
    return templates.find((t) => t._id === selectedTplId)?.isDefault === true;
  }, [templates, selectedTplId]);

  useEffect(() => {
    if (tplDirty) return;
    const row = templates.find((t) => t._id === selectedTplId) ?? templates[0] ?? null;
    if (!row) return;
    setTplName(row.name);
    setTplSubject(row.subject);
    setTplBody(row.body);
    setTplDmBody(row.dmBody ?? "");
    setTplCategoryTag(row.categoryTag ?? "");
    setTplUseWhenNoCategoryMatch(Boolean(row.useWhenNoCategoryMatch));
  }, [selectedTplId, templates, tplDirty]);

  /** Previews the live editor drafts so edits show immediately, before saving. */
  const previewMerged = useMemo(() => {
    const map = buildMergeMap(
      mergeFields.map((f) => ({ key: f.key, value: f.value })),
      {
        businessname: "Sample Business LLC",
        category: selectedCategoryName || "General",
      },
    );
    return {
      subject: applyMergeTemplate(tplSubject, map),
      email: applyMergeTemplate(tplBody, map),
      dm: applyMergeTemplate(tplDmBody, map),
    };
  }, [tplSubject, tplBody, tplDmBody, mergeFields, selectedCategoryName]);

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

  const useMyLocation = async () => {
    if (!("geolocation" in navigator)) {
      setUseLocationError("Geolocation is not supported in this browser.");
      return;
    }
    setUseLocationError(null);
    setUseLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const r = await fetch(`/api/settings/reverse-geocode?lat=${lat}&lng=${lng}`);
          const j = (await r.json()) as { error?: string; locationText?: string };
          if (!r.ok || !j.locationText) {
            throw new Error(j.error || "Could not resolve your location");
          }
          setLocDraft(j.locationText);
        } catch (e) {
          setUseLocationError(e instanceof Error ? e.message : "Could not resolve your location");
        } finally {
          setUseLocationBusy(false);
        }
      },
      () => {
        setUseLocationError("Could not get your location. Check browser location permissions.");
        setUseLocationBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
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
          categoryId: mode === "category" ? categorySelectValue || undefined : undefined,
          nameQuery: nameQuery.trim() || undefined,
          locationAddress: locDraft.trim() || undefined,
          radiusMiles: radiusDraft,
          websiteFilter: filterDraft,
        }),
      });
      await refresh({ resetLeadsPage: 1 });
      showRunSuccess({
        textQuery: res.textQuery,
        rawCount: res.rawCount,
        matchedCount: res.matchedCount,
        savedCount: res.savedCount,
      });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunBusy(false);
    }
  };

  const canGetSocials = !loading && stats.leadsNeedingSocials > 0;

  const scrapeSocialsForEligibleLeads = () => {
    if (!canGetSocials) return;
    runSocialScrape("both");
  };

  /** POST one lead at a time so the progress popup can update live. */
  const runSocialScrape = (network: "facebook" | "instagram" | "both") => {
    void (async () => {
      try {
        setSocialsBusy(true);
        const eligible = leads.filter(pageLeadNeedsSocialEnrichment);
        const ids = eligible.map((l) => l._id);
        const total = ids.length;

        setSocialProgress({
          batchDone: 0,
          totalBatches: Math.max(1, total),
          checkedSoFar: 0,
          updatedSoFar: 0,
        });

        if (total === 0) {
          showSocialSuccess({
            processedLeads: 0,
            updatedLeads: 0,
            scrapeNote:
              "No leads on this page need Facebook or Instagram. Try another page, or add a name/location on the lead.",
          });
          return;
        }

        let updatedSoFar = 0;
        const leadById = new Map(eligible.map((l) => [l._id, l]));

        for (let i = 0; i < ids.length; i++) {
          const id = ids[i]!;
          const lead = leadById.get(id);
          const leadName = lead?.businessName?.trim() || "Lead";

          setSocialProgress({
            batchDone: i,
            totalBatches: total,
            checkedSoFar: i,
            updatedSoFar,
            currentLeadName: leadName,
          });

          const res = await apiJson<SocialSearchApiResponse>("/api/runs/social-search", {
            method: "POST",
            body: JSON.stringify({ network, leadIds: [id] }),
          });

          if (res.batch && Array.isArray(res.results)) {
            updatedSoFar += res.updatedCount ?? 0;
            console.log("[get-socials] lead", i + 1, "of", total, res.results);
          } else if (res.updated) {
            updatedSoFar += 1;
          }

          setSocialProgress({
            batchDone: i + 1,
            totalBatches: total,
            checkedSoFar: i + 1,
            updatedSoFar,
            currentLeadName: leadName,
          });
        }

        await refresh();
        showSocialSuccess({
          processedLeads: total,
          updatedLeads: updatedSoFar,
          scrapeNote: `Checked ${total} lead(s) on this page. Saved ${updatedSoFar} new social link(s).`,
        });
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Social search failed");
      } finally {
        setSocialProgress(null);
        setSocialsBusy(false);
      }
    })();
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
    const name = categories.find((c) => c._id === id)?.name ?? "this category";
    if (
      !window.confirm(
        `Delete "${name}"? Its auto-created email/DM template will be removed too. Templates you added yourself are kept.`,
      )
    ) {
      return;
    }
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
        body: JSON.stringify({
          name: tplName,
          subject: tplSubject,
          body: tplBody,
          dmBody: tplDmBody,
          categoryTag: tplCategoryTag.trim(),
          useWhenNoCategoryMatch: tplUseWhenNoCategoryMatch,
        }),
      });
      setTplDirty(false);
      await refresh({ forceTemplateSync: true });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const addTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) return;
    try {
      setNewTemplateBusy(true);
      // Server fills in default email + DM copy when they're omitted.
      await apiJson("/api/templates", { method: "POST", body: JSON.stringify({ name }) });
      setNewTemplateName("");
      setNewTemplateModalOpen(false);
      setTplDirty(false);
      await refresh({ forceTemplateSync: true });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setNewTemplateBusy(false);
    }
  };

  const deleteTemplate = async () => {
    if (!selectedTplId) return;
    try {
      setDeleteTemplateBusy(true);
      await apiJson(`/api/templates/${selectedTplId}`, { method: "DELETE" });
      setDeleteTemplateModalOpen(false);
      setTplDirty(false);
      await refresh({ forceTemplateSync: true });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setDeleteTemplateBusy(false);
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

  const onDeleteLead = async (leadId: string) => {
    const lead = leads.find((x) => x._id === leadId);
    setLeadDeleteTarget({ id: leadId, name: lead?.businessName || "this lead" });
  };

  const confirmDeleteLead = async () => {
    if (!leadDeleteTarget) return;
    try {
      setDeleteLeadBusy(true);
      await apiJson(`/api/leads/${leadDeleteTarget.id}`, { method: "DELETE" });
      setLeadDeleteTarget(null);
      await refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setDeleteLeadBusy(false);
    }
  };

  const exportLeads = async () => {
    try {
      setExportBusy(true);
      const res = await fetch("/api/leads/export");
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Export failed");
      }
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${stamp}.xls`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  };

  const confirmDeleteAllLeads = async () => {
    try {
      setDeleteAllBusy(true);
      await apiJson<{ ok: boolean; deletedCount: number }>("/api/leads", { method: "DELETE" });
      setDeleteAllModalOpen(false);
      await refresh({ resetLeadsPage: 1 });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed to delete leads");
    } finally {
      setDeleteAllBusy(false);
    }
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
    const looksLikeMongo =
      /MONGODB|mongo|Atlas|ECONNREFUSED|ENOTFOUND|whitelist|IP/i.test(bootError);
    const looksLikeDevGlitch = /HTML instead of JSON|hot-reload|not JSON|Dev server/i.test(bootError);
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-lux-bg px-6 text-center font-sans text-lux-crimson">
        <p>{bootError}</p>
        {looksLikeMongo ? (
          <p className="max-w-md text-sm text-lux-muted">
            Check MONGODB_URI and that MongoDB Atlas allows your IP.
          </p>
        ) : looksLikeDevGlitch ? (
          <p className="max-w-md text-sm text-lux-muted">
            This is usually a Next.js dev-server hiccup during long Social Bot runs — not MongoDB.
            Refresh first; if it persists, stop and restart `npm run dev`.
          </p>
        ) : (
          <p className="max-w-md text-sm text-lux-muted">
            Try refreshing. If it keeps failing after a Social Bot run, restart the dev server.
          </p>
        )}
        <button
          type="button"
          className="rounded-lg border border-lux-line bg-lux-panel px-4 py-2 text-sm text-lux-fg hover:border-lux-gold/50"
          onClick={() => {
            setBootError(null);
            setLoading(true);
            void refresh()
              .catch((e) => setBootError(e instanceof Error ? e.message : "Load failed"))
              .finally(() => setLoading(false));
          }}
        >
          Retry
        </button>
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

      {setupModalOpen ? (
        <div className="fixed inset-0 z-[120] flex items-end justify-center p-4 sm:items-center">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" aria-hidden />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="setup-title"
            aria-describedby="setup-desc"
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-lux-teal/35 bg-lux-panel/98 shadow-[0_28px_80px_-24px_rgba(0,0,0,0.75),0_0_0_1px_rgba(45,212,191,0.15)] ring-1 ring-lux-teal/20"
          >
            <div className="h-1 w-full bg-gradient-to-r from-lux-teal/40 via-lux-emerald/60 to-lux-teal/50" aria-hidden />
            <div className="px-6 pb-5 pt-5 sm:px-8 sm:pt-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-teal">Quick setup</p>
              <h2 id="setup-title" className="mt-2 font-serif text-xl font-semibold tracking-tight text-lux-fg">
                Configure your workspace
              </h2>
              <p id="setup-desc" className="mt-3 text-sm leading-relaxed text-lux-muted">
                Update your location and set your email templates so the bot can generate leads and messages for your area.
              </p>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  disabled={setupBusy}
                  onClick={() => void confirmSetup()}
                  className="rounded-sm border border-lux-teal/35 bg-lux-teal/20 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-teal transition hover:border-lux-teal/55 hover:bg-lux-teal/30 disabled:opacity-50"
                >
                  {setupBusy ? "Saving…" : "OK"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteAllModalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            disabled={deleteAllBusy}
            className="absolute inset-0 bg-black/60 backdrop-blur-[3px] transition-opacity disabled:opacity-90"
            aria-label="Close dialog"
            onClick={() => {
              if (!deleteAllBusy) setDeleteAllModalOpen(false);
            }}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-all-title"
            aria-describedby="delete-all-desc"
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-lux-crimson/35 bg-lux-panel/98 shadow-[0_28px_80px_-24px_rgba(0,0,0,0.75),0_0_0_1px_rgba(159,27,61,0.15)] ring-1 ring-lux-crimson/20"
          >
            <div
              className="h-1 w-full bg-gradient-to-r from-lux-crimson/40 via-lux-crimson to-lux-crimson/45"
              aria-hidden
            />
            <div className="px-6 pb-5 pt-5 sm:px-8 sm:pt-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-crimson">Danger zone</p>
              <h2 id="delete-all-title" className="mt-2 font-serif text-xl font-semibold tracking-tight text-lux-fg">
                Delete all leads?
              </h2>
              <p id="delete-all-desc" className="mt-3 text-sm leading-relaxed text-lux-muted">
                This removes every lead from your database. Contact status and other data saved on each lead will be
                lost. Your templates and merge fields are not deleted. This cannot be undone.
              </p>
              <p className="mt-4 rounded-sm border border-lux-line-soft bg-lux-canvas/80 px-3 py-2.5 text-center font-mono text-sm tabular-nums text-lux-gold-bright">
                {stats.leadsFound} lead{stats.leadsFound === 1 ? "" : "s"} will be removed
              </p>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                <button
                  type="button"
                  disabled={deleteAllBusy}
                  onClick={() => setDeleteAllModalOpen(false)}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-muted transition hover:border-lux-gold/35 hover:text-lux-fg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteAllBusy}
                  onClick={() => void confirmDeleteAllLeads()}
                  className="rounded-sm border border-lux-crimson/55 bg-lux-crimson px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-white shadow-[0_8px_28px_-8px_rgba(159,27,61,0.55)] transition hover:bg-lux-crimson/90 disabled:opacity-50"
                >
                  {deleteAllBusy ? "Deleting…" : "Delete all"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTemplateModalOpen ? (
        <div className="fixed inset-0 z-[105] flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            disabled={deleteTemplateBusy}
            className="absolute inset-0 bg-black/60 backdrop-blur-[3px]"
            aria-label="Close dialog"
            onClick={() => {
              if (!deleteTemplateBusy) setDeleteTemplateModalOpen(false);
            }}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-template-title"
            aria-describedby="delete-template-desc"
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-lux-crimson/35 bg-lux-panel/98 shadow-[0_28px_80px_-24px_rgba(0,0,0,0.75),0_0_0_1px_rgba(159,27,61,0.15)] ring-1 ring-lux-crimson/20"
          >
            <div className="h-1 w-full bg-gradient-to-r from-lux-crimson/40 via-lux-crimson to-lux-crimson/45" aria-hidden />
            <div className="px-6 pb-5 pt-5 sm:px-8 sm:pt-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-crimson">Danger zone</p>
              <h2 id="delete-template-title" className="mt-2 font-serif text-xl font-semibold tracking-tight text-lux-fg">
                Delete template?
              </h2>
              <p id="delete-template-desc" className="mt-3 text-sm leading-relaxed text-lux-muted">
                This will delete <span className="font-medium text-lux-fg">{tplName || "the selected template"}</span>.
                Leads using it will be reassigned to another template.
              </p>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                <button
                  type="button"
                  disabled={deleteTemplateBusy}
                  onClick={() => setDeleteTemplateModalOpen(false)}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-muted transition hover:border-lux-gold/35 hover:text-lux-fg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteTemplateBusy}
                  onClick={() => void deleteTemplate()}
                  className="rounded-sm border border-lux-crimson/55 bg-lux-crimson px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-white shadow-[0_8px_28px_-8px_rgba(159,27,61,0.55)] transition hover:bg-lux-crimson/90 disabled:opacity-50"
                >
                  {deleteTemplateBusy ? "Deleting…" : "Delete template"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {leadDeleteTarget ? (
        <div className="fixed inset-0 z-[106] flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            disabled={deleteLeadBusy}
            className="absolute inset-0 bg-black/60 backdrop-blur-[3px]"
            aria-label="Close dialog"
            onClick={() => {
              if (!deleteLeadBusy) setLeadDeleteTarget(null);
            }}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-lead-title"
            aria-describedby="delete-lead-desc"
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-lux-crimson/35 bg-lux-panel/98 shadow-[0_28px_80px_-24px_rgba(0,0,0,0.75),0_0_0_1px_rgba(159,27,61,0.15)] ring-1 ring-lux-crimson/20"
          >
            <div className="h-1 w-full bg-gradient-to-r from-lux-crimson/40 via-lux-crimson to-lux-crimson/45" aria-hidden />
            <div className="px-6 pb-5 pt-5 sm:px-8 sm:pt-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-crimson">Danger zone</p>
              <h2 id="delete-lead-title" className="mt-2 font-serif text-xl font-semibold tracking-tight text-lux-fg">
                Delete lead?
              </h2>
              <p id="delete-lead-desc" className="mt-3 text-sm leading-relaxed text-lux-muted">
                Remove <span className="font-medium text-lux-fg">{leadDeleteTarget.name}</span> from your leads list.
                This cannot be undone.
              </p>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                <button
                  type="button"
                  disabled={deleteLeadBusy}
                  onClick={() => setLeadDeleteTarget(null)}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-muted transition hover:border-lux-gold/35 hover:text-lux-fg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteLeadBusy}
                  onClick={() => void confirmDeleteLead()}
                  className="rounded-sm border border-lux-crimson/55 bg-lux-crimson px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-white shadow-[0_8px_28px_-8px_rgba(159,27,61,0.55)] transition hover:bg-lux-crimson/90 disabled:opacity-50"
                >
                  {deleteLeadBusy ? "Deleting…" : "Delete lead"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {newTemplateModalOpen ? (
        <div className="fixed inset-0 z-[110] flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            disabled={newTemplateBusy}
            className="absolute inset-0 bg-black/60 backdrop-blur-[3px]"
            aria-label="Close dialog"
            onClick={() => {
              if (!newTemplateBusy) {
                setNewTemplateModalOpen(false);
                setNewTemplateName("");
              }
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-template-title"
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-lux-line bg-lux-panel/98 shadow-[0_28px_80px_-24px_rgba(0,0,0,0.75),0_0_0_1px_rgba(201,162,39,0.12)] ring-1 ring-[color:var(--color-lux-gold-line)]/20"
          >
            <div className="h-1 w-full bg-gradient-to-r from-lux-gold/30 via-lux-gold to-lux-gold/40" aria-hidden />
            <div className="px-6 pb-5 pt-5 sm:px-8 sm:pt-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-gold-bright">Templates</p>
              <h2 id="new-template-title" className="mt-2 font-serif text-xl font-semibold tracking-tight text-lux-fg">
                Create new template
              </h2>
              <label className="mt-4 block space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-lux-gold-muted">
                  Template name
                </span>
                <input
                  autoFocus
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addTemplate();
                    }
                  }}
                  placeholder="e.g. Florist Follow-up"
                  className="w-full rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-sm outline-none focus:border-lux-gold"
                />
              </label>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                <button
                  type="button"
                  disabled={newTemplateBusy}
                  onClick={() => {
                    setNewTemplateModalOpen(false);
                    setNewTemplateName("");
                  }}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-muted transition hover:border-lux-gold/35 hover:text-lux-fg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={newTemplateBusy || !newTemplateName.trim()}
                  onClick={() => void addTemplate()}
                  className="rounded-sm bg-lux-primary px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-primary-fg transition hover:bg-lux-primary-hover disabled:opacity-50"
                >
                  {newTemplateBusy ? "Creating…" : "Create template"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {runSuccess ? (
        <div
          className="fixed bottom-6 left-1/2 z-50 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 sm:left-auto sm:right-8 sm:translate-x-0"
          role="status"
          aria-live="polite"
        >
          <div className="overflow-hidden rounded-2xl border border-[color:var(--color-lux-emerald-ring)]/45 bg-lux-panel/95 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.65),0_0_0_1px_rgba(45,212,191,0.12)] ring-1 ring-[color:var(--color-lux-emerald-ring)]/25 backdrop-blur-md">
            <div
              className="h-1 w-full bg-gradient-to-r from-lux-teal/20 via-[color:var(--color-lux-emerald-ring)] to-lux-teal/30"
              aria-hidden
            />
            <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-4">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-teal">Places run</p>
                <h2 className="mt-1 font-serif text-lg font-semibold tracking-tight text-lux-fg">Run complete</h2>
                <p className="mt-2 line-clamp-2 font-mono text-[11px] leading-snug text-lux-muted" title={runSuccess.textQuery}>
                  {runSuccess.textQuery}
                </p>
              </div>
              <button
                type="button"
                onClick={dismissRunSuccess}
                className="shrink-0 rounded-sm border border-lux-line bg-lux-canvas/80 px-2 py-1 text-xs font-medium text-lux-muted transition hover:border-lux-teal/40 hover:text-lux-fg"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            <dl className="grid grid-cols-3 gap-px border-t border-lux-line-soft bg-lux-line-soft px-2 pb-4 pt-1 text-center">
              <div className="rounded-sm bg-lux-canvas/90 py-3">
                <dt className="text-[9px] font-semibold uppercase tracking-wider text-lux-gold-muted">Returned</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums text-lux-fg">{runSuccess.rawCount}</dd>
              </div>
              <div className="rounded-sm bg-lux-canvas/90 py-3">
                <dt className="text-[9px] font-semibold uppercase tracking-wider text-lux-gold-muted">Matched</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums text-lux-fg">{runSuccess.matchedCount}</dd>
              </div>
              <div className="rounded-sm bg-lux-canvas/90 py-3">
                <dt className="text-[9px] font-semibold uppercase tracking-wider text-lux-gold-muted">Saved</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums text-lux-link">{runSuccess.savedCount}</dd>
              </div>
            </dl>
            <p className="border-t border-lux-line-soft px-5 py-2.5 text-center text-[10px] text-lux-muted">
              Dismisses automatically in 10 seconds.
            </p>
          </div>
        </div>
      ) : null}

      {socialProgress && socialsBusy ? (
        <div
          className={`fixed left-1/2 z-50 w-[min(26rem,calc(100%-2rem))] -translate-x-1/2 sm:left-auto sm:right-8 sm:translate-x-0 ${
            runSuccess ? "bottom-28 sm:bottom-28" : "bottom-6 sm:bottom-6"
          }`}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="overflow-hidden rounded-2xl border border-lux-teal/45 bg-lux-panel/98 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.65)] ring-1 ring-lux-teal/30 backdrop-blur-md">
            <div
              className="h-1 w-full animate-pulse bg-gradient-to-r from-lux-teal/40 via-lux-teal/70 to-lux-teal/40"
              aria-hidden
            />
            <div className="px-5 pb-4 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-teal">Social links</p>
              <h2 className="mt-1 font-serif text-lg font-semibold tracking-tight text-lux-fg">Fetching socials…</h2>
              <p className="mt-2 text-sm text-lux-muted">
                {socialProgress.totalBatches <= 1
                  ? socialProgress.currentLeadName
                    ? `Checking ${socialProgress.currentLeadName} (often 1–3 minutes per lead).`
                    : "Running Facebook and Instagram searches for one lead (often 1–3 minutes)."
                  : socialProgress.checkedSoFar < socialProgress.totalBatches
                    ? `Checking lead ${Math.min(socialProgress.checkedSoFar + 1, socialProgress.totalBatches)} of ${socialProgress.totalBatches}${
                        socialProgress.currentLeadName ? `: ${socialProgress.currentLeadName}` : ""
                      }`
                    : `Finished ${socialProgress.totalBatches} lead(s).`}
              </p>
              <p className="mt-2 font-mono text-[11px] text-lux-fg-dim">
                Leads checked: {socialProgress.checkedSoFar} · New links saved: {socialProgress.updatedSoFar}
              </p>
              <p className="mt-3 text-[10px] leading-relaxed text-lux-muted">
                Safe to leave this tab open. A summary appears when this run completes.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {socialSuccess ? (
        <div
          className={`fixed left-1/2 z-50 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 sm:left-auto sm:right-8 sm:translate-x-0 ${
            runSuccess ? "bottom-28 sm:bottom-28" : "bottom-6 sm:bottom-6"
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="overflow-hidden rounded-2xl border border-lux-teal/35 bg-lux-panel/95 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.65)] ring-1 ring-lux-teal/20 backdrop-blur-md">
            <div className="h-1 w-full bg-gradient-to-r from-lux-teal/30 via-lux-teal/50 to-lux-teal/20" aria-hidden />
            <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-teal">Social links</p>
                <h2 className="mt-1 font-serif text-lg font-semibold tracking-tight text-lux-fg">
                  {socialSuccess.skipReason === "none_need_socials"
                    ? "Nothing to update"
                    : socialSuccess.skipReason === "no_search_query"
                      ? "Can't search yet"
                      : socialSuccess.updatedLeads > 0
                        ? "Social links added to leads"
                        : "Social search complete"}
                </h2>
                {socialSuccess.skipReason === "none_need_socials" || socialSuccess.skipReason === "no_search_query" ? null : (
                  <p className="mt-1 text-sm text-lux-muted">
                    {socialSuccess.updatedLeads > 0
                      ? `Saved for ${socialSuccess.updatedLeads} lead${socialSuccess.updatedLeads === 1 ? "" : "s"}.`
                      : socialSuccess.processedLeads > 0
                        ? `Checked ${socialSuccess.processedLeads} lead${socialSuccess.processedLeads === 1 ? "" : "s"}; no new links matched.`
                        : null}
                  </p>
                )}
                {socialSuccess.scrapeNote ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-lux-gold-bright">{socialSuccess.scrapeNote}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={dismissSocialSuccess}
                className="shrink-0 rounded-sm border border-lux-line bg-lux-canvas/80 px-2 py-1 text-xs font-medium text-lux-muted transition hover:border-lux-teal/40 hover:text-lux-fg"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            <p className="border-t border-lux-line-soft px-5 py-2.5 text-center text-[10px] text-lux-muted">
              One eligible lead per run (newest first). Click again for the next. Dismisses in 10 seconds.
            </p>
          </div>
        </div>
      ) : null}

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
            <div className="flex w-full max-w-3xl flex-col items-stretch gap-2 sm:w-auto sm:items-end">
              <div className="flex items-center justify-between gap-3 rounded-sm border border-lux-line bg-lux-panel/80 px-3 py-1.5 text-[11px] text-lux-muted sm:justify-end">
                <span>
                  Logged in as <span className="font-mono text-lux-gold-bright">{currentUsername ?? "user"}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-lux-muted transition hover:border-lux-crimson/35 hover:text-lux-crimson"
                >
                  Log out
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:justify-end">
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
                  disabled={runBusy || socialsBusy}
                  onClick={() => void runPlaces("category")}
                  className="rounded-sm border border-[color:var(--color-lux-gold-line)] bg-lux-panel px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-lux-gold-bright shadow-[0_0_0_1px_rgba(201,162,39,0.12),0_12px_36px_-10px_rgba(0,0,0,0.5)] transition hover:bg-lux-gold-soft/30 hover:text-lux-fg disabled:opacity-40"
                >
                  Run Bot
                </button>
                <button
                  type="button"
                  disabled={runBusy || socialsBusy || !canGetSocials}
                  onClick={() => scrapeSocialsForEligibleLeads()}
                  className="rounded-sm border border-lux-teal/40 bg-lux-teal/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-lux-link shadow-[0_8px_28px_-12px_rgba(0,0,0,0.45)] transition hover:border-lux-teal/60 hover:bg-lux-teal/15 disabled:opacity-40"
                  title={
                    stats.leadsNeedingSocials === 0
                      ? "All leads already have both social links, or none have a name or location to search"
                      : loading
                        ? "Loading workspace…"
                        : `Enrich leads on the current Leads table page (up to ${LEADS_PAGE_SIZE}). Uses cache when a Google place was resolved before; searches DuckDuckGo/Brave/Bing only for missing links. Go to the next page and click again for more rows.`
                  }
                >
                  {socialsBusy ? "Working…" : "Get socials"}
                </button>
              </div>
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
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-teal">
                      Location (geocoded)
                    </span>
                    <button
                      type="button"
                      onClick={() => void useMyLocation()}
                      disabled={useLocationBusy}
                      className="rounded-sm border border-lux-line bg-lux-canvas px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-lux-muted transition hover:border-lux-teal/40 hover:text-lux-link disabled:opacity-40"
                    >
                      {useLocationBusy ? "Locating…" : "Use my location"}
                    </button>
                  </span>
                  <input
                    value={locDraft}
                    onChange={(e) => setLocDraft(e.target.value)}
                    placeholder="ZIP preferred (city/state or full address also works)"
                    className="w-full rounded-sm border border-lux-line bg-lux-field px-3 py-3 font-mono text-xs text-lux-fg-dim outline-none transition focus:border-lux-gold focus:ring-1 focus:ring-lux-gold-soft"
                  />
                  <p className="text-[10px] text-lux-subtle">
                    Recommended: use ZIP code for best local targeting. City/address is also accepted.
                  </p>
                  {useLocationError ? <p className="text-[10px] text-lux-crimson">{useLocationError}</p> : null}
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
                  disabled={runBusy || socialsBusy}
                  onClick={() => void runPlaces("category")}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-fg-dim transition hover:border-lux-gold/40 hover:text-lux-gold-bright disabled:opacity-40"
                >
                  Category search run
                </button>
                <button
                  type="button"
                  disabled={runBusy || socialsBusy}
                  onClick={() => void runPlaces("name")}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-lux-fg-dim transition hover:border-lux-teal/40 hover:text-lux-link disabled:opacity-40"
                >
                  Direct name run
                </button>
              </div>
            </section>

            <section className="rounded-sm border border-lux-line bg-lux-panel/95 p-8 shadow-[0_1px_0_var(--color-lux-rim)_inset] sm:p-10">
              <h2 className="font-serif text-xl font-semibold text-lux-fg">Categories</h2>
              <p className="mt-1 text-xs text-lux-muted">
                Adding a category creates a matching email/DM template you can edit; removing it deletes that
                template. Categories marked <span className="text-lux-gold-bright">default</span> are always
                available and can&apos;t be removed, though you can rename them and edit their templates freely.
              </p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {categories.map((c) => (
                  <li
                    key={c._id}
                    className={`flex items-center gap-2 rounded-sm border px-3 py-2 text-xs ${
                      c.isDefault
                        ? "border-[color:var(--color-lux-gold-line)] bg-lux-gold-soft"
                        : "border-lux-line bg-lux-field"
                    }`}
                  >
                    <span>{c.name}</span>
                    {c.isDefault ? (
                      <span
                        className="text-[9px] font-semibold uppercase tracking-wider text-lux-gold-muted"
                        title="Built-in category — always available. Its templates are fully editable."
                      >
                        default
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void deleteCategory(c._id)}
                        className="text-lux-crimson hover:underline"
                      >
                        remove
                      </button>
                    )}
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
                <p className="text-xs text-lux-muted">
                  {LEADS_PAGE_SIZE} per page · newest first · leads come from your Places bot runs ·{" "}
                  <span className="text-lux-fg-dim">
                    Get socials fills FB/IG for every row on <strong>this page</strong> that still needs them (cache
                    first), then run again after Next page.
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void exportLeads()}
                  disabled={stats.leadsFound === 0 || exportBusy}
                  className="rounded-sm border border-lux-teal/40 bg-lux-teal/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-lux-link transition hover:border-lux-teal/60 hover:bg-lux-teal/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {exportBusy ? "Exporting…" : "Export Excel"}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteAllModalOpen(true)}
                  disabled={stats.leadsFound === 0}
                  className="rounded-sm border border-lux-crimson/45 bg-lux-crimson-soft/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-lux-crimson transition hover:bg-lux-crimson-soft disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delete all leads
                </button>
              </div>
            </div>
            <div className="mt-6 flex flex-col gap-4 rounded-sm border border-lux-line bg-lux-panel/90 p-4 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="block min-w-[200px] flex-1 space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-lux-gold-muted">
                  Search by business name
                </span>
                <input
                  value={leadsSearchDraft}
                  onChange={(e) => setLeadsSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void loadLeads(1, leadsSearchDraft.trim(), leadsSort);
                    }
                  }}
                  placeholder="Type and press Enter or Search"
                  className="w-full rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-sm outline-none focus:border-lux-gold"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-lux-teal">Sort by date</span>
                <select
                  value={leadsSort}
                  onChange={(e) => {
                    const v = e.target.value === "old" ? "old" : "new";
                    void loadLeads(1, leadsSearchQuery, v);
                  }}
                  className="w-full min-w-[180px] cursor-pointer rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-xs outline-none sm:w-auto"
                >
                  <option value="new">New → old</option>
                  <option value="old">Old → new</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => void loadLeads(1, leadsSearchDraft.trim(), leadsSort)}
                className="rounded-sm bg-lux-primary px-5 py-2 text-xs font-semibold text-lux-primary-fg"
              >
                Search
              </button>
            </div>
            <p className="mt-3 text-[10px] uppercase tracking-wider text-lux-subtle">
              {leadsTotal === 0
                ? "No leads match this filter."
                : `Showing ${(leadsPage - 1) * LEADS_PAGE_SIZE + 1}–${Math.min(leadsPage * LEADS_PAGE_SIZE, leadsTotal)} of ${leadsTotal} · page ${leadsPage} / ${leadsTotalPages}`}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={leadsPage <= 1}
                onClick={() => void loadLeads(leadsPage - 1, leadsSearchQuery, leadsSort)}
                className="rounded-sm border border-lux-line bg-lux-canvas px-4 py-2 text-xs font-semibold text-lux-fg-dim disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={leadsPage >= leadsTotalPages}
                onClick={() => void loadLeads(leadsPage + 1, leadsSearchQuery, leadsSort)}
                className="rounded-sm border border-lux-line bg-lux-canvas px-4 py-2 text-xs font-semibold text-lux-fg-dim disabled:opacity-40"
              >
                Next
              </button>
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
                  onDelete={onDeleteLead}
                />
              ))}
              {!leads.length && (
                <p className="col-span-full text-sm text-lux-muted">No leads match this page or filter.</p>
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
                  onClick={() => setNewTemplateModalOpen(true)}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-lux-muted hover:border-lux-gold/40"
                >
                  New template
                </button>
                <button
                  type="button"
                  disabled={selectedTemplateIsDefault}
                  onClick={() => setDeleteTemplateModalOpen(true)}
                  title={
                    selectedTemplateIsDefault
                      ? "Default templates can't be deleted, but you can edit their content."
                      : undefined
                  }
                  className="rounded-sm border border-lux-crimson/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-lux-crimson transition hover:bg-lux-crimson-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
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
                      }}
                      className={`flex w-full flex-col rounded-sm border px-4 py-3.5 text-left transition ${
                        selectedTplId === tpl._id
                          ? "border-lux-gold bg-lux-raised shadow-md ring-1 ring-[color:var(--color-lux-gold-line)]"
                          : "border-lux-line bg-lux-panel/80 hover:border-lux-gold/35"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-lux-fg">{tpl.name}</span>
                        {tpl.isDefault ? (
                          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-lux-gold-muted">
                            default
                          </span>
                        ) : null}
                      </span>
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
                  Optional category tag (alias). Runs match template by{" "}
                  <span className="text-lux-fg-dim">template name = category name</span> first. Use tag only if the
                  name cannot match. Name or tag{" "}
                  <span className="font-mono text-lux-fg-dim">general</span> for the default when nothing matches.
                  <input
                    value={tplCategoryTag}
                    onChange={(e) => {
                      setTplDirty(true);
                      setTplCategoryTag(e.target.value);
                    }}
                    placeholder="optional alias, or general"
                    className="mt-1 w-full rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-sm text-lux-fg outline-none focus:border-lux-gold"
                  />
                </label>
                <label className="mt-3 flex cursor-pointer items-start gap-3 text-xs text-lux-muted">
                  <input
                    type="checkbox"
                    checked={tplUseWhenNoCategoryMatch}
                    onChange={(e) => {
                      setTplDirty(true);
                      setTplUseWhenNoCategoryMatch(e.target.checked);
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    Use this template when a Places category does not match any other template (your general / catch-all
                    email). Only one template can have this on at a time.
                  </span>
                </label>
                <section className="mt-8 rounded-sm border border-[color:var(--color-lux-gold-line)]/45 bg-lux-canvas/60 p-5">
                  <h3 className="font-serif text-base font-semibold text-lux-gold-bright">Email template</h3>
                  <p className="mt-0.5 text-[10px] text-lux-subtle">
                    Sent to leads that have an email address. Supports a subject line.
                  </p>
                  <label className="mt-4 block text-xs text-lux-muted">
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
                    Email body (use {"{{myName}}"}, {"{{businessName}}"}, etc.)
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
                </section>

                <section className="mt-6 rounded-sm border border-lux-teal/35 bg-lux-canvas/60 p-5">
                  <h3 className="font-serif text-base font-semibold text-lux-link">DM template</h3>
                  <p className="mt-0.5 text-[10px] text-lux-subtle">
                    Sent to leads that only have Instagram or Facebook. No subject line — keep it short.
                  </p>
                  <label className="mt-4 block text-xs text-lux-muted">
                    DM body
                    <textarea
                      value={tplDmBody}
                      onChange={(e) => {
                        setTplDirty(true);
                        setTplDmBody(e.target.value);
                      }}
                      rows={5}
                      className="mt-1 w-full rounded-sm border border-lux-line bg-lux-field px-3 py-2 font-mono text-xs text-lux-fg-dim outline-none focus:border-lux-teal"
                    />
                  </label>
                </section>

                <button
                  type="button"
                  onClick={() => void saveTemplate()}
                  className="mt-6 rounded-sm bg-lux-primary px-5 py-2 text-xs font-semibold text-lux-primary-fg"
                >
                  Save template
                </button>
              </div>
              <div className="rounded-sm border border-lux-line bg-lux-canvas p-8 shadow-[0_14px_40px_-16px_rgba(0,0,0,0.4)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-teal">Preview</p>
                <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-lux-gold-muted">Email</p>
                <div className="mt-2 max-h-[340px] overflow-auto rounded-sm border border-lux-line bg-lux-field p-4 shadow-[inset_0_2px_14px_rgba(0,0,0,0.5)]">
                  {previewMerged.subject ? (
                    <p className="mb-3 border-b border-lux-line-soft pb-2 font-mono text-[11px] text-lux-gold-bright">
                      Subject: {previewMerged.subject}
                    </p>
                  ) : null}
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-lux-muted">
                    {previewMerged.email}
                  </pre>
                </div>
                <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-lux-gold-muted">DM</p>
                <div className="mt-2 max-h-[200px] overflow-auto rounded-sm border border-lux-line bg-lux-field p-4 shadow-[inset_0_2px_14px_rgba(0,0,0,0.5)]">
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-lux-muted">
                    {previewMerged.dm}
                  </pre>
                </div>
              </div>
              <div className="rounded-sm border border-lux-line bg-lux-panel/90 p-8 shadow-[0_1px_0_var(--color-lux-rim)_inset]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lux-crimson">Merge fields</p>
                <p className="mt-1 text-[10px] uppercase tracking-widest text-lux-subtle">
                  Keys are lowercased. Use in templates as {"{{key}}"}. Business fields: {"{{businessName}}"}{" "}
                  {"{{category}}"}. Owner fields include {"{{email}}"}, {"{{phone}}"}, {"{{portfoliolink}}"},{" "}
                  {"{{linkedinlink}}"}, {"{{myname}}"}. Put project URLs directly in the template body if you like.
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
