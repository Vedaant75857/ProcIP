import React, { useState, useCallback, useRef, useEffect } from "react";
import { Loader2, ChevronRight, ChevronDown, Database, Layers, Key, Columns, ArrowRight, AlertCircle, AlertTriangle, Plus, X, MessageSquare, ShieldAlert, Sparkles, Info, Search, CheckCircle2, Eye } from "lucide-react";
import { motion } from "motion/react";
import MergeReport from "./MergeReport";
import TablePreviewOverlay from "./TablePreviewOverlay";
import { PrimaryButton, SecondaryButton, EmptyState, SkeletonBlock } from "./ui";

interface MergingProps {
  sessionId: string;
  step: number;
  groupSchema: any[];
  groupNameMap?: Record<string, string>;
  mainGroupId: string;
  setMainGroupId: (id: string) => void;
  dimensionGroupIds: string[];
  setDimensionGroupIds: (ids: string[]) => void;
  mergeKeys: any[];
  setMergeKeys: (keys: any[] | ((prev: any[]) => any[])) => void;
  dimColumnsToAdd: Record<string, string[]>;
  setDimColumnsToAdd: (cols: Record<string, string[]>) => void;
  mergeResult: any;
  loading: boolean;
  handleMergeSetup: () => void;
  handleMergeExecute: () => void;
  handleSkipMerge: () => void;
  downloadCsv: () => void;
  downloadReport: () => void;
  handleGenerateProcurementMapping: () => void;
  onProceedToAnalysis?: () => void;
  onSendToNormalization?: () => void;
  onSelectChatItem?: (item: { type: string; id: string; label: string }) => void;
  mergeCompatibility?: any[] | null;
  compatibilityLoading?: boolean;
  handleMergeCompatibility?: () => void;
}


