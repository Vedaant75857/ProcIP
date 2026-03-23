import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Columns3, Loader2, SkipForward } from "lucide-react";
import { motion } from "motion/react";
import { PrimaryButton, SecondaryButton, SurfaceCard } from "./ui";

interface HeaderNormalisationProps {
  sessionId: string;
  apiKey: string;
  loading: boolean;
  decisions: any[] | null;
  standardFields: any[];
  onRun: () => void;
  onApply: (decisions: Record<string, any[]>) => void;
  onSkip: () => void;
}

type Action = "AUTO" | "REVIEW" | "DROP" | "KEEP";

interface ColDecision {
  source_col: string;
  suggested_std_field: string | null;
  confidence: number;
  reason: string;
  action: Action;
  top_alternatives: string[];
  mapped_to?: string | null;
}

function normalizeAction(action: unknown): Action {
  const a = String(action || "REVIEW").toUpperCase();
  if (a === "AUTO" || a === "REVIEW" || a === "DROP" || a === "KEEP") return a;
  return "REVIEW";
}

export default function HeaderNormalisation({
  apiKey,
  loading,
  decisions,
  standardFields,
  onRun,
  onApply,
  onSkip,
}: HeaderNormalisationProps) {
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [edited, setEdited] = useState<Record<string, ColDecision[]>>({});
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const next: Record<string, ColDecision[]> = {};
    for (const tbl of decisions || []) {
      next[tbl.tableKey] = (tbl.decisions || []).map((d: any) => ({
        source_col: String(d.source_col || ""),
        suggested_std_field: d.suggested_std_field || null,
        confidence: Number(d.confidence || 0),
        reason: String(d.reason || ""),
        action: normalizeAction(d.action),
        top_alternatives: Array.isArray(d.top_alternatives) ? d.top_alternatives.map((x: any) => String(x)) : [],
        mapped_to: d.action === "DROP" || d.action === "KEEP" ? null : (d.suggested_std_field || null),
      }));
    }
    setEdited(next);
    if (!selectedTable) {
      const first = Object.keys(next)[0];
      if (first) setSelectedTable(first);
    } else if (selectedTable && !next[selectedTable]) {
      const first = Object.keys(next)[0];
      if (first) setSelectedTable(first);
    }
  }, [decisions, selectedTable]);

  const tableKeys = useMemo(() => Object.keys(edited), [edited]);
  const rows = useMemo(() => {
    const r = edited[selectedTable] || [];
    const q = filter.trim().toLowerCase();
    if (!q) return r;
    return r.filter((d) =>
      d.source_col.toLowerCase().includes(q) ||
      (d.mapped_to || "").toLowerCase().includes(q) ||
      (d.suggested_std_field || "").toLowerCase().includes(q)
    );
  }, [edited, selectedTable, filter]);

  const stdFieldNames = useMemo(
    () => (standardFields || []).map((f: any) => String(f?.name || "")).filter(Boolean),
    [standardFields]
  );

  const updateRow = (sourceCol: string, patch: Partial<ColDecision>) => {
    setEdited((prev) => {
      const arr = [...(prev[selectedTable] || [])];
      const idx = arr.findIndex((x) => x.source_col === sourceCol);
      if (idx < 0) return prev;
      arr[idx] = { ...arr[idx], ...patch };
      return { ...prev, [selectedTable]: arr };
    });
  };

  const applyChanges = () => {
    const payload: Record<string, any[]> = {};
    for (const [tableKey, arr] of Object.entries(edited)) {
      payload[tableKey] = arr.map((d) => ({
        ...d,
        action: normalizeAction(d.action),
        suggested_std_field:
          d.action === "DROP" || d.action === "KEEP"
            ? null
            : (d.mapped_to || d.suggested_std_field || null),
      }));
    }
    onApply(payload);
  };

  if (!apiKey?.trim()) {
    return (
      <SurfaceCard className="p-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Enter an API key to run AI header normalization.
        </p>
      </SurfaceCard>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden"
    >
      <div className="p-6 border-b border-neutral-100 dark:border-neutral-800">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white flex items-center gap-2">
          <Columns3 className="w-5 h-5 text-red-600" />
          Header Normalisation
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          Map source columns to the standard schema before append/merge.
        </p>
      </div>

      <div className="p-6 space-y-4">
        {tableKeys.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Generate AI mapping suggestions for all uploaded tables.
            </p>
            <PrimaryButton onClick={onRun} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Run Header Normalisation
              <ArrowRight className="w-4 h-4" />
            </PrimaryButton>
          </div>
        ) : (
          <>
            <div className="flex flex-col md:flex-row gap-3">
              <select
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
                className="w-full md:w-[420px] px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm"
              >
                {tableKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter columns..."
                className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm"
              />
            </div>

            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-800">
                <div className="col-span-3">Source</div>
                <div className="col-span-3">Target</div>
                <div className="col-span-2">Action</div>
                <div className="col-span-2">Confidence</div>
                <div className="col-span-2">Reason</div>
              </div>
              <div className="max-h-[420px] overflow-auto divide-y divide-neutral-100 dark:divide-neutral-800">
                {rows.map((d) => (
                  <div key={d.source_col} className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-xs">
                    <div className="col-span-3 font-mono text-neutral-700 dark:text-neutral-300 truncate" title={d.source_col}>
                      {d.source_col}
                    </div>
                    <div className="col-span-3">
                      <select
                        value={d.mapped_to || ""}
                        disabled={d.action === "DROP" || d.action === "KEEP"}
                        onChange={(e) => updateRow(d.source_col, { mapped_to: e.target.value || null })}
                        className="w-full px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 disabled:opacity-50"
                      >
                        <option value="">-- Unmapped --</option>
                        {stdFieldNames.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <select
                        value={d.action}
                        onChange={(e) => {
                          const action = normalizeAction(e.target.value);
                          updateRow(d.source_col, {
                            action,
                            mapped_to: action === "DROP" || action === "KEEP" ? null : (d.mapped_to || d.suggested_std_field || null),
                          });
                        }}
                        className="w-full px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                      >
                        <option value="AUTO">AUTO</option>
                        <option value="REVIEW">REVIEW</option>
                        <option value="KEEP">KEEP</option>
                        <option value="DROP">DROP</option>
                      </select>
                    </div>
                    <div className="col-span-2 text-neutral-600 dark:text-neutral-400">
                      {(Number(d.confidence || 0) * 100).toFixed(0)}%
                    </div>
                    <div className="col-span-2 text-neutral-500 dark:text-neutral-400 truncate" title={d.reason}>
                      {d.reason || "-"}
                    </div>
                  </div>
                ))}
                {rows.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                    No columns match this filter.
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <PrimaryButton onClick={applyChanges} disabled={loading || tableKeys.length === 0}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Apply Decisions
            <ArrowRight className="w-4 h-4" />
          </PrimaryButton>
          <SecondaryButton onClick={onRun} disabled={loading}>
            Re-Run AI
          </SecondaryButton>
          <SecondaryButton onClick={onSkip} disabled={loading}>
            <SkipForward className="w-4 h-4" />
            Skip
          </SecondaryButton>
        </div>
      </div>
    </motion.section>
  );
}
