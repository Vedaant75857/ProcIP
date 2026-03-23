import React, { useState, useMemo } from "react";
import {
  Search, X, PlayCircle, ArrowRight, BarChart3,
  ShieldCheck, Lightbulb, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, Info, Loader2, Calendar,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { PrimaryButton, SecondaryButton, SkeletonBlock, FillBar } from "./ui";

interface AnalysisProps {
  mergeResult: any;
  analysisResults: any | null;
  analysisLoading: boolean;
  analysisSelectedColumns: string[];
  setAnalysisSelectedColumns: (cols: string[]) => void;
  handleRunAnalysis: (cols?: string[]) => void;
  onProceedToProcurement: () => void;
  dateDetectResult?: any;
  dateDetectLoading?: boolean;
  dateAnalyzeResult?: any;
  dateAnalyzeLoading?: boolean;
  dateStandardizeResult?: any;
  dateStandardizeLoading?: boolean;
  dateSelectedColumns?: string[];
  setDateSelectedColumns?: (cols: string[]) => void;
  handleDateDetect?: () => void;
  handleDateAnalyze?: (cols?: string[]) => void;
  handleDateStandardize?: (cols?: string[]) => void;
}

/* ─── Module Registry ─── */
interface AnalysisModule {
  id: string;
  name: string;
  icon: React.ElementType;
  color: string;
  resultKey: string;
  renderResults: (data: any) => React.ReactNode;
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800";
  if (score >= 60) return "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800";
  return "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const pct = Math.min(100, Math.max(0, score));
  const barColor = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
          <span className={`font-semibold ${scoreColor(pct)}`}>{pct}</span>
        </div>
        <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

function IssueTag({ text }: { key?: React.Key; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-900">
      <AlertTriangle className="w-3 h-3" />
      {text}
    </span>
  );
}

/* ─── Data Quality Results ─── */
function DataQualityResults({ data }: { data: any }) {
  const [expandedCol, setExpandedCol] = useState<string | null>(null);
  if (!data?.columns?.length) return <p className="text-sm text-neutral-500">No results available.</p>;

  return (
    <div className="space-y-4">
      {data.columns.map((col: any) => {
        const isExpanded = expandedCol === col.column;
        return (
          <div key={col.column} className={`rounded-xl border ${scoreBg(col.overall_score)} p-4`}>
            <button className="w-full flex items-center justify-between" onClick={() => setExpandedCol(isExpanded ? null : col.column)}>
              <div className="flex items-center gap-3">
                <div className={`text-2xl font-bold tabular-nums ${scoreColor(col.overall_score)}`}>{col.overall_score}</div>
                <div className="text-left">
                  <p className="font-medium text-sm text-neutral-900 dark:text-neutral-100">{col.column}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{col.inferred_description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">{col.inferred_type}</span>
                {isExpanded ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}
              </div>
            </button>

            <AnimatePresence>
              {isExpanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-4 space-y-3">
                    {col.buckets?.map((b: any) => (
                      <div key={b.range} className="bg-white/60 dark:bg-neutral-800/60 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Bucket: {b.range} chars</span>
                          <span className="text-xs text-neutral-500">{b.count.toLocaleString()} values ({b.percentage}%)</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <ScoreGauge score={b.quality?.clarity ?? 0} label="Clarity" />
                          <ScoreGauge score={b.quality?.consistency ?? 0} label="Consistency" />
                          <ScoreGauge score={b.quality?.completeness ?? 0} label="Completeness" />
                        </div>
                        {b.quality?.issues?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {b.quality.issues.map((issue: string, i: number) => <IssueTag key={i} text={issue} />)}
                          </div>
                        )}
                      </div>
                    ))}

                    {col.key_issues?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">Key Issues</p>
                        <div className="flex flex-wrap gap-1">
                          {col.key_issues.map((issue: string, i: number) => <IssueTag key={i} text={issue} />)}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Consistency Results ─── */
function ConsistencyResults({ data }: { data: any }) {
  if (!data?.columns?.length) return <p className="text-sm text-neutral-500">No results available.</p>;

  return (
    <div className="space-y-4">
      {data.columns.map((col: any) => (
        <div key={col.column} className={`rounded-xl border ${scoreBg(col.consistency_score)} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className={`text-2xl font-bold tabular-nums ${scoreColor(col.consistency_score)}`}>{col.consistency_score}</div>
              <p className="font-medium text-sm text-neutral-900 dark:text-neutral-100">{col.column}</p>
            </div>
          </div>

          {col.detected_patterns?.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">Detected Patterns</p>
              <div className="flex flex-wrap gap-1">
                {col.detected_patterns.map((p: string, i: number) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-900">{p}</span>
                ))}
              </div>
            </div>
          )}

          {col.violations?.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">Violations</p>
              <div className="space-y-1">
                {col.violations.map((v: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className={`w-3 h-3 mt-0.5 shrink-0 ${v.severity === "high" ? "text-red-500" : v.severity === "medium" ? "text-amber-500" : "text-neutral-400"}`} />
                    <span className="text-neutral-700 dark:text-neutral-300">{v.description} <span className="text-neutral-400">({v.estimated_pct}%)</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {col.mixed_types?.detected && (
            <div className="mb-3 flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-950/20 rounded-lg p-2 border border-amber-100 dark:border-amber-900">
              <Info className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
              <span className="text-amber-800 dark:text-amber-200">{col.mixed_types.details}</span>
            </div>
          )}

          {col.recommendations?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">Recommendations</p>
              <ul className="space-y-1">
                {col.recommendations.map((r: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-neutral-700 dark:text-neutral-300">
                    <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}

      {data.cross_column_issues?.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-2">Cross-Column Issues</p>
          {data.cross_column_issues.map((cci: any, i: number) => (
            <div key={i} className="flex items-start gap-2 text-xs mb-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
              <span className="text-amber-800 dark:text-amber-200"><strong>{cci.columns?.join(", ")}:</strong> {cci.issue}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Usability Results ─── */
function UsabilityResults({ data }: { data: any }) {
  if (!data?.columns?.length) return <p className="text-sm text-neutral-500">No results available.</p>;

  return (
    <div className="space-y-4">
      {data.overall_assessment && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4">
          <p className="text-sm text-blue-800 dark:text-blue-200">{data.overall_assessment}</p>
        </div>
      )}

      {data.columns.map((col: any) => (
        <div key={col.column} className={`rounded-xl border ${scoreBg(col.usability_rating)} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className={`text-2xl font-bold tabular-nums ${scoreColor(col.usability_rating)}`}>{col.usability_rating}</div>
              <div>
                <p className="font-medium text-sm text-neutral-900 dark:text-neutral-100">{col.column}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{col.characterization}</p>
              </div>
            </div>
          </div>

          {col.enabled_analyses?.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">Enabled Analyses</p>
              <div className="flex flex-wrap gap-1">
                {col.enabled_analyses.map((a: string, i: number) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900">{a}</span>
                ))}
              </div>
            </div>
          )}

          {col.potential_problems?.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">Potential Problems</p>
              <div className="space-y-1">
                {col.potential_problems.map((p: string, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
                    <span className="text-neutral-700 dark:text-neutral-300">{p}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {col.remediation?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">Remediation</p>
              <ul className="space-y-1">
                {col.remediation.map((r: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-neutral-700 dark:text-neutral-300">
                    <Lightbulb className="w-3 h-3 mt-0.5 shrink-0 text-blue-500" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Module Registry (extensible) ─── */
const ANALYSIS_MODULES: AnalysisModule[] = [
  {
    id: "dataQuality",
    name: "Data Quality",
    icon: BarChart3,
    color: "red",
    resultKey: "dataQuality",
    renderResults: (data: any) => <DataQualityResults data={data} />,
  },
  {
    id: "consistency",
    name: "Consistency Check",
    icon: ShieldCheck,
    color: "blue",
    resultKey: "consistency",
    renderResults: (data: any) => <ConsistencyResults data={data} />,
  },
  {
    id: "usability",
    name: "Data Usability",
    icon: Lightbulb,
    color: "emerald",
    resultKey: "usability",
    renderResults: (data: any) => <UsabilityResults data={data} />,
  },
];

/* ─── Main Component ─── */
export default function Analysis({
  mergeResult,
  analysisResults,
  analysisLoading,
  analysisSelectedColumns,
  setAnalysisSelectedColumns,
  handleRunAnalysis,
  onProceedToProcurement,
  dateDetectResult,
  dateDetectLoading,
  dateAnalyzeResult,
  dateAnalyzeLoading,
  dateStandardizeResult,
  dateStandardizeLoading,
  dateSelectedColumns = [],
  setDateSelectedColumns,
  handleDateDetect,
  handleDateAnalyze,
  handleDateStandardize,
}: AnalysisProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set(ANALYSIS_MODULES.map(m => m.id)));

  const availableColumns = useMemo(() => {
    if (!mergeResult?.preview?.length) return [];
    const first = mergeResult.preview[0];
    return Object.keys(first || {});
  }, [mergeResult]);

  const filteredColumns = useMemo(() => {
    if (!searchTerm.trim()) return availableColumns;
    const lower = searchTerm.toLowerCase();
    return availableColumns.filter((c: string) => c.toLowerCase().includes(lower));
  }, [availableColumns, searchTerm]);

  const toggleColumn = (col: string) => {
    if (analysisSelectedColumns.includes(col)) {
      setAnalysisSelectedColumns(analysisSelectedColumns.filter(c => c !== col));
    } else if (analysisSelectedColumns.length < 3) {
      setAnalysisSelectedColumns([...analysisSelectedColumns, col]);
    }
  };

  const toggleModule = (id: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden"
    >
      <div className="p-6 border-b border-neutral-100 dark:border-neutral-800">
        <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Data Analysis</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          Select up to 3 columns and run AI-powered analysis — all 3 agents execute in parallel for maximum speed.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* Column Selector */}
        <div>
          <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2 block">
            Select Columns (max 3)
          </label>

          {analysisSelectedColumns.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {analysisSelectedColumns.map(col => (
                <span key={col} className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                  {col}
                  <button onClick={() => toggleColumn(col)} className="hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search columns..."
              className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-red-500/30 focus:border-red-400 outline-none"
            />
          </div>

          <div className="max-h-48 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800">
            {filteredColumns.length === 0 ? (
              <p className="p-4 text-sm text-neutral-500 text-center">No columns found</p>
            ) : (
              filteredColumns.map((col: string) => {
                const isSelected = analysisSelectedColumns.includes(col);
                const isDisabled = !isSelected && analysisSelectedColumns.length >= 3;
                return (
                  <button
                    key={col}
                    onClick={() => !isDisabled && toggleColumn(col)}
                    disabled={isDisabled}
                    className={`w-full text-left px-4 py-2 text-sm border-b border-neutral-100 dark:border-neutral-700 last:border-0 transition-colors
                      ${isSelected ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 font-medium" : "hover:bg-neutral-100 dark:hover:bg-neutral-700/50 text-neutral-700 dark:text-neutral-300"}
                      ${isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                        ${isSelected ? "border-red-500 bg-red-500" : "border-neutral-300 dark:border-neutral-600"}`}>
                        {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                      </div>
                      {col}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Run Button */}
        <div className="flex items-center gap-3">
          <PrimaryButton
            onClick={() => handleRunAnalysis(analysisSelectedColumns)}
            disabled={analysisSelectedColumns.length === 0 || analysisLoading}
          >
            {analysisLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4" />
                Run Analysis ({analysisSelectedColumns.length} column{analysisSelectedColumns.length !== 1 ? "s" : ""})
              </>
            )}
          </PrimaryButton>

          {analysisResults && !analysisLoading && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Analysis complete
            </span>
          )}
        </div>

        {/* Loading Skeletons */}
        {analysisLoading && (
          <div className="grid gap-4 md:grid-cols-3">
            {ANALYSIS_MODULES.map(m => (
              <div key={m.id} className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <m.icon className="w-4 h-4 text-neutral-400" />
                  <span className="text-sm font-medium text-neutral-500">{m.name}</span>
                </div>
                <SkeletonBlock className="h-4 w-3/4 mb-2" />
                <SkeletonBlock className="h-4 w-1/2 mb-2" />
                <SkeletonBlock className="h-20 w-full" />
              </div>
            ))}
          </div>
        )}

        {/* Results */}
        {analysisResults && !analysisLoading && (
          <div className="space-y-4">
            {ANALYSIS_MODULES.map(mod => {
              const data = analysisResults[mod.resultKey];
              const isExpanded = expandedModules.has(mod.id);
              return (
                <div key={mod.id} className="rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-800/50 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    onClick={() => toggleModule(mod.id)}
                  >
                    <div className="flex items-center gap-3">
                      <mod.icon className={`w-5 h-5 text-${mod.color}-500`} />
                      <span className="font-medium text-sm text-neutral-900 dark:text-neutral-100">{mod.name}</span>
                    </div>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}
                  </button>
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 border-t border-neutral-100 dark:border-neutral-800">
                          {mod.renderResults(data)}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}

        {/* ─── Date Standardization ─── */}
        <div className="pt-6 border-t border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/40">
              <Calendar className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Date Standardization</h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Detect, analyze, and standardize date columns to DD/MM/YYYY format.</p>
            </div>
          </div>

          {/* Step 1: Detect */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <PrimaryButton onClick={handleDateDetect} disabled={dateDetectLoading}>
                {dateDetectLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Detecting...</>
                ) : (
                  <><Calendar className="w-4 h-4" />Detect Date Columns</>
                )}
              </PrimaryButton>
              {dateDetectResult && !dateDetectLoading && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {dateDetectResult.dateColumns?.length ?? 0} column(s) detected
                </span>
              )}
            </div>

            {dateDetectLoading && (
              <div className="space-y-2">
                <SkeletonBlock className="h-12 w-full" />
                <SkeletonBlock className="h-12 w-3/4" />
              </div>
            )}

            {/* Detection results + column selection */}
            {dateDetectResult?.dateColumns?.length > 0 && !dateDetectLoading && (
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                <div className="bg-neutral-50 dark:bg-neutral-800/50 px-4 py-3 text-xs font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider">
                  Select columns to standardize
                </div>
                <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {dateDetectResult.dateColumns.map((dc: any) => {
                    const isSelected = dateSelectedColumns.includes(dc.column);
                    return (
                      <button
                        key={dc.column}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          isSelected ? "bg-amber-50 dark:bg-amber-950/20" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                        }`}
                        onClick={() => {
                          if (!setDateSelectedColumns) return;
                          if (isSelected) setDateSelectedColumns(dateSelectedColumns.filter(c => c !== dc.column));
                          else setDateSelectedColumns([...dateSelectedColumns, dc.column]);
                        }}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          isSelected ? "border-amber-500 bg-amber-500" : "border-neutral-300 dark:border-neutral-600"
                        }`}>
                          {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{dc.column}</p>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{dc.reasoning}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-xs font-bold tabular-nums ${
                            dc.confidence >= 80 ? "text-emerald-600" : dc.confidence >= 60 ? "text-amber-600" : "text-red-500"
                          }`}>
                            {dc.confidence}%
                          </span>
                          <div className="flex gap-1">
                            {dc.sample_formats_seen?.slice(0, 2).map((f: string) => (
                              <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500">{f}</span>
                            ))}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Analyze */}
            {dateSelectedColumns.length > 0 && dateDetectResult && (
              <div className="flex items-center gap-3">
                <SecondaryButton onClick={() => handleDateAnalyze?.(dateSelectedColumns)} disabled={dateAnalyzeLoading}>
                  {dateAnalyzeLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Analyzing...</>
                  ) : (
                    <><Search className="w-4 h-4" />Analyze Formats ({dateSelectedColumns.length})</>
                  )}
                </SecondaryButton>
                {dateAnalyzeResult && !dateAnalyzeLoading && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Format analysis complete
                  </span>
                )}
              </div>
            )}

            {dateAnalyzeLoading && (
              <div className="space-y-2">
                <SkeletonBlock className="h-20 w-full" />
                <SkeletonBlock className="h-20 w-full" />
              </div>
            )}

            {/* Analysis results: per-source breakdown */}
            {dateAnalyzeResult?.columns?.length > 0 && !dateAnalyzeLoading && (
              <div className="space-y-4">
                {dateAnalyzeResult.columns.map((ac: any) => (
                  <div key={ac.column} className="rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                    <div className="bg-neutral-50 dark:bg-neutral-800/50 px-4 py-3 flex items-center justify-between">
                      <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{ac.column}</span>
                      <div className="flex gap-2 text-xs text-neutral-500">
                        <span>{ac.totalValues?.toLocaleString()} values</span>
                        {ac.ambiguousCount > 0 && (
                          <span className="text-amber-600">
                            <AlertTriangle className="w-3 h-3 inline mr-0.5" />
                            {ac.ambiguousCount} ambiguous
                          </span>
                        )}
                        {ac.unrecognizedCount > 0 && (
                          <span className="text-red-500">{ac.unrecognizedCount} unrecognized</span>
                        )}
                      </div>
                    </div>

                    {/* Format breakdown bar */}
                    {ac.formatBreakdown?.length > 0 && (
                      <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
                        <p className="text-xs font-medium text-neutral-500 mb-2">Format Distribution</p>
                        <div className="flex h-5 rounded-lg overflow-hidden">
                          {ac.formatBreakdown.map((fb: any, i: number) => {
                            const colors = ["bg-blue-500", "bg-amber-500", "bg-emerald-500", "bg-red-400", "bg-purple-500"];
                            return (
                              <div
                                key={fb.format}
                                className={`${colors[i % colors.length]} flex items-center justify-center`}
                                style={{ width: `${Math.max(fb.percentage, 3)}%` }}
                                title={`${fb.format}: ${fb.percentage}%`}
                              >
                                {fb.percentage >= 15 && (
                                  <span className="text-[9px] text-white font-bold truncate px-1">{fb.format} {fb.percentage}%</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {ac.formatBreakdown.map((fb: any, i: number) => {
                            const dots = ["bg-blue-500", "bg-amber-500", "bg-emerald-500", "bg-red-400", "bg-purple-500"];
                            return (
                              <span key={fb.format} className="flex items-center gap-1 text-[10px] text-neutral-600 dark:text-neutral-400">
                                <span className={`w-2 h-2 rounded-full ${dots[i % dots.length]}`} />
                                {fb.format} ({fb.percentage}%)
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Per-source breakdown */}
                    {ac.sourceBreakdown?.length > 0 && (
                      <div className="px-4 py-3">
                        <p className="text-xs font-medium text-neutral-500 mb-2">Per-Source File Resolution</p>
                        <div className="space-y-1.5">
                          {ac.sourceBreakdown.map((sb: any) => (
                            <div key={sb.source} className="flex items-center gap-2 text-xs">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${
                                sb.confidence === "high" ? "bg-emerald-500" : sb.confidence === "medium" ? "bg-amber-500" : "bg-red-400"
                              }`} />
                              <span className="text-neutral-700 dark:text-neutral-300 truncate flex-1 min-w-0" title={sb.source}>{sb.source}</span>
                              <span className="font-mono font-bold text-neutral-900 dark:text-neutral-100 shrink-0">{sb.resolvedFormat}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                                sb.confidence === "high" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" :
                                sb.confidence === "medium" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" :
                                "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                              }`}>{sb.confidence}</span>
                              <span className="text-neutral-400 shrink-0">{sb.rowCount?.toLocaleString()} rows</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Step 3: Standardize */}
            {dateAnalyzeResult && !dateAnalyzeLoading && (
              <div className="flex items-center gap-3">
                <PrimaryButton onClick={() => handleDateStandardize?.(dateSelectedColumns)} disabled={dateStandardizeLoading}>
                  {dateStandardizeLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Standardizing...</>
                  ) : (
                    <><PlayCircle className="w-4 h-4" />Standardize to DD/MM/YYYY</>
                  )}
                </PrimaryButton>
              </div>
            )}

            {dateStandardizeLoading && (
              <div className="space-y-2">
                <SkeletonBlock className="h-16 w-full" />
                <SkeletonBlock className="h-32 w-full" />
              </div>
            )}

            {/* Standardization results + verification */}
            {dateStandardizeResult?.columns?.length > 0 && !dateStandardizeLoading && (
              <div className="space-y-4">
                {dateStandardizeResult.columns.map((sc: any) => (
                  <div key={sc.column} className="rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                    <div className="bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">{sc.column}</span>
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">→ {sc.cleanColumn}</span>
                      </div>
                      <div className={`text-lg font-bold tabular-nums ${
                        sc.confidenceScore >= 90 ? "text-emerald-600" : sc.confidenceScore >= 70 ? "text-amber-600" : "text-red-500"
                      }`}>
                        {sc.confidenceScore}%
                      </div>
                    </div>

                    <div className="p-4 space-y-4">
                      {/* Summary stats */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800 p-3 text-center">
                          <p className="text-lg font-bold text-neutral-900 dark:text-neutral-100 tabular-nums">{sc.totalRows?.toLocaleString()}</p>
                          <p className="text-[10px] text-neutral-500 uppercase tracking-wider">Total Rows</p>
                        </div>
                        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-3 text-center">
                          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{sc.converted?.toLocaleString()}</p>
                          <p className="text-[10px] text-emerald-600 uppercase tracking-wider">Converted</p>
                        </div>
                        <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-3 text-center">
                          <p className="text-lg font-bold text-red-600 dark:text-red-400 tabular-nums">{sc.failed?.toLocaleString()}</p>
                          <p className="text-[10px] text-red-500 uppercase tracking-wider">Failed</p>
                        </div>
                      </div>

                      <FillBar rate={sc.confidenceScore / 100} />

                      {/* Per-source stats */}
                      {sc.perSourceStats?.length > 1 && (
                        <div>
                          <p className="text-xs font-medium text-neutral-500 mb-2">Per-Source Success</p>
                          <div className="space-y-1">
                            {sc.perSourceStats.map((ps: any) => (
                              <div key={ps.source} className="flex items-center gap-2 text-xs">
                                <span className="truncate flex-1 text-neutral-700 dark:text-neutral-300" title={ps.source}>{ps.source}</span>
                                <span className="tabular-nums text-emerald-600 font-medium">{ps.converted}</span>
                                <span className="text-neutral-400">/</span>
                                <span className="tabular-nums text-neutral-500">{ps.rows}</span>
                                {ps.failed > 0 && <span className="text-red-500 tabular-nums">({ps.failed} failed)</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Verification samples */}
                      {sc.verificationSamples?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-neutral-500 mb-2">Verification Samples</p>
                          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-neutral-50 dark:bg-neutral-800">
                                  <th className="text-left px-3 py-2 font-medium text-neutral-500">Original</th>
                                  <th className="text-left px-3 py-2 font-medium text-neutral-500">Clean</th>
                                  {sc.verificationSamples[0]?.source && (
                                    <th className="text-left px-3 py-2 font-medium text-neutral-500">Source</th>
                                  )}
                                  <th className="text-left px-3 py-2 font-medium text-neutral-500">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                                {sc.verificationSamples.slice(0, 15).map((vs: any, i: number) => (
                                  <tr key={i}>
                                    <td className="px-3 py-1.5 font-mono text-neutral-700 dark:text-neutral-300">{vs.original}</td>
                                    <td className="px-3 py-1.5 font-mono text-neutral-900 dark:text-neutral-100 font-medium">{vs.clean || "—"}</td>
                                    {vs.source !== undefined && (
                                      <td className="px-3 py-1.5 text-neutral-500 truncate max-w-[120px]">{vs.source}</td>
                                    )}
                                    <td className="px-3 py-1.5">
                                      {vs.status === "ok" ? (
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                      ) : (
                                        <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Proceed Button */}
        <div className="pt-6 border-t border-neutral-100 dark:border-neutral-800">
          <div className="bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4 border border-red-100 dark:border-red-900">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-red-900 dark:text-red-200">Ready for Procurement Mapping</h3>
              <p className="text-sm text-red-700/80 dark:text-red-300/80 mt-1">Proceed to map your columns to standard procurement fields with AI assistance.</p>
            </div>
            <PrimaryButton onClick={onProceedToProcurement}>
              Proceed to Procurement
              <ArrowRight className="w-4 h-4" />
            </PrimaryButton>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
