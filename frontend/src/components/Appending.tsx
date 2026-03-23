import React, { useState, useRef, useEffect } from "react";
import { Loader2, ChevronRight, ChevronDown, LayoutGrid, ListChecks, ArrowRight, Info, Plus, MoreHorizontal, Undo2, Ban, Trash2, X, Eye, EyeOff, MessageSquare, Sparkles, AlertTriangle, Lightbulb, RefreshCw, Database, Columns, BarChart3, TrendingUp, Shield, Layers } from "lucide-react";
import { motion } from "motion/react";
import AppendReport from "./AppendReport";
import { PrimaryButton, EmptyState, ResultCapsules, SkeletonBlock } from "./ui";

interface AppendingProps {
  step: number;
  appendGroups: any[];
  unassigned: any[];
  excludedTables: string[];
  appendGroupMappings: any[];
  setAppendGroupMappings: (mappings: any[]) => void;
  previews: Record<string, { columns: string[]; rows: any[] }>;
  loading: boolean;
  handleGenerateAppendPlan: () => void;
  handleGenerateAppendMapping: () => void;
  handleExecuteAppend: () => void;
  moveTableToGroup: (tableKey: string, targetGroupId: string | null) => void;
  createNewGroup: (tableKeys: string[]) => void;
  excludeTable: (tableKey: string) => void;
  restoreTable: (tableKey: string) => void;
  appendReport: any[] | null;
  handleProceedToMerge: () => void;
  onSelectChatItem?: (item: { type: string; id: string; label: string }) => void;
  groupInsights?: Record<string, any>;
  groupInsightsLoading?: boolean;
  onRetryInsights?: () => void;
  groupReports?: any[];
  crossGroupOverview?: any;
}