export default function Merging({
  sessionId,
  step,
  groupSchema,
  groupNameMap = {},
  mainGroupId,
  setMainGroupId,
  dimensionGroupIds,
  setDimensionGroupIds,
  mergeKeys,
  setMergeKeys,
  dimColumnsToAdd,
  setDimColumnsToAdd,
  mergeResult,
  loading,
  handleMergeSetup,
  handleMergeExecute,
  handleSkipMerge,
  downloadCsv,
  downloadReport,
  handleGenerateProcurementMapping,
  onProceedToAnalysis,
  onSendToNormalization,
  onSelectChatItem,
  mergeCompatibility,
  compatibilityLoading = false,
  handleMergeCompatibility,
}: MergingProps) {
  const gn = (id: string) => groupNameMap[id] || id;
  const [previewTarget, setPreviewTarget] = useState<{
    factGroupId: string;
    dimGroupId: string;
    factKey: string | null;
    dimKey: string | null;
    extraKeys?: Array<{ fact_key: string; dim_key: string }>;
  } | null>(null);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const refreshMatchRate = useCallback((mkIndex: number, mk: any) => {
    const dimGid = mk.dimension_group;
    const factKeys = [mk.fact_key, ...(mk.extra_keys || []).map((ek: any) => ek.fact_key)].filter(Boolean);
    const dimKeys = [mk.dim_key, ...(mk.extra_keys || []).map((ek: any) => ek.dim_key)].filter(Boolean);

    if (factKeys.length === 0 || dimKeys.length === 0 || factKeys.length !== dimKeys.length) return;

    if (debounceTimers.current[dimGid]) clearTimeout(debounceTimers.current[dimGid]);
    debounceTimers.current[dimGid] = setTimeout(async () => {
      try {
        const res = await fetch("/api/merge-match-rate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, mainGroupId, dimensionGroupId: dimGid, factKeys, dimKeys }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setMergeKeys((prev: any[]) =>
          prev.map((k, idx) =>
            idx === mkIndex ? { ...k, match_rate: data.match_rate, distinct_matches: data.distinct_matches } : k
          )
        );
      } catch { /* silently ignore network errors */ }
    }, 400);
  }, [sessionId, mainGroupId, setMergeKeys]);

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      for (const key of Object.keys(timers)) {
        clearTimeout(timers[key]);
      }
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Step 5: Merge Configuration */}
      {step === 6 && (
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm overflow-visible"
        >
          <div className="p-6 border-b border-neutral-100 dark:border-neutral-800">
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-red-600 dark:text-red-400" />
              Merge Configuration
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Select your primary fact table, configure join keys, and choose enrichment columns.</p>
          </div>
          
          <div className="p-6 space-y-8">
            {groupSchema.length === 0 ? (
              <EmptyState
                icon={Layers}
                title="No Groups Available"
                description="Complete the Append Strategy step to generate unified tables for merging."
              />
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="flex items-center gap-2 text-sm font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
                      <Database className="w-4 h-4" />
                      Base Fact Table
                    </label>
                    <div className="relative">
                      <select
                        value={mainGroupId}
                        onChange={(e) => setMainGroupId(e.target.value)}
                        className="block w-full pl-4 pr-10 py-3 text-sm border-neutral-200 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 rounded-xl bg-white dark:bg-neutral-900 shadow-sm transition-all appearance-none"
                      >
                        <option value="">-- Select Fact Table --</option>
                        {groupSchema.map((g) => (
                          <option key={g.group_id} value={g.group_id}>
                            {gn(g.group_id)} ({g.rows.toLocaleString()} rows)
                          </option>
                        ))}
                      </select>
                      <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-neutral-400 dark:text-neutral-500">
                        <ChevronRight className="w-4 h-4 rotate-90" />
                      </div>
                    </div>
                    <p className="text-xs text-neutral-400 dark:text-neutral-500 leading-relaxed">
                      This is your primary dataset. All other tables will be joined to this one. The final row count will match this table.
                    </p>
                  </div>
                  
                  <div className="space-y-4">
                    <label className="flex items-center gap-2 text-sm font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
                      <Columns className="w-4 h-4" />
                      Dimension Tables
                    </label>
                    <div className="space-y-2 max-h-64 overflow-y-auto border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 bg-neutral-50/50 dark:bg-neutral-800/50">
                      {groupSchema.filter(g => g.group_id !== mainGroupId).map((g) => (
                        <div key={g.group_id}>
                          <label className="flex items-center p-3 hover:bg-white dark:hover:bg-neutral-800 rounded-lg transition-all cursor-pointer border border-transparent hover:border-neutral-200 dark:hover:border-neutral-700 hover:shadow-sm group">
                            <div className="relative flex items-center">
                              <input
                                type="checkbox"
                                checked={dimensionGroupIds.includes(g.group_id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setDimensionGroupIds([...dimensionGroupIds, g.group_id]);
                                  } else {
                                    setDimensionGroupIds(dimensionGroupIds.filter(id => id !== g.group_id));
                                  }
                                }}
                                className="h-4 w-4 text-red-600 focus:ring-red-500 border-neutral-300 rounded transition-all"
                              />
                            </div>
                            <div className="ml-3 flex-1">
                              <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">{gn(g.group_id)}</p>
                              <p className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium uppercase tracking-tighter">{g.rows.toLocaleString()} rows • {g.columns.length} columns</p>
                            </div>
                          </label>
                          {g.columns_preview && (
                            <p className="ml-10 -mt-1 mb-1 text-[10px] text-neutral-400 dark:text-neutral-500 truncate max-w-[250px]" title={g.columns_preview}>
                              {g.columns_preview}
                            </p>
                          )}
                        </div>
                      ))}
                      {groupSchema.filter(g => g.group_id !== mainGroupId).length === 0 && mainGroupId && (
                        <div className="py-8 text-center">
                          <p className="text-sm text-neutral-400 dark:text-neutral-500 italic">No other tables available to merge.</p>
                        </div>
                      )}
                      {!mainGroupId && groupSchema.length > 0 && (
                        <div className="py-8 text-center">
                          <p className="text-sm text-neutral-400 dark:text-neutral-500 italic">Select a fact table first.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Compatibility Analysis Panel */}
                {mainGroupId && dimensionGroupIds.length > 0 && (
                  <div className="border border-neutral-200 dark:border-neutral-700 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 bg-neutral-50 dark:bg-neutral-800 border-b border-neutral-100 dark:border-neutral-700">
                      <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-red-500" />
                        <h3 className="text-sm font-bold text-neutral-900 dark:text-white">Compatibility Analysis</h3>
                        <span className="text-[10px] text-neutral-400 dark:text-neutral-500">Which dimensions to merge and why</span>
                      </div>
                      {handleMergeCompatibility && (
                        <SecondaryButton
                          onClick={handleMergeCompatibility}
                          disabled={compatibilityLoading || loading}
                        >
                          {compatibilityLoading ? <Loader2 className="animate-spin w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                          {mergeCompatibility ? "Re-analyze" : "Analyze Compatibility"}
                        </SecondaryButton>
                      )}
                    </div>

                    {compatibilityLoading && (
                      <div className="p-5 space-y-3">
                        <SkeletonBlock className="h-16 rounded-xl" />
                        <div className="grid grid-cols-2 gap-3">
                          <SkeletonBlock className="h-24 rounded-xl" />
                          <SkeletonBlock className="h-24 rounded-xl" />
                        </div>
                      </div>
                    )}

                    {!compatibilityLoading && mergeCompatibility && mergeCompatibility.length > 0 && (
                      <div className="p-5 space-y-3">
                        {mergeCompatibility.map((result: any) => {
                          const actionColors: Record<string, string> = {
                            merge: "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30",
                            optional: "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30",
                            skip: "border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800",
                          };
                          const badgeColors: Record<string, string> = {
                            merge: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
                            optional: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
                            skip: "bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400",
                          };
                          const action = result.action || "skip";
                          return (
                            <div key={result.dim_group_id} className={`border rounded-xl p-4 ${actionColors[action] || actionColors.skip}`}>
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-neutral-900 dark:text-white">{gn(result.dim_group_id)}</span>
                                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${badgeColors[action] || badgeColors.skip}`}>
                                    {action}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500">Priority</span>
                                  <span className="text-sm font-black tabular-nums text-neutral-900 dark:text-white">{result.priority_score}</span>
                                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500">/100</span>
                                </div>
                              </div>

                              <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed mb-3">{result.rationale}</p>

                              {result.likely_join_keys?.length > 0 && (
                                <div className="mb-2">
                                  <span className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Likely Join Keys</span>
                                  <div className="flex flex-wrap gap-1.5 mt-1">
                                    {result.likely_join_keys.map((jk: any, idx: number) => (
                                      <span key={idx} className="inline-flex items-center gap-1 text-[10px] font-medium bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 rounded-md">
                                        <Key className="w-2.5 h-2.5 text-neutral-400" />
                                        {jk.fact_col} ↔ {jk.dim_col}
                                        <span className="text-neutral-400">({(jk.confidence * 100).toFixed(0)}%)</span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {result.enrichment_columns?.length > 0 && (
                                <div className="mb-2">
                                  <span className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Enrichment Columns</span>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {result.enrichment_columns.map((ec: any) => (
                                      <span key={ec.name} className="text-[10px] font-medium bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 px-1.5 py-0.5 rounded" title={ec.value}>
                                        {ec.name} <span className="text-neutral-400">({ec.category})</span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {result.warnings?.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {result.warnings.map((w: string, idx: number) => (
                                    <span key={idx} className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                                      <AlertTriangle className="w-2.5 h-2.5" /> {w}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {!compatibilityLoading && !mergeCompatibility && (
                      <div className="p-5 text-center">
                        <p className="text-xs text-neutral-400 dark:text-neutral-500">Click &quot;Analyze Compatibility&quot; to see which dimensions are worth merging, what columns they add, and likely join keys.</p>
                      </div>
                    )}
                  </div>
                )}

                {mergeKeys.length > 0 && (
                  <div className="space-y-4 border-t border-neutral-100 dark:border-neutral-800 pt-6">
                    <div className="flex items-center gap-2">
                      <Key className="w-5 h-5 text-red-600 dark:text-red-400" />
                      <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">Key Discovery Results</h3>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400 ml-2">AI-discovered join keys (editable)</p>
                    </div>
                    {mergeKeys.map((mk, i) => {
                      const mainGroup = groupSchema.find(g => g.group_id === mainGroupId);
                      const dimGroup = groupSchema.find(g => g.group_id === mk.dimension_group);
                      const mainCols: string[] = mainGroup?.columns || [];
                      const dimCols: string[] = dimGroup?.columns || [];
                      const extraKeys: Array<{ fact_key: string; dim_key: string }> = mk.extra_keys || [];

                      const updateKey = (field: "fact_key" | "dim_key", value: string) => {
                        const newKey = { ...mk, [field]: value };
                        if (newKey.fact_key && newKey.dim_key) newKey.status = "proposed";
                        const updated = mergeKeys.map((k, idx) => idx === i ? newKey : k);
                        setMergeKeys(updated);
                        refreshMatchRate(i, newKey);
                      };

                      const addExtraKey = () => {
                        const updated = mergeKeys.map((k, idx) => {
                          if (idx !== i) return k;
                          return { ...k, extra_keys: [...(k.extra_keys || []), { fact_key: "", dim_key: "" }] };
                        });
                        setMergeKeys(updated);
                      };

                      const updateExtraKey = (ekIdx: number, field: "fact_key" | "dim_key", value: string) => {
                        const newExtras = [...(mk.extra_keys || [])];
                        newExtras[ekIdx] = { ...newExtras[ekIdx], [field]: value };
                        const newMk = { ...mk, extra_keys: newExtras };
                        const updated = mergeKeys.map((k, idx) => idx === i ? newMk : k);
                        setMergeKeys(updated);
                        refreshMatchRate(i, newMk);
                      };

                      const removeExtraKey = (ekIdx: number) => {
                        const newExtras = [...(mk.extra_keys || [])];
                        newExtras.splice(ekIdx, 1);
                        const newMk = { ...mk, extra_keys: newExtras };
                        const updated = mergeKeys.map((k, idx) => idx === i ? newMk : k);
                        setMergeKeys(updated);
                        refreshMatchRate(i, newMk);
                      };

                      return (
                        <motion.div key={i} whileHover={{ y: -2 }} className="border border-neutral-200 dark:border-neutral-700 rounded-2xl p-5 bg-white dark:bg-neutral-900 hover:border-red-200 transition-all shadow-sm">
                          <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center gap-2">
                              <div>
                                <h3 className="font-bold text-neutral-900 dark:text-white">{gn(mk.dimension_group)}</h3>
                                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 uppercase font-bold tracking-wider">Dimension Table</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setPreviewTarget({
                                  factGroupId: mainGroupId,
                                  dimGroupId: mk.dimension_group,
                                  factKey: mk.fact_key,
                                  dimKey: mk.dim_key,
                                  extraKeys: mk.extra_keys,
                                })}
                                className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                title="Preview tables side by side"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              {onSelectChatItem && (
                                <button
                                  type="button"
                                  onClick={() => onSelectChatItem({ type: "merge_key", id: mk.dimension_group, label: `Merge: ${mk.dimension_group}` })}
                                  className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                  title="Ask AI about this merge"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {mk.confidence != null && (
                                <span className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded-full">
                                  {(mk.confidence * 100).toFixed(0)}% conf
                                </span>
                              )}
                              <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                mk.status === 'proposed' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200' :
                                mk.status === 'review_needed' ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200' :
                                mk.status === 'blocked_risky_join' ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200' :
                                'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200'
                              }`}>
                                {mk.status === 'blocked_risky_join' ? 'BLOCKED' : mk.status === 'review_needed' ? 'REVIEW' : mk.status}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-3">
                            {/* Primary key pair */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-3 border border-neutral-100 dark:border-neutral-800">
                                <p className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase mb-2">Fact Key (Base)</p>
                                <select
                                  value={mk.fact_key || ""}
                                  onChange={(e) => updateKey("fact_key", e.target.value)}
                                  className="w-full text-sm font-bold text-red-600 dark:text-red-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-1.5 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-red-500 appearance-none"
                                >
                                  <option value="">-- select column --</option>
                                  {mainCols.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                              <div className="flex justify-center">
                                <div className="h-px bg-neutral-200 dark:bg-neutral-700 w-full relative">
                                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-neutral-900 px-2">
                                    <ArrowRight className="w-4 h-4 text-neutral-300 dark:text-neutral-600" />
                                  </div>
                                </div>
                              </div>
                              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-3 border border-neutral-100 dark:border-neutral-800">
                                <p className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase mb-2">Dimension Key</p>
                                <select
                                  value={mk.dim_key || ""}
                                  onChange={(e) => updateKey("dim_key", e.target.value)}
                                  className="w-full text-sm font-bold text-red-600 dark:text-red-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-1.5 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-red-500 appearance-none"
                                >
                                  <option value="">-- select column --</option>
                                  {dimCols.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                            </div>

                            {/* Extra key pairs */}
                            {extraKeys.map((ek, ekIdx) => (
                              <div key={ekIdx} className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] gap-4 items-center">
                                <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-3 border border-neutral-100 dark:border-neutral-800">
                                  <p className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase mb-2">Fact Key {ekIdx + 2}</p>
                                  <select
                                    value={ek.fact_key || ""}
                                    onChange={(e) => updateExtraKey(ekIdx, "fact_key", e.target.value)}
                                    className="w-full text-sm font-bold text-red-600 dark:text-red-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-1.5 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-red-500 appearance-none"
                                  >
                                    <option value="">-- select column --</option>
                                    {mainCols.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                </div>
                                <div className="flex justify-center">
                                  <ArrowRight className="w-4 h-4 text-neutral-300 dark:text-neutral-600" />
                                </div>
                                <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-3 border border-neutral-100 dark:border-neutral-800">
                                  <p className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase mb-2">Dimension Key {ekIdx + 2}</p>
                                  <select
                                    value={ek.dim_key || ""}
                                    onChange={(e) => updateExtraKey(ekIdx, "dim_key", e.target.value)}
                                    className="w-full text-sm font-bold text-red-600 dark:text-red-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-1.5 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-red-500 appearance-none"
                                  >
                                    <option value="">-- select column --</option>
                                    {dimCols.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeExtraKey(ekIdx)}
                                  className="p-2 rounded-lg text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                  title="Remove this key pair"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ))}

                            {/* Add extra key button */}
                            <button
                              type="button"
                              onClick={addExtraKey}
                              className="inline-flex items-center gap-1.5 text-xs font-bold text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 transition-colors mt-1"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add Key Pair
                            </button>
                          </div>

                          {mk.match_rate != null && mk.match_rate > 0 && (
                            <div className="mt-4 pt-4 border-t border-neutral-100 dark:border-neutral-800 flex gap-8 flex-wrap">
                              <div className="flex flex-col">
                                <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-bold uppercase">Match Rate</span>
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-1.5 bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${mk.match_rate * 100}%` }}></div>
                                  </div>
                                  <span className="text-sm font-bold text-neutral-900 dark:text-white">{(mk.match_rate * 100).toFixed(1)}%</span>
                                </div>
                              </div>
                              {mk.distinct_matches != null && (
                                <div className="flex flex-col">
                                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-bold uppercase">Unique Matches</span>
                                  <span className="text-sm font-bold text-neutral-900 dark:text-white">{mk.distinct_matches?.toLocaleString()}</span>
                                </div>
                              )}
                              {mk.join_type && (
                                <div className="flex flex-col">
                                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-bold uppercase">Join Type</span>
                                  <span className="text-sm font-bold text-neutral-900 dark:text-white">{mk.join_type.replace(/_/g, ' ')}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {mk.risk_flags && mk.risk_flags.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {mk.risk_flags.map((flag: string) => (
                                <span key={flag} className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                                  <ShieldAlert className="w-3 h-3" />
                                  {flag.replace(/_/g, ' ')}
                                </span>
                              ))}
                            </div>
                          )}

                          {mk.rationale && (
                            <div className="mt-3 flex items-start gap-2 bg-blue-50 dark:bg-blue-950/20 rounded-xl p-3 border border-blue-100 dark:border-blue-900/40">
                              <Info className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                              <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">{mk.rationale}</p>
                            </div>
                          )}

                          {mk.simulation && (
                            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-lg p-2 text-center">
                                <p className="text-[9px] font-bold text-neutral-400 dark:text-neutral-500 uppercase">Row Expansion</p>
                                <p className={`text-sm font-black tabular-nums ${(mk.simulation?.rowExpansionRatio ?? 1) > 1.02 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                  {(mk.simulation?.rowExpansionRatio ?? 1).toFixed(3)}x
                                </p>
                              </div>
                              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-lg p-2 text-center">
                                <p className="text-[9px] font-bold text-neutral-400 dark:text-neutral-500 uppercase">Null Estimate</p>
                                <p className="text-sm font-black tabular-nums text-neutral-700 dark:text-neutral-300">
                                  {((mk.simulation?.addedColumnNullRateEstimate ?? 0) * 100).toFixed(1)}%
                                </p>
                              </div>
                              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-lg p-2 text-center">
                                <p className="text-[9px] font-bold text-neutral-400 dark:text-neutral-500 uppercase">Matched Rows</p>
                                <p className="text-sm font-black tabular-nums text-neutral-700 dark:text-neutral-300">
                                  {mk.simulation.matchedFactRows?.toLocaleString()}
                                </p>
                              </div>
                              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-lg p-2 text-center">
                                <p className="text-[9px] font-bold text-neutral-400 dark:text-neutral-500 uppercase">Dup Dim Keys</p>
                                <p className={`text-sm font-black tabular-nums ${(mk.simulation?.duplicatedDimKeys ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                  {(mk.simulation?.duplicatedDimKeys ?? 0).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          )}

                          {mk.alternatives && mk.alternatives.length > 0 && (
                            <details className="mt-3">
                              <summary className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase cursor-pointer hover:text-red-600 dark:hover:text-red-400 transition-colors flex items-center gap-1">
                                <Sparkles className="w-3 h-3" />
                                {mk.alternatives.length} Alternative{mk.alternatives.length > 1 ? 's' : ''}
                              </summary>
                              <div className="mt-2 space-y-1.5">
                                {mk.alternatives.map((alt: any, altIdx: number) => (
                                  <div key={altIdx} className="flex items-center gap-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg px-3 py-2 text-xs">
                                    <span className="font-bold text-neutral-400 dark:text-neutral-500 w-4">{altIdx + 1}.</span>
                                    <span className="font-mono text-neutral-700 dark:text-neutral-300">
                                      {alt.factKeys?.join(' + ')} → {alt.dimKeys?.join(' + ')}
                                    </span>
                                    <span className="ml-auto text-[10px] font-bold text-neutral-500 dark:text-neutral-400">
                                      {(alt.confidence * 100).toFixed(0)}%
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}

                          {mk.status === 'no_match_found' && (
                            <div className="mt-4 bg-amber-50 dark:bg-amber-950/30 rounded-xl p-3 border border-amber-100">
                              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">No key auto-discovered. Select columns manually above to create a join.</p>
                            </div>
                          )}

                          {mk.status === 'blocked_risky_join' && (
                            <div className="mt-4 bg-red-50 dark:bg-red-950/30 rounded-xl p-3 border border-red-100 dark:border-red-900/40">
                              <p className="text-xs text-red-700 dark:text-red-400 font-medium flex items-center gap-1.5">
                                <ShieldAlert className="w-3.5 h-3.5" />
                                Blocked: This join was determined to be risky. Review manually or adjust key selection.
                              </p>
                            </div>
                          )}

                          {mk.status === 'review_needed' && !mk.risk_flags?.length && !mk.rationale && (
                            <div className="mt-4 bg-amber-50 dark:bg-amber-950/30 rounded-xl p-3 border border-amber-100">
                              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">This join needs review. Check the key selection and simulation metrics before proceeding.</p>
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                )}

                {mergeKeys.length > 0 && mergeKeys.some(mk => mk.status === 'proposed' || mk.status === 'review_needed') && (
                  <div className="space-y-8 border-t border-neutral-100 dark:border-neutral-800 pt-6">
                    <div className="flex items-center gap-2">
                      <Columns className="w-5 h-5 text-red-600 dark:text-red-400" />
                      <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">Column Enrichment</h3>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400 ml-2">Choose attributes to add to the final file</p>
                    </div>
                    {mergeKeys.filter(mk => mk.status === 'proposed' || mk.status === 'review_needed').map((mk) => {
                      const dimGroup = groupSchema.find(g => g.group_id === mk.dimension_group);
                      if (!dimGroup) return null;
                      const allDimKeys = new Set([mk.dim_key, ...(mk.extra_keys || []).map((ek: any) => ek.dim_key)].filter(Boolean));
                      const availableCols = dimGroup.columns.filter((c: string) => !allDimKeys.has(c));
                      const selectedCount = dimColumnsToAdd[mk.dimension_group]?.length || 0;
                      
                      return (
                        <div key={mk.dimension_group} className="space-y-4">
                          {mk.join_strategy === "aggregated" && (
                            <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-sm">
                              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                              <span>This dimension file was aggregated to match the fact file&apos;s granularity. Numeric columns have been summed; text columns use the first available value. Pulled values may differ from raw row-level data.</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center gap-3">
                            <h3 className="font-bold text-neutral-900 dark:text-white">{gn(mk.dimension_group)}</h3>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setDimColumnsToAdd({ ...dimColumnsToAdd, [mk.dimension_group]: [...availableCols] })}
                                className="text-[10px] font-bold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-400 transition-colors"
                              >
                                Select All
                              </button>
                              <span className="text-neutral-300 dark:text-neutral-600">|</span>
                              <button
                                type="button"
                                onClick={() => setDimColumnsToAdd({ ...dimColumnsToAdd, [mk.dimension_group]: [] })}
                                className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
                              >
                                Deselect All
                              </button>
                              <span className="text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-2 py-1 rounded-full uppercase">
                                {selectedCount} / {availableCols.length}
                              </span>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-neutral-50 dark:bg-neutral-800 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-800">
                            {availableCols.map((col: string) => (
                              <label key={col} className="flex items-center space-x-3 text-sm p-2.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl cursor-pointer hover:border-red-300 hover:shadow-sm transition-all group">
                                <input
                                  type="checkbox"
                                  checked={dimColumnsToAdd[mk.dimension_group]?.includes(col) || false}
                                  onChange={(e) => {
                                    const current = dimColumnsToAdd[mk.dimension_group] || [];
                                    if (e.target.checked) {
                                      setDimColumnsToAdd({ ...dimColumnsToAdd, [mk.dimension_group]: [...current, col] });
                                    } else {
                                      setDimColumnsToAdd({ ...dimColumnsToAdd, [mk.dimension_group]: current.filter(c => c !== col) });
                                    }
                                  }}
                                  className="rounded border-neutral-300 text-red-600 focus:ring-red-500 transition-all"
                                />
                                <span className="truncate font-medium text-neutral-600 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors" title={col}>{col}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="p-6 border-t border-neutral-100 dark:border-neutral-800 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
            <div className="flex flex-col gap-1">
              {groupSchema.length >= 1 && (
                <button
                  type="button"
                  onClick={handleSkipMerge}
                  disabled={loading}
                  className="text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 transition-colors text-left disabled:opacity-50"
                >
                  {groupSchema.length === 1
                    ? "Only one table — use as final file (skip merge)"
                    : "Skip merge — use selected fact table as final file"}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {mainGroupId && dimensionGroupIds.length > 0 && (
                <SecondaryButton onClick={handleMergeSetup} disabled={loading || !mainGroupId}>
                  {loading ? <Loader2 className="animate-spin w-4 h-4" /> : <Key className="w-4 h-4" />}
                  {mergeKeys.length > 0 ? "Re-analyze Keys" : "Analyze Join Keys"}
                </SecondaryButton>
              )}
              {mergeKeys.length > 0 && mergeKeys.some(mk => mk.status === 'proposed' || mk.status === 'review_needed' || mk.status === 'manual') && (
                <PrimaryButton onClick={handleMergeExecute} disabled={loading}>
                  Execute Final Merge
                  <ArrowRight className="w-4 h-4" />
                </PrimaryButton>
              )}
            </div>
          </div>
        </motion.section>
      )}

      {/* Step 7: Results & Download */}
      {step === 7 && (
        <motion.section 
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden"
        >
          <MergeReport
            mergeResult={mergeResult}
            downloadCsv={downloadCsv}
            downloadReport={downloadReport}
            handleGenerateProcurementMapping={handleGenerateProcurementMapping}
            onProceedToAnalysis={onProceedToAnalysis}
            onSendToNormalization={onSendToNormalization}
            loading={loading}
            onSelectChatItem={onSelectChatItem}
          />
        </motion.section>
      )}

      {previewTarget && (
        <TablePreviewOverlay
          sessionId={sessionId}
          target={previewTarget}
          onClose={() => setPreviewTarget(null)}
        />
      )}
    </div>
  );
}
