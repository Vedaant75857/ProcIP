import React, { useState } from "react";
import {
  CheckCircle2, FileDown, ChevronRight, ChevronDown, Database, ArrowRight,
  Activity, AlertTriangle, Layers, Columns, BarChart3, Loader2
} from "lucide-react";
import { motion } from "motion/react";
import { PrimaryButton, ResultCapsules, Tooltip, FillBar } from "./ui";

interface MergeReportProps {
  mergeResult: any;
  downloadCsv: () => void;
  downloadReport: () => void;
  handleGenerateProcurementMapping: () => void;
  onProceedToAnalysis?: () => void;
  onSendToNormalization?: () => void;
  loading: boolean;
  onSelectChatItem?: (item: { type: string; id: string; label: string }) => void;
}

const DEFINITIONS: Record<string, string> = {
  match_rate:
    "Percentage of fact table rows where a matching key was found in the dimension table. Higher is better — low rates suggest the join key may not align well between tables.",
  row_explosion:
    "Ratio of output rows to input rows. A value > 1.0 means duplicate dimension keys caused row multiplication. Values near 1.0 are ideal.",
  unused_fact_keys:
    "Number of unique key values in the fact table that had no match in the dimension table. These rows received null values for all dimension columns.",
  unused_dim_keys:
    "Number of unique key values in the dimension table that were not referenced by any fact row. This data was available but not used.",
  fill_rate:
    "Percentage of non-null values in each column of the final merged dataset. Columns added from dimension tables may have lower fill rates when match rate is low.",
  distinct_count:
    "Number of unique non-null values in each column. Helps identify identifiers (high), categories (medium), or flags (low).",
  null_count:
    "Number of rows where this column is empty, null, or blank.",
  dup_dropped:
    "Number of duplicate rows removed from the dimension table before joining. Duplicates are based on the join key — only the first occurrence is kept.",
  columns_added:
    "Number of new columns brought into the fact table from this dimension. Excludes the join key column itself.",
  net_columns:
    "Total new columns added across all dimension joins compared to the original fact table.",
  avg_match_rate:
    "Arithmetic mean of match rates across all dimension joins. Gives an overall picture of join quality.",
};

function MatchRateBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const color =
    pct >= 70 ? "bg-emerald-500" : pct >= 30 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden max-w-[200px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm tabular-nums font-black text-neutral-900 dark:text-white">{pct}%</span>
    </div>
  );
}