function TableActionMenu({
  tableKey,
  currentGroupId,
  appendGroups,
  moveTableToGroup,
  excludeTable,
}: {
  tableKey: string;
  currentGroupId: string | null;
  appendGroups: any[];
  moveTableToGroup: (tableKey: string, targetGroupId: string | null) => void;
  excludeTable: (tableKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const otherGroups = appendGroups.filter(g => g.group_id !== currentGroupId);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-xl py-1 text-xs">
          {currentGroupId !== null && (
            <button
              onClick={() => { moveTableToGroup(tableKey, null); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 flex items-center gap-2"
            >
              <Undo2 className="w-3 h-3 text-neutral-400" /> Move to Unassigned
            </button>
          )}
          {otherGroups.map(g => (
            <button
              key={g.group_id}
              onClick={() => { moveTableToGroup(tableKey, g.group_id); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 flex items-center gap-2"
            >
              <ArrowRight className="w-3 h-3 text-red-400" /> Move to {g.group_name || g.group_id}
            </button>
          ))}
          <div className="border-t border-neutral-100 dark:border-neutral-800 my-1" />
          <button
            onClick={() => { if (window.confirm(`Exclude "${tableKey}" from processing?`)) { excludeTable(tableKey); setOpen(false); } }}
            className="w-full text-left px-3 py-2 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 flex items-center gap-2"
          >
            <Ban className="w-3 h-3" /> Exclude from processing
          </button>
        </div>
      )}
    </div>
  );
}

function AnalysisSlicesPanel({ sliceResults }: { sliceResults: any[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!sliceResults?.length) return null;

  return (
    <div>
      <p className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
        <BarChart3 className="w-3 h-3" /> Analysis Results
      </p>
      <div className="space-y-1">
        {sliceResults.map((sr: any, i: number) => (
          <div key={i} className="border border-neutral-100 dark:border-neutral-700 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setExpanded(expanded === i ? null : i)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
            >
              <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate">
                {sr.slice?.rationale || `${sr.slice?.dimension} by ${sr.slice?.aggregation}`}
              </span>
              {expanded === i
                ? <ChevronDown className="w-3 h-3 text-neutral-400 shrink-0" />
                : <ChevronRight className="w-3 h-3 text-neutral-400 shrink-0" />}
            </button>
            {expanded === i && sr.topValues?.length > 0 && (
              <div className="px-2.5 pb-2">
                <div className="space-y-1">
                  {sr.topValues.slice(0, 8).map((tv: any, j: number) => {
                    const maxVal = sr.topValues[0]?.value || 1;
                    const pct = Math.max(5, (tv.value / maxVal) * 100);
                    return (
                      <div key={j} className="flex items-center gap-2 text-[10px]">
                        <span className="w-24 truncate text-neutral-600 dark:text-neutral-400 font-medium shrink-0">{tv.key}</span>
                        <div className="flex-1 h-3 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-400 dark:bg-red-500 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-neutral-500 dark:text-neutral-400 font-mono w-16 text-right shrink-0">
                          {typeof tv.value === "number" ? tv.value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : tv.value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CrossGroupOverviewCard({ overview }: { overview: any }) {
  if (!overview) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-neutral-200 dark:border-neutral-700 rounded-2xl bg-white dark:bg-neutral-900 shadow-sm p-5 space-y-4"
    >
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-red-500" />
        <h3 className="font-bold text-neutral-900 dark:text-white">Cross-Group Overview</h3>
        <span className="text-[10px] text-neutral-400 dark:text-neutral-500 ml-auto">
          {overview.totalGroups} groups &middot; {overview.totalRows?.toLocaleString()} total rows
        </span>
      </div>

      {overview.narrative && (
        <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">{overview.narrative}</p>
      )}

      {overview.valueOverlap?.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest mb-2">Value Overlap Between Groups</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-[10px]">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-700">
                  <th className="px-2 py-1 text-left font-bold text-neutral-500 dark:text-neutral-400">Group A</th>
                  <th className="px-2 py-1 text-left font-bold text-neutral-500 dark:text-neutral-400">Group B</th>
                  <th className="px-2 py-1 text-left font-bold text-neutral-500 dark:text-neutral-400">Column</th>
                  <th className="px-2 py-1 text-right font-bold text-neutral-500 dark:text-neutral-400">Overlap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                {overview.valueOverlap.slice(0, 10).map((vo: any, i: number) => (
                  <tr key={i}>
                    <td className="px-2 py-1 text-neutral-600 dark:text-neutral-300">{vo.groupA}</td>
                    <td className="px-2 py-1 text-neutral-600 dark:text-neutral-300">{vo.groupB}</td>
                    <td className="px-2 py-1 font-mono text-neutral-600 dark:text-neutral-300">{vo.column}</td>
                    <td className="px-2 py-1 text-right">
                      <span className={`font-bold ${
                        vo.overlapRate > 0.5 ? "text-emerald-600 dark:text-emerald-400" :
                        vo.overlapRate > 0.2 ? "text-amber-600 dark:text-amber-400" :
                        "text-neutral-500 dark:text-neutral-400"
                      }`}>
                        {(vo.overlapRate * 100).toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {overview.mergeHints?.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
            <Lightbulb className="w-3 h-3" /> Merge Hints
          </p>
          <ul className="space-y-1">
            {overview.mergeHints.map((hint: string, i: number) => (
              <li key={i} className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-lg px-2.5 py-1.5">
                {hint}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}

export default function Appending({
  step,
  appendGroups,
  unassigned,
  excludedTables,
  appendGroupMappings,
  setAppendGroupMappings,
  previews,
  loading,
  handleGenerateAppendPlan,
  handleGenerateAppendMapping,
  handleExecuteAppend,
  moveTableToGroup,
  createNewGroup,
  excludeTable,
  restoreTable,
  appendReport,
  handleProceedToMerge,
  onSelectChatItem,
  groupInsights = {},
  groupInsightsLoading = false,
  onRetryInsights,
  groupReports,
  crossGroupOverview,
}: AppendingProps) {
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);
  const [previewTable, setPreviewTable] = useState<string | null>(null);

  const toggleTableSelection = (tableKey: string) => {
    setSelectedTables(prev =>
      prev.includes(tableKey)
        ? prev.filter(t => t !== tableKey)
        : [...prev, tableKey]
    );
  };

  const handleCreateGroup = () => {
    if (selectedTables.length > 0) {
      createNewGroup(selectedTables);
      setSelectedTables([]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step 3: Append Plan */}
      {step === 3 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm overflow-visible"
        >
          <div className="p-6 border-b border-neutral-100 dark:border-neutral-800">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white flex items-center gap-2">
                  <LayoutGrid className="w-5 h-5 text-red-600" />
                  Append Strategy
                </h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">AI has grouped your files. Adjust groups, exclude tables, or create new groups below.</p>
              </div>
              <div className="flex gap-2 shrink-0">
                {selectedTables.length > 0 && (
                  <button
                    onClick={handleCreateGroup}
                    className="inline-flex items-center px-4 py-2 text-xs font-bold rounded-lg shadow-sm text-white bg-red-600 hover:bg-red-700 transition-all gap-2"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Create Group ({selectedTables.length})
                  </button>
                )}
              </div>
            </div>

            {selectedTables.length > 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-red-600 dark:text-red-400 font-medium bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg">
                <Info className="w-3.5 h-3.5" />
                {selectedTables.length} table{selectedTables.length !== 1 ? "s" : ""} selected — click "Create Group" to form a new group, or click tables again to deselect.
              </div>
            )}
          </div>

          <div className="p-6 space-y-6">
            {appendGroups.length === 0 && unassigned.length === 0 && excludedTables.length === 0 ? (
              <EmptyState
                icon={LayoutGrid}
                title="No Append Plan Yet"
                description="Let AI analyze your tables and suggest how to group them for appending."
                action={
                  <PrimaryButton onClick={handleGenerateAppendPlan} disabled={loading}>
                    {loading ? <Loader2 className="animate-spin w-4 h-4" /> : null}
                    Generate Append Plan
                    <ArrowRight className="w-4 h-4" />
                  </PrimaryButton>
                }
              />
            ) : (
              <>
                <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-red-50/50 dark:bg-red-950/30 border border-red-100 rounded-xl px-4 py-3">
                  To create a new group: click one or more table names below to select them, then click the &quot;Create Group&quot; button (top right) or the dashed card.
                </p>

                {/* Groups list */}
                <div className="space-y-5">
                  {appendGroups.map((group) => {
                    const insight = groupInsights[group.group_id];
                    const hasInsight = !!insight;
                    return (
                      <motion.div key={group.group_id} whileHover={{ y: -1 }} className="border border-neutral-200 dark:border-neutral-700 rounded-2xl bg-white dark:bg-neutral-900 hover:border-red-200 dark:hover:border-red-900/50 transition-all shadow-sm overflow-visible">
                        {/* Group Header */}
                        <div className="flex justify-between items-start p-5 pb-0">
                          <div className="min-w-0">
                            <h3 className="font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                              <Database className="w-4 h-4 text-red-500" />
                              {group.group_name || group.group_id}
                            </h3>
                            {group.group_name && (
                              <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5 font-mono">{group.group_id}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {onSelectChatItem && (
                              <button
                                type="button"
                                onClick={() => onSelectChatItem({ type: "group", id: group.group_id, label: group.group_id })}
                                className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                title="Ask AI about this group"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setPreviewTable(previewTable === group.tables?.[0] ? null : group.tables?.[0])}
                              className="p-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
                              title="Preview first table"
                            >
                              {previewTable === group.tables?.[0] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <span className="bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider">
                              {group.tables?.length} Files
                            </span>
                          </div>
                        </div>

                        {/* Two-column body */}
                        <div className="flex flex-col md:flex-row gap-0 md:gap-0 p-5">
                          {/* Left: Files & Preview */}
                          <div className={`flex-1 min-w-0 ${hasInsight || groupInsightsLoading ? "md:border-r md:border-neutral-100 md:dark:border-neutral-800 md:pr-5" : ""}`}>
                            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4 leading-relaxed line-clamp-2">{group.reason}</p>

                            {previewTable && group.tables?.includes(previewTable) && previews[previewTable] && previews[previewTable].columns.length > 0 && (
                              <div className="mb-4 overflow-x-auto border border-neutral-100 dark:border-neutral-800 rounded-xl max-h-48">
                                <table className="min-w-full text-[10px]">
                                  <thead className="bg-neutral-50 dark:bg-neutral-800 sticky top-0">
                                    <tr>
                                      {previews[previewTable].columns.map(col => (
                                        <th key={col} className="px-2 py-1.5 text-left font-bold text-neutral-500 dark:text-neutral-400 whitespace-nowrap border-b border-neutral-200 dark:border-neutral-700">{col}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                                    {previews[previewTable].rows.slice(0, 5).map((row, ri) => (
                                      <tr key={ri}>
                                        {previews[previewTable].columns.map(col => (
                                          <td key={col} className="px-2 py-1 whitespace-nowrap text-neutral-600 dark:text-neutral-300 max-w-[150px] truncate">
                                            {row[col] != null ? String(row[col]) : <span className="text-neutral-300 dark:text-neutral-600">-</span>}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            <div className="flex flex-wrap gap-2">
                              {group.tables?.map((t: string) => (
                                <span
                                  key={t}
                                  onClick={() => toggleTableSelection(t)}
                                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-all ${
                                    selectedTables.includes(t)
                                      ? "bg-red-600 border-red-600 text-white"
                                      : "bg-neutral-50 dark:bg-neutral-800 border-neutral-100 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:border-red-300"
                                  }`}
                                >
                                  {t}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); if (window.confirm(`Exclude "${t}" from processing?`)) excludeTable(t); }}
                                    className="p-0.5 rounded hover:bg-red-100 text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400 transition-colors shrink-0"
                                    title="Exclude from processing"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                  <TableActionMenu
                                    tableKey={t}
                                    currentGroupId={group.group_id}
                                    appendGroups={appendGroups}
                                    moveTableToGroup={moveTableToGroup}
                                    excludeTable={excludeTable}
                                  />
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Right: AI Insight */}
                          {(hasInsight || groupInsightsLoading) && (() => {
                            const report = groupReports?.find((r: any) => r.groupId === group.group_id);
                            const isEnhanced = !!report;
                            return (
                            <div className="flex-1 min-w-0 md:pl-5 mt-4 md:mt-0">
                              {groupInsightsLoading && !hasInsight ? (
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-xs font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
                                    <Sparkles className="w-3.5 h-3.5 animate-pulse text-red-400" />
                                    Generating insights...
                                  </div>
                                  <SkeletonBlock className="h-4 w-3/4" />
                                  <SkeletonBlock className="h-4 w-full" />
                                  <SkeletonBlock className="h-3 w-1/2" />
                                  <SkeletonBlock className="h-16 w-full" />
                                  <SkeletonBlock className="h-3 w-2/3" />
                                </div>
                              ) : hasInsight ? (
                                <motion.div
                                  initial={{ opacity: 0, x: 12 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                                  className="space-y-3"
                                >
                                  {/* Header with Quality Score */}
                                  <div className="flex items-center gap-2 text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">
                                    <Sparkles className="w-3.5 h-3.5" />
                                    AI Insight
                                    {insight.dataDescription && (
                                      <span className="ml-auto text-[10px] font-bold bg-red-50 dark:bg-red-950/30 text-red-500 dark:text-red-400 px-2 py-0.5 rounded-full normal-case tracking-normal">
                                        {insight.dataDescription}
                                      </span>
                                    )}
                                  </div>

                                  {/* Quality Score Badge (enhanced only) */}
                                  {isEnhanced && report.quality && (
                                    <div className="flex items-center gap-3 flex-wrap">
                                      <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${
                                        report.quality.overallScore >= 80
                                          ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                                          : report.quality.overallScore >= 50
                                          ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                                          : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
                                      }`}>
                                        <Shield className="w-3 h-3" />
                                        Quality: {report.quality.overallScore}/100
                                      </div>
                                      <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                                        {report.profile?.totalRows?.toLocaleString()} rows &middot; {report.profile?.totalCols} cols
                                      </span>
                                    </div>
                                  )}

                                  {/* Summary */}
                                  {insight.summary && (
                                    <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">{insight.summary}</p>
                                  )}

                                  {/* Top Insights (enhanced only) */}
                                  {isEnhanced && insight.topInsights?.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                        <TrendingUp className="w-3 h-3" /> Key Findings
                                      </p>
                                      <div className="space-y-1.5">
                                        {insight.topInsights.map((ti: any, i: number) => (
                                          <div key={i} className={`text-xs rounded-lg px-2.5 py-2 border ${
                                            ti.importance === "high"
                                              ? "bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30 text-red-700 dark:text-red-300"
                                              : ti.importance === "medium"
                                              ? "bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30 text-amber-700 dark:text-amber-300"
                                              : "bg-neutral-50 dark:bg-neutral-800 border-neutral-100 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300"
                                          }`}>
                                            <div className="flex items-center gap-1.5 mb-0.5">
                                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                                ti.importance === "high" ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" :
                                                ti.importance === "medium" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" :
                                                "bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400"
                                              }`}>{ti.importance}</span>
                                              <span className="font-semibold">{ti.title}</span>
                                            </div>
                                            <p className="text-[11px] opacity-80">{ti.detail}</p>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Key Columns with Roles (enhanced shows role badges) */}
                                  {insight.keyColumns?.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                        <Columns className="w-3 h-3" /> Key Columns
                                      </p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {insight.keyColumns.map((kc: any, i: number) => (
                                          <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700" title={kc.description}>
                                            <code className="font-mono text-[10px]">{kc.name}</code>
                                            {isEnhanced && kc.role && (
                                              <span className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded ml-0.5 ${
                                                kc.role === "identifier" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" :
                                                kc.role === "measure" ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400" :
                                                kc.role === "dimension" ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" :
                                                kc.role === "timestamp" ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400" :
                                                "bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400"
                                              }`}>{kc.role}</span>
                                            )}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Analysis Slices (enhanced only) */}
                                  {isEnhanced && report.analysisResults?.length > 0 && (
                                    <AnalysisSlicesPanel sliceResults={report.analysisResults} />
                                  )}

                                  {/* Quality Notes */}
                                  {insight.qualityNotes?.length > 0 && insight.qualityNotes[0] !== "No major issues detected" && (
                                    <div>
                                      <p className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                        <Info className="w-3 h-3" /> Data Quality
                                      </p>
                                      <ul className="space-y-1">
                                        {insight.qualityNotes.map((note: string, i: number) => (
                                          <li key={i} className="text-xs text-neutral-500 dark:text-neutral-400 flex items-start gap-1.5">
                                            <span className="w-1 h-1 rounded-full bg-neutral-400 dark:bg-neutral-500 mt-1.5 shrink-0" />
                                            {note}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {/* Quality Issues with Severity (enhanced only) */}
                                  {isEnhanced && report.quality?.issues?.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold text-amber-500 dark:text-amber-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3" /> Quality Issues
                                      </p>
                                      <ul className="space-y-1">
                                        {report.quality.issues.map((issue: any, i: number) => (
                                          <li key={i} className={`text-xs rounded-lg px-2.5 py-1.5 border flex items-start gap-1.5 ${
                                            issue.severity === "high"
                                              ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30"
                                              : issue.severity === "medium"
                                              ? "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30"
                                              : "text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-800 border-neutral-100 dark:border-neutral-700"
                                          }`}>
                                            <span className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded shrink-0 mt-0.5 ${
                                              issue.severity === "high" ? "bg-red-200 dark:bg-red-800/40 text-red-700 dark:text-red-300" :
                                              issue.severity === "medium" ? "bg-amber-200 dark:bg-amber-800/40 text-amber-700 dark:text-amber-300" :
                                              "bg-neutral-200 dark:bg-neutral-700 text-neutral-500"
                                            }`}>{issue.severity}</span>
                                            {issue.column && <code className="font-mono text-[10px] font-bold shrink-0">[{issue.column}]</code>}
                                            {issue.description}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {/* Potential Issues (legacy) */}
                                  {!isEnhanced && insight.potentialIssues?.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold text-amber-500 dark:text-amber-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3" /> Watch Out
                                      </p>
                                      <ul className="space-y-1">
                                        {insight.potentialIssues.map((issue: string, i: number) => (
                                          <li key={i} className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 rounded-lg px-2.5 py-1.5">
                                            {issue}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {/* Suggested Actions */}
                                  {insight.suggestedActions?.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                        <Lightbulb className="w-3 h-3" /> Suggestions
                                      </p>
                                      <ul className="space-y-1">
                                        {insight.suggestedActions.map((action: string, i: number) => (
                                          <li key={i} className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-lg px-2.5 py-1.5">
                                            {action}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </motion.div>
                              ) : null}
                            </div>
                            );
                          })()}

                          {/* Retry button if no insight and not loading */}
                          {!hasInsight && !groupInsightsLoading && onRetryInsights && appendGroups.length > 0 && (
                            <div className="flex-1 min-w-0 md:pl-5 mt-4 md:mt-0 flex items-center justify-center">
                              <button
                                type="button"
                                onClick={onRetryInsights}
                                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl hover:border-red-300 dark:hover:border-red-800 hover:text-red-600 dark:hover:text-red-400 transition-all"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Generate Insights
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}

                  {/* Create New Group card */}
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedTables.length > 0) handleCreateGroup();
                    }}
                    className={`w-full border-2 border-dashed rounded-2xl p-5 flex flex-col items-center justify-center gap-3 transition-all min-h-[120px] ${
                      selectedTables.length > 0
                        ? "border-red-300 bg-red-50/30 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                        : "border-neutral-200 dark:border-neutral-700 bg-neutral-50/20 dark:bg-neutral-800/30 text-neutral-400 dark:text-neutral-500 cursor-default"
                    }`}
                  >
                    <Plus className="w-8 h-8" />
                    <span className="text-sm font-bold">
                      {selectedTables.length > 0
                        ? `Create Group (${selectedTables.length} selected)`
                        : "Select tables to create a group"}
                    </span>
                    <span className="text-[10px]">Click table tags to select, then click here</span>
                  </button>

                  {/* Cross-Group Overview (enhanced insights) */}
                  {crossGroupOverview && crossGroupOverview.totalGroups >= 2 && (
                    <CrossGroupOverviewCard overview={crossGroupOverview} />
                  )}
                </div>

                {/* Unassigned */}
                {unassigned.length > 0 && (
                  <div className="border border-dashed border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 bg-neutral-50/30 dark:bg-neutral-800/30">
                    <h3 className="text-sm font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <Info className="w-4 h-4" />
                      Unassigned Tables
                      <span className="ml-auto text-[10px] bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 px-2 py-0.5 rounded-full">{unassigned.length}</span>
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      {unassigned.map((u: any) => (
                        <span
                          key={u.table_key}
                          onClick={() => toggleTableSelection(u.table_key)}
                          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border cursor-pointer transition-all ${
                            selectedTables.includes(u.table_key)
                              ? "bg-red-600 border-red-600 text-white shadow-lg shadow-red-200"
                              : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-red-400 hover:shadow-md"
                          }`}
                        >
                          {u.table_key}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); if (window.confirm(`Exclude "${u.table_key}" from processing?`)) excludeTable(u.table_key); }}
                            className="p-0.5 rounded hover:bg-red-100 text-neutral-400 hover:text-red-600 transition-colors shrink-0"
                            title="Exclude from processing"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          <TableActionMenu
                            tableKey={u.table_key}
                            currentGroupId={null}
                            appendGroups={appendGroups}
                            moveTableToGroup={moveTableToGroup}
                            excludeTable={excludeTable}
                          />
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Excluded */}
                {excludedTables.length > 0 && (
                  <div className="border border-dashed border-red-200 rounded-2xl bg-red-50/20 dark:bg-red-950/30 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowExcluded(!showExcluded)}
                      className="w-full flex items-center justify-between px-6 py-4 text-left"
                    >
                      <h3 className="text-sm font-bold text-red-400 uppercase tracking-widest flex items-center gap-2">
                        <Ban className="w-4 h-4" />
                        Excluded Tables
                        <span className="ml-2 text-[10px] bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">{excludedTables.length}</span>
                      </h3>
                      {showExcluded ? <ChevronDown className="w-4 h-4 text-red-400" /> : <ChevronRight className="w-4 h-4 text-red-400" />}
                    </button>
                    {showExcluded && (
                      <div className="px-6 pb-4 flex flex-wrap gap-3">
                        {excludedTables.map((t) => (
                          <span key={t} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-white dark:bg-neutral-900 border border-red-200 text-neutral-500 dark:text-neutral-400">
                            <span className="line-through">{t}</span>
                            <button
                              onClick={() => restoreTable(t)}
                              className="text-red-500 hover:text-red-700 transition-colors font-bold"
                              title="Restore to unassigned"
                            >
                              <Undo2 className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {appendGroupMappings.length > 0 && (
              <div className="space-y-10 border-t border-neutral-100 pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ListChecks className="w-5 h-5 text-red-600" />
                    <h3 className="text-lg font-semibold text-neutral-900">Header Alignment</h3>
                  </div>
                  <p className="text-sm text-neutral-500">AI-aligned column mappings (editable)</p>
                </div>
                {appendGroupMappings.map((gm, gmIdx) => {
                  const sourceColumnsMap: Record<string, string[]> = {};
                  for (const pt of gm.per_table || []) {
                    const preview = previews[pt.table_key];
                    sourceColumnsMap[pt.table_key] = preview?.columns || Object.keys(pt.column_mapping || {}).map(k => pt.column_mapping[k]).filter(Boolean);
                  }

                  const updateMapping = (tableKey: string, canonicalCol: string, newSourceCol: string | null) => {
                    const updated = appendGroupMappings.map((g, idx) => {
                      if (idx !== gmIdx) return g;
                      return {
                        ...g,
                        per_table: g.per_table.map((pt: any) => {
                          if (pt.table_key !== tableKey) return pt;
                          const newMapping = { ...pt.column_mapping };
                          if (newSourceCol) {
                            newMapping[canonicalCol] = newSourceCol;
                          } else {
                            delete newMapping[canonicalCol];
                          }
                          return { ...pt, column_mapping: newMapping };
                        })
                      };
                    });
                    setAppendGroupMappings(updated);
                  };

                  return (
                    <div key={gmIdx} className="space-y-4">
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-neutral-900">{gm.group_id}</h3>
                        <p className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest">Schema Mapping (editable)</p>
                      </div>
                        <div className="overflow-x-auto border border-neutral-100 dark:border-neutral-800 rounded-2xl shadow-sm">
                          <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700 text-sm">
                            <thead className="bg-neutral-50 dark:bg-neutral-800">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">Canonical Column</th>
                              {gm.per_table?.map((pt: any) => (
                                <th key={pt.table_key} className="px-6 py-3 text-left text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider border-l border-neutral-100 dark:border-neutral-800">
                                  {pt.table_key}
                                </th>
                              ))}
                            </tr>
                          </thead>
                            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800 bg-white dark:bg-neutral-900">
                            {gm.canonical_schema?.map((col: string) => (
                              <tr key={col} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50 transition-colors">
                                <td className="px-6 py-3 font-bold text-neutral-900 dark:text-white">{col}</td>
                                {gm.per_table?.map((pt: any) => {
                                  const sourceCols = sourceColumnsMap[pt.table_key] || [];
                                  const currentValue = pt.column_mapping?.[col] || "";
                                  return (
                                    <td key={pt.table_key} className="px-4 py-2 border-l border-neutral-100 dark:border-neutral-800">
                                      <select
                                        value={currentValue}
                                        onChange={(e) => updateMapping(pt.table_key, col, e.target.value || null)}
                                        className="w-full text-xs border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-1.5 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-shadow appearance-none"
                                      >
                                        <option value="">-- unmapped --</option>
                                        {sourceCols.map((sc) => (
                                          <option key={sc} value={sc}>{sc}</option>
                                        ))}
                                      </select>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="relative z-10 p-6 bg-neutral-50 dark:bg-neutral-800 border-t border-neutral-100 dark:border-neutral-800 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
            <div className="flex flex-col gap-1">
              {appendGroupMappings.length === 0 ? (
                <>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 italic">
                    Click table tags to select, use X or &quot;...&quot; to exclude, then proceed.
                  </p>
                  {appendGroups.length === 0 && (unassigned.length > 0 || excludedTables.length > 0) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                      No groups yet — create groups from the table tags above, or proceed to stack unassigned tables only.
                    </p>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleGenerateAppendMapping}
                  disabled={loading}
                  className="text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 transition-colors text-left disabled:opacity-50"
                >
                  Re-analyze Mappings
                </button>
              )}
            </div>
            {appendGroupMappings.length === 0 ? (
              <PrimaryButton onClick={handleGenerateAppendMapping} disabled={loading}>
                {loading ? <Loader2 className="animate-spin w-4 h-4" /> : "Analyze Header Mappings"}
                <ArrowRight className="w-4 h-4" />
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={handleExecuteAppend} disabled={loading}>
                {loading ? <Loader2 className="animate-spin w-4 h-4" /> : "Execute Append & Stack"}
                <ArrowRight className="w-4 h-4" />
              </PrimaryButton>
            )}
          </div>
        </motion.section>
      )}

      {step === 3 && appendReport && appendReport.length > 0 && (
        <AppendReport appendReport={appendReport} onProceed={handleProceedToMerge} />
      )}
    </div>
  );
}
