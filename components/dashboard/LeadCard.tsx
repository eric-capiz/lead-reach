"use client";

import { useCallback, useMemo, useState } from "react";
import { applyMergeTemplate, buildMergeMap } from "@/lib/merge";
import type { LeadStatus } from "@/lib/constants";
import type { LeadApi, MergeFieldLite, TemplateLite } from "@/lib/types/dashboard";

function statusLabel(s: LeadStatus) {
  if (s === "sent") return "Contacted";
  if (s === "social_ready") return "Social ready";
  return "Pending";
}

export function LeadCard({
  row,
  templates,
  mergeFields,
  onTemplateChange,
  onStatusChange,
  onDelete,
}: {
  row: LeadApi;
  templates: TemplateLite[];
  mergeFields: MergeFieldLite[];
  onTemplateChange: (id: string, templateId: string) => Promise<void>;
  onStatusChange: (id: string, status: LeadStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const tpl = useMemo(
    () => templates.find((t) => t._id === row.templateId) ?? templates[0],
    [templates, row.templateId],
  );

  const mergedBody = useMemo(() => {
    if (!tpl) return "";
    const map = buildMergeMap(
      mergeFields.map((m) => ({ key: m.key, value: m.value })),
      {
        businessname: row.businessName,
        category: row.category,
      },
    );
    return applyMergeTemplate(tpl.body, map);
  }, [tpl, mergeFields, row.businessName, row.category]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mergedBody);
    } catch {
      window.alert("Could not copy to clipboard");
    }
  }, [mergedBody]);

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
        <div className="flex flex-wrap items-start justify-end gap-2">
          {row.isSample ? (
            <span className="shrink-0 rounded-sm border border-lux-teal/40 bg-lux-teal/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-lux-link">
              Sample
            </span>
          ) : null}
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
          {row.email ? (
            <a href={`mailto:${row.email}`} className="font-mono text-[11px] text-lux-link hover:text-lux-link-hover">
              {row.email}
            </a>
          ) : (
            <span className="font-mono text-[11px] text-lux-fg-dim">—</span>
          )}
        </div>
        <div className="col-span-2 flex flex-wrap gap-3 text-[11px]">
          <a
            href={row.googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-lux-link transition hover:text-lux-link-hover"
          >
            Maps ↗
          </a>
          <span className="text-lux-subtle">
            IG:{" "}
            {row.instagram?.startsWith("http") ? (
              <a
                href={row.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-lux-link transition hover:text-lux-link-hover"
              >
                open
              </a>
            ) : row.instagram ? (
              <span className="font-medium text-lux-gold-bright">{row.instagram}</span>
            ) : (
              "—"
            )}
          </span>
          <span className="text-lux-subtle">
            FB:{" "}
            {row.facebook?.startsWith("http") ? (
              <a
                href={row.facebook}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-lux-link transition hover:text-lux-link-hover"
              >
                open
              </a>
            ) : row.facebook ? (
              <span className="font-medium text-lux-gold-bright">{row.facebook}</span>
            ) : (
              "—"
            )}
          </span>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-lux-line-soft pt-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onStatusChange(row._id, "social_ready").finally(() => setBusy(false));
          }}
          className="rounded-sm border border-lux-line bg-lux-canvas px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-lux-muted hover:border-lux-rose/40 hover:text-lux-social"
        >
          Mark social ready
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("Delete this lead?")) return;
            setBusy(true);
            void onDelete(row._id).finally(() => setBusy(false));
          }}
          className="rounded-sm border border-lux-crimson/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-lux-crimson hover:bg-lux-crimson-soft"
        >
          Delete
        </button>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-lux-line-soft pt-4 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          value={row.templateId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            setBusy(true);
            void onTemplateChange(row._id, v).finally(() => setBusy(false));
          }}
          disabled={busy || !templates.length}
          className="min-w-0 flex-1 cursor-pointer rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-xs text-lux-fg-dim outline-none transition focus:border-lux-gold focus:ring-1 focus:ring-lux-gold-soft"
        >
          {templates.map((t) => (
            <option key={t._id} value={t._id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => void copy()}
          className="rounded-sm border border-lux-line bg-lux-canvas px-4 py-2 text-xs font-semibold tracking-wide text-lux-fg-dim transition hover:border-lux-teal/40 hover:text-lux-link"
        >
          Copy message
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onStatusChange(row._id, "sent").finally(() => setBusy(false));
          }}
          className="rounded-sm bg-lux-primary px-4 py-2 text-xs font-semibold tracking-wide text-lux-primary-fg shadow-[0_6px_24px_-6px_rgba(201,162,39,0.45)] transition hover:bg-lux-primary-hover"
        >
          Mark sent
        </button>
      </div>
    </article>
  );
}
