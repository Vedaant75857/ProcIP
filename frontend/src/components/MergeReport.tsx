import React from "react";
import { motion } from "motion/react";
import { ArrowRight, CheckCircle2, Download, FileText, Loader2, Table2 } from "lucide-react";
import { SurfaceCard, PrimaryButton, SecondaryButton, FillBar, itemVariants } from "./ui";

interface MergeReportProps {
  mergeResult: any;
  mergeApprovedSources: any[];
  groupNameMap: Record<string, string>;
  onDownloadCsv: () => void;
  onDownloadReport: () => void;
  onProceedToAnalysis: () => void;
}

export default function MergeReport({
  mergeResult,
  mergeApprovedSources,
  groupNameMap,
  onDownloadCsv,
  onDownloadReport,
  onProceedToAnalysis,
}: MergeReportProps) {
  if (!mergeResult) {
    return (
      <motion.div variants={itemVariants} className="flex flex-col items-center justify-center py-20 gap-4 text-neutral-500 dark:text-neutral-400">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm font-medium">Preparing merge report...</p>
      </motion.div>
    );
  }

  const { rows, cols, columns, preview, column_stats, skipped } = mergeResult;

  return (
    <motion.div variants={itemVariants} className="space-y-6">
      {/* Hero Banner */}
      <SurfaceCard noPadding>
        <div className="rounded-3xl bg-gradient-to-r from-emerald-600 to-teal-600 p-7 text-white">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-6 h-6" />
                <h2 className="text-xl font-semibold tracking-tight">
                  {skipped ? "Merge Skipped — Single Table Output" : "Merge Complete"}
                </h2>
              </div>
              <p className="text-emerald-50/90 text-sm max-w-xl">
                {skipped
                  ? "Your single table has been saved as the final merged output."
                  : `Successfully merged ${mergeApprovedSources.length} source table(s) into a unified dataset.`}
              </p>
            </div>
            <div className="flex gap-3 text-center shrink-0">
              <div className="rounded-xl bg-white/15 px-4 py-3 backdrop-blur">
                <p className="text-[10px] uppercase tracking-wider text-emerald-200">Rows</p>
                <p className="text-lg font-bold tabular-nums mt-0.5">{(rows ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded-xl bg-white/15 px-4 py-3 backdrop-blur">
                <p className="text-[10px] uppercase tracking-wider text-emerald-200">Columns</p>
                <p className="text-lg font-bold tabular-nums mt-0.5">{cols ?? 0}</p>
              </div>
              {!skipped && (
                <div className="rounded-xl bg-white/15 px-4 py-3 backdrop-blur">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-200">Sources</p>
                  <p className="text-lg font-bold tabular-nums mt-0.5">{mergeApprovedSources.length}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </SurfaceCard>

      {/* Per-Source Summary */}
      {!skipped && mergeApprovedSources.length > 0 && (
        <SurfaceCard title="Per-Source Merge Details" icon={Table2}>
          <div className="space-y-3">
            {mergeApprovedSources.map((src, i) => {
              const report = src.validation_report;
              return (
                <div key={i} className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                      Source {i + 1}: {groupNameMap[src.source_group_id] || src.source_group_id}
                    </h4>
                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 px-2 py-0.5 rounded-full">Approved</span>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-neutral-500 dark:text-neutral-400">
                    <span>Keys: {(src.key_pairs || []).map((kp: any) => `${kp.base_col}↔${kp.source_col}`).join(", ")}</span>
                    <span>Pulled: {(src.pull_columns || []).length} columns</span>
                    {report && (
                      <>
                        <span>Rows: {report.result_rows}</span>
                        <span>Explosion: {report.explosion_factor}×</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      )}

      {/* Column Stats */}
      {column_stats && column_stats.length > 0 && (
        <SurfaceCard title="Column Quality" icon={FileText}>
          <div className="overflow-auto max-h-[400px] rounded-xl border border-neutral-200 dark:border-neutral-700">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-50 dark:bg-neutral-800">
                <tr>
                  <th className="px-3 py-2 text-left font-bold text-neutral-500">Column</th>
                  <th className="px-3 py-2 text-left font-bold text-neutral-500">Fill Rate</th>
                  <th className="px-3 py-2 text-right font-bold text-neutral-500">Nulls</th>
                  <th className="px-3 py-2 text-right font-bold text-neutral-500">Distinct</th>
                </tr>
              </thead>
              <tbody>
                {column_stats.map((cs: any) => (
                  <tr key={cs.column_name} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-3 py-1.5 font-medium text-neutral-700 dark:text-neutral-300">{cs.column_name}</td>
                    <td className="px-3 py-1.5"><FillBar rate={cs.fill_rate} /></td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500">{cs.null_count}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500">{cs.distinct_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      )}

      {/* Preview */}
      {preview && preview.length > 0 && (
        <SurfaceCard title="Data Preview" subtitle={`First ${preview.length} rows of final_merged`}>
          <div className="overflow-auto max-h-[350px] rounded-xl border border-neutral-200 dark:border-neutral-700">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-neutral-50 dark:bg-neutral-800">
                <tr>
                  {Object.keys(preview[0]).map((col) => (
                    <th key={col} className="px-2 py-1.5 font-bold text-neutral-500 whitespace-nowrap border-b">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 50).map((row: any, ri: number) => (
                  <tr key={ri} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    {Object.values(row).map((val: any, ci: number) => (
                      <td key={ci} className="px-2 py-1 border-b border-neutral-100 dark:border-neutral-800 whitespace-nowrap max-w-[180px] truncate">{String(val ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton onClick={onDownloadCsv}>
          <Download className="w-4 h-4" />
          Download Final CSV
        </PrimaryButton>
        <SecondaryButton onClick={onDownloadReport}>
          <FileText className="w-4 h-4" />
          Download Audit Report
        </SecondaryButton>
        <PrimaryButton onClick={onProceedToAnalysis} className="bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200 dark:shadow-emerald-900/30">
          Proceed to Analysis <ArrowRight className="w-4 h-4" />
        </PrimaryButton>
      </div>
    </motion.div>
  );
}