function StatCard({ label, value, sub, tooltip }: { label: string; value: string | number; sub?: string; tooltip?: string }) {
  return (
    <div className="bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-5 text-center">
      <p className="text-[10px] font-black text-neutral-400 dark:text-neutral-500 uppercase tracking-widest mb-2 flex items-center justify-center gap-1">
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </p>
      <p className="text-3xl font-black text-red-600 dark:text-red-400 tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
      {sub && <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">{sub}</p>}
    </div>
  );
}

function DimensionCard({ m }: { key?: React.Key; m: any }) {
  const [expanded, setExpanded] = useState(false);
  const statusDotClass =
    m.status === "ok" ? "bg-emerald-500" : m.status === "warning" ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors text-left"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`w-2.5 h-2.5 rounded-full ${statusDotClass}`} />
          <span className="text-sm font-bold text-neutral-900 dark:text-white">{m.dimension_group}</span>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
            m.status === "ok" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400" :
            m.status === "warning" ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400" :
            "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"
          }`}>
            {m.status}
          </span>
          {m.match_rate != null && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Match: <span className="font-bold text-neutral-700 dark:text-neutral-300">{(m.match_rate * 100).toFixed(1)}%</span>
            </span>
          )}
          {m.added_cols != null && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">+{m.added_cols} cols</span>
          )}
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-neutral-400 dark:text-neutral-500" /> : <ChevronRight className="w-4 h-4 text-neutral-400 dark:text-neutral-500" />}
      </button>

      {expanded && (
        <div className="p-6 space-y-4">
          {/* Key mapping */}
          <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            <span className="font-mono font-bold text-neutral-800 dark:text-neutral-200">{m.fact_key}</span>
            <ArrowRight className="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
            <span className="font-mono font-bold text-neutral-800 dark:text-neutral-200">{m.dim_key}</span>
          </div>

          {m.reason && (
            <div className={`p-3 rounded-xl text-xs font-medium ${
              m.status === "warning" ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-100" : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-100"
            }`}>
              {m.reason}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {/* Match Rate */}
            {m.match_rate != null && (
              <div className="col-span-2 md:col-span-3 p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Match Rate</p>
                  <Tooltip text={DEFINITIONS.match_rate} />
                </div>
                <MatchRateBar rate={m.match_rate} />
              </div>
            )}

            {/* Row Explosion */}
            {m.row_multiplier != null && (
              <div className="p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Row Multiplier</p>
                  <Tooltip text={DEFINITIONS.row_explosion} />
                </div>
                <p className={`text-xl font-black tabular-nums ${m.row_multiplier > 1.02 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {m.row_multiplier.toFixed(4)}x
                </p>
              </div>
            )}

            {/* Unused Fact Keys */}
            {m.unused_fact_keys != null && (
              <div className="p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Unused Fact Keys</p>
                  <Tooltip text={DEFINITIONS.unused_fact_keys} />
                </div>
                <p className={`text-xl font-black tabular-nums ${m.unused_fact_keys > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {m.unused_fact_keys.toLocaleString()}
                </p>
              </div>
            )}

            {/* Unused Dim Keys */}
            {m.unused_dim_keys != null && (
              <div className="p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Unused Dim Keys</p>
                  <Tooltip text={DEFINITIONS.unused_dim_keys} />
                </div>
<p className="text-xl font-black tabular-nums text-neutral-700 dark:text-neutral-300">
                    {m.unused_dim_keys.toLocaleString()}
                </p>
              </div>
            )}

            {/* Dup Dropped */}
            {m.dup_dropped != null && (
              <div className="p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Dim Duplicates Dropped</p>
                  <Tooltip text={DEFINITIONS.dup_dropped} />
                </div>
<p className="text-xl font-black tabular-nums text-neutral-700 dark:text-neutral-300">
                    {m.dup_dropped.toLocaleString()}
                </p>
              </div>
            )}

            {/* Columns Added */}
            {m.added_cols != null && (
              <div className="p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Columns Added</p>
                  <Tooltip text={DEFINITIONS.columns_added} />
                </div>
<p className="text-xl font-black tabular-nums text-neutral-700 dark:text-neutral-300">
                    {m.added_cols}
                </p>
              </div>
            )}
          </div>

          {/* Shape info */}
          {m.shape_before && m.shape_after && (
            <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400 pt-2">
              <span>Shape: {m.shape_before?.[0]?.toLocaleString() ?? "—"} x {m.shape_before?.[1] ?? "—"}</span>
              <ArrowRight className="w-3 h-3" />
              <span className="font-bold text-neutral-700 dark:text-neutral-300">{m.shape_after?.[0]?.toLocaleString() ?? "—"} x {m.shape_after?.[1] ?? "—"}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FinalPreview({ preview }: { preview: any[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!preview || preview.length === 0) return null;
  const cols = Object.keys(preview[0]);
  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
          <span className="text-sm font-bold text-neutral-700 dark:text-neutral-300">Data Preview</span>
          <span className="text-[10px] font-bold bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 px-2 py-0.5 rounded-full">
            first {Math.min(preview.length, 20)} rows
          </span>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-neutral-400 dark:text-neutral-500" /> : <ChevronRight className="w-4 h-4 text-neutral-400 dark:text-neutral-500" />}
      </button>
      {expanded && (
        <div className="overflow-x-auto max-h-80">
          <table className="min-w-full text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-800 sticky top-0">
              <tr>
                {cols.map((c) => (
                  <th key={c} className="px-3 py-2 text-left font-bold text-neutral-500 dark:text-neutral-400 uppercase text-[10px] tracking-wider whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {preview.slice(0, 20).map((row: any, i: number) => (
                <tr key={i} className="hover:bg-neutral-50 dark:hover:bg-neutral-800">
                  {cols.map((c) => (
                    <td key={c} className="px-3 py-2 whitespace-nowrap max-w-[200px] truncate text-neutral-700 dark:text-neutral-300">{row[c] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ColumnStatsSection({ stats, onSelectChatItem }: { stats: any[]; onSelectChatItem?: (item: { type: string; id: string; label: string }) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  if (!stats || stats.length === 0) return null;

  const sources = [...new Set(stats.map((s: any) => s.source))];
  const display = showAll ? stats : stats.slice(0, 15);

  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
          <span className="text-sm font-bold text-neutral-700 dark:text-neutral-300">Final Column Statistics</span>
          <span className="text-[10px] font-bold bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 px-2 py-0.5 rounded-full">
            {stats.length} columns from {sources.length} source{sources.length !== 1 ? "s" : ""}
          </span>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-neutral-400 dark:text-neutral-500" /> : <ChevronRight className="w-4 h-4 text-neutral-400 dark:text-neutral-500" />}
      </button>
      {expanded && (
        <div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-neutral-50 dark:bg-neutral-800">
                <tr>
                  <th className="text-left px-4 py-2.5 font-bold text-neutral-500 dark:text-neutral-400 uppercase text-[10px] tracking-wider">Column</th>
                  <th className="text-left px-4 py-2.5 font-bold text-neutral-500 dark:text-neutral-400 uppercase text-[10px] tracking-wider">Source</th>
                  <th className="text-left px-4 py-2.5 font-bold text-neutral-500 dark:text-neutral-400 uppercase text-[10px] tracking-wider">
                    <span className="flex items-center gap-1">Fill Rate <Tooltip text={DEFINITIONS.fill_rate} /></span>
                  </th>
                  <th className="text-right px-4 py-2.5 font-bold text-neutral-500 dark:text-neutral-400 uppercase text-[10px] tracking-wider">
                    <span className="flex items-center justify-end gap-1">Nulls <Tooltip text={DEFINITIONS.null_count} /></span>
                  </th>
                  <th className="text-right px-4 py-2.5 font-bold text-neutral-500 dark:text-neutral-400 uppercase text-[10px] tracking-wider">
                    <span className="flex items-center justify-end gap-1">Distinct <Tooltip text={DEFINITIONS.distinct_count} /></span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {display.map((cs: any) => (
                  <tr key={cs.column_name} className="hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300 truncate max-w-[250px]" title={cs.column_name}>
                      {onSelectChatItem ? (
                        <button
                          type="button"
                          onClick={() => onSelectChatItem({ type: "column", id: cs.column_name, label: `Column: ${cs.column_name}` })}
                          className="text-left hover:text-red-600 transition-colors"
                        >
                          {cs.column_name}
                        </button>
                      ) : cs.column_name}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        cs.source === "fact"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-purple-50 text-purple-700"
                      }`}>
                        {cs.source === "fact" ? "FACT" : cs.source}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <FillBar rate={cs.fill_rate} />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                      {(cs.null_count ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-neutral-900 dark:text-white">
                      {(cs.distinct_count ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stats.length > 15 && (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="w-full px-4 py-2.5 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors border-t border-neutral-100 dark:border-neutral-800"
            >
              {showAll ? "Show fewer columns" : `Show all ${stats.length} columns`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function MergeReport({ mergeResult, downloadCsv, downloadReport, handleGenerateProcurementMapping, onProceedToAnalysis, onSendToNormalization, loading, onSelectChatItem }: MergeReportProps) {
  if (!mergeResult) {
    return (
      <div className="p-20 text-center">
        <CheckCircle2 className="w-16 h-16 text-neutral-100 dark:text-neutral-700 mx-auto mb-6" />
        <h2 className="text-2xl font-bold text-neutral-300 dark:text-neutral-600">Merge Not Yet Executed</h2>
        <p className="text-neutral-400 dark:text-neutral-500 mt-2">Complete the column selection and execute the merge to see results here.</p>
      </div>
    );
  }

  const report = mergeResult.report || {};
  const mergeExec = report.merge_exec || [];
  const finalShape = report.final_shape || {};
  const factRowsBefore = report.fact_rows_before_merge || finalShape.rows || 0;
  const columnStats = report.final_column_stats || [];

  const joinedDims = mergeExec.filter((m: any) => m.status === "ok" || m.status === "warning");
  const avgMatchRate = joinedDims.length > 0
    ? joinedDims.reduce((s: number, m: any) => s + (m.match_rate || 0), 0) / joinedDims.length
    : 0;
  const netCols = (finalShape.cols || 0) - (factRowsBefore > 0 ? (mergeExec[0]?.shape_before?.[1] || finalShape.cols) : finalShape.cols);
  const overallRowMult = factRowsBefore > 0 ? (finalShape.rows || 0) / factRowsBefore : 1;

  return (
    <>
      {/* Hero */}
      <div className="p-8 text-center bg-gradient-to-br from-red-600 to-rose-600 text-white rounded-t-3xl">
        <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md text-white flex items-center justify-center mx-auto mb-6 shadow-xl">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <h2 className="text-3xl font-bold tracking-tight mb-2">Stitching Complete!</h2>
        <p className="text-red-100 max-w-md mx-auto">Your datasets have been successfully unified into a high-performance flat file.</p>
        <div className="mt-4">
          <ResultCapsules items={[
            `${(finalShape.rows || 0).toLocaleString()} rows`,
            `${finalShape.cols || 0} columns`,
            `${joinedDims.length} joins`,
          ]} />
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* Overall Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Rows" value={finalShape.rows || 0} />
          <StatCard label="Total Columns" value={finalShape.cols || 0} />
          <StatCard
            label="Dimensions Joined"
            value={joinedDims.length}
            sub={`of ${mergeExec.length} attempted`}
          />
          <StatCard
            label="Avg Match Rate"
            value={`${(avgMatchRate * 100).toFixed(1)}%`}
            tooltip={DEFINITIONS.avg_match_rate}
          />
        </div>

        {/* Secondary stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard
            label="Net Columns Gained"
            value={netCols > 0 ? `+${netCols}` : String(netCols)}
            tooltip={DEFINITIONS.net_columns}
          />
          <StatCard
            label="Overall Row Multiplier"
            value={`${overallRowMult.toFixed(4)}x`}
            tooltip={DEFINITIONS.row_explosion}
          />
          <StatCard
            label="Original Fact Rows"
            value={factRowsBefore}
          />
        </div>

        {/* Download buttons */}
        <div className="flex flex-col sm:flex-row items-stretch gap-4">
          <motion.button
            whileHover={{ y: -1, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={downloadCsv}
            className="flex-1 inline-flex justify-center items-center px-6 py-4 border border-transparent text-sm font-bold rounded-2xl shadow-lg text-white bg-emerald-600 hover:bg-emerald-700 transition-all gap-2"
          >
            <FileDown className="w-5 h-5" />
            Download Final CSV
          </motion.button>
          <motion.button
            whileHover={{ y: -1, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={downloadReport}
            className="flex-1 inline-flex justify-center items-center px-6 py-4 border border-neutral-200 dark:border-neutral-700 text-sm font-bold rounded-2xl shadow-sm text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all gap-2"
          >
            <FileDown className="w-5 h-5 text-neutral-400 dark:text-neutral-500" />
            Download Audit Report
          </motion.button>
        </div>

        {/* Per-dimension join cards */}
        {mergeExec.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-red-600 dark:text-red-400" />
              <h3 className="text-lg font-bold text-neutral-900 dark:text-white">Dimension Join Details</h3>
              <span className="text-[10px] font-bold bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 px-2 py-0.5 rounded-full">
                {mergeExec.length} join{mergeExec.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="space-y-3">
              {mergeExec.map((m: any, i: number) => (
                <DimensionCard key={i} m={m} />
              ))}
            </div>
          </div>
        )}

        {/* Column Statistics */}
        <ColumnStatsSection stats={columnStats} onSelectChatItem={onSelectChatItem} />

        {/* Data Preview */}
        {mergeResult.preview && mergeResult.preview.length > 0 && (
          <FinalPreview preview={mergeResult.preview} />
        )}

        {/* Next steps CTAs */}
        <div className="pt-8 border-t border-neutral-100 dark:border-neutral-800 space-y-4">
          <div className="bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 border border-red-100">
            <div className="text-center md:text-left">
              <h3 className="text-lg font-semibold tracking-tight text-red-900 dark:text-red-200">Analyze Your Data</h3>
              <p className="text-sm text-red-700/80 dark:text-red-300/80 mt-1">Run AI-powered data quality, consistency, and usability analysis before proceeding to procurement mapping.</p>
            </div>
            <PrimaryButton onClick={onProceedToAnalysis ?? handleGenerateProcurementMapping} disabled={loading}>
              {loading ? <Loader2 className="animate-spin w-4 h-4" /> : "Proceed to Analysis"}
              <ArrowRight className="w-4 h-4" />
            </PrimaryButton>
          </div>
          {onSendToNormalization && (
            <div className="bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 border border-violet-100 dark:border-violet-900/50">
              <div className="text-center md:text-left">
                <h3 className="text-lg font-semibold tracking-tight text-violet-900 dark:text-violet-200">Normalize Data</h3>
                <p className="text-sm text-violet-700/80 dark:text-violet-300/80 mt-1">Send your merged dataset to the Normalization module for AI-powered supplier name cleanup, date standardization, FX conversion, and more.</p>
              </div>
              <button
                onClick={onSendToNormalization}
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold rounded-2xl shadow-md text-white bg-violet-600 hover:bg-violet-700 transition-all"
              >
                Send to Normalization <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
