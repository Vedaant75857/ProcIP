import React, { useState } from "react";
import { ArrowRight, BarChart3, Calendar, Loader2, Sparkles, DollarSign, Globe } from "lucide-react";
import { motion } from "motion/react";
import { PrimaryButton } from "./ui";

interface AnalysisProps {
  mergeResult: any;
  analysisResults: any | null;
  analysisLoading: boolean;
  handleRunAnalysis: () => void;
  onProceedToProcurement: () => void;
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

export default function Analysis({
  mergeResult,
  analysisResults,
  analysisLoading,
  handleRunAnalysis,
  onProceedToProcurement,
}: AnalysisProps) {
  const [narrativeExpanded, setNarrativeExpanded] = useState(true);

  if (!mergeResult) return null;

  const dateRanges: any[] = analysisResults?.dateRanges || [];
  const currencyUniques: any[] = analysisResults?.currencyUniques || [];
  const spendByCurrency: any[] = analysisResults?.spendByCurrency || [];
  const aiNarrative: any = analysisResults?.aiNarrative || {};
  const totalRows = analysisResults?.totalRows || 0;
  const totalColumns = analysisResults?.totalColumns || 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden"
    >
      {/* Header */}
      <div className="p-6 border-b border-neutral-100 dark:border-neutral-800">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-red-600" />
              Procurement Analysis
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
              Analyze date ranges, currencies, and spend distribution across your merged dataset.
            </p>
          </div>
          <PrimaryButton
            onClick={handleRunAnalysis}
            disabled={analysisLoading}
            className="text-xs px-4 py-2"
          >
            {analysisLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {analysisResults ? "Re-run Analysis" : "Run Analysis"}
          </PrimaryButton>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {analysisLoading && !analysisResults && (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-red-500 mb-4" />
            <p className="text-sm font-medium text-neutral-500">Analyzing your procurement data...</p>
            <p className="text-xs text-neutral-400 mt-1">This may take a moment while AI processes the results.</p>
          </div>
        )}

        {!analysisLoading && !analysisResults && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BarChart3 className="w-10 h-10 text-neutral-300 dark:text-neutral-600 mb-4" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-2">
              Your merged dataset has {mergeResult?.final_shape?.rows?.toLocaleString() || "?"} rows.
            </p>
            <p className="text-xs text-neutral-400 mb-6">
              Click &quot;Run Analysis&quot; to identify date ranges, currencies, and spend summaries.
            </p>
          </div>
        )}

        {analysisResults && (
          <>
            {/* Summary badges */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[10px] font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 px-3 py-1 rounded-full">
                {totalRows.toLocaleString()} rows
              </span>
              <span className="text-[10px] font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 px-3 py-1 rounded-full">
                {totalColumns} columns
              </span>
              {dateRanges.length > 0 && (
                <span className="text-[10px] font-bold bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 px-3 py-1 rounded-full">
                  {dateRanges.length} date column{dateRanges.length !== 1 ? "s" : ""}
                </span>
              )}
              {currencyUniques.length > 0 && (
                <span className="text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 px-3 py-1 rounded-full">
                  {currencyUniques.reduce((s: number, c: any) => s + (c.values?.length || 0), 0)} unique currencies
                </span>
              )}
            </div>

            {/* Date Coverage */}
            {dateRanges.length > 0 && (
              <div className="border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-blue-50/50 dark:bg-blue-950/20 border-b border-blue-100 dark:border-blue-900/30 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-500" />
                  <h3 className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">Date Coverage</h3>
                </div>
                <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {dateRanges.map((dr: any, i: number) => (
                    <div key={i} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-neutral-900 dark:text-white">{dr.column}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-neutral-700 dark:text-neutral-300">
                          <span className="font-mono">{dr.min_date}</span>
                          <span className="mx-2 text-neutral-400">to</span>
                          <span className="font-mono">{dr.max_date}</span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Currencies */}
            {currencyUniques.length > 0 && (
              <div className="border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-emerald-50/50 dark:bg-emerald-950/20 border-b border-emerald-100 dark:border-emerald-900/30 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Currencies</h3>
                </div>
                <div className="p-4 space-y-3">
                  {currencyUniques.map((cu: any, i: number) => (
                    <div key={i}>
                      <p className="text-xs font-bold text-neutral-900 dark:text-white mb-1.5">{cu.column}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(cu.values || []).map((v: string, j: number) => (
                          <span key={j} className="inline-block px-2.5 py-1 rounded-md text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                            {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Spend Summary */}
            {spendByCurrency.length > 0 && (
              <div className="border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-purple-50/50 dark:bg-purple-950/20 border-b border-purple-100 dark:border-purple-900/30 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-purple-500" />
                  <h3 className="text-xs font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wider">Spend Summary</h3>
                </div>
                <div className="p-4 space-y-4">
                  {spendByCurrency.map((sbc: any, i: number) => {
                    const breakdown = sbc.breakdown || [];
                    const maxSpend = Math.max(...breakdown.map((b: any) => Math.abs(b.total_spend || 0)), 1);
                    return (
                      <div key={i}>
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-xs font-bold text-neutral-900 dark:text-white">{sbc.spend_column}</p>
                          {sbc.currency_column && (
                            <span className="text-[10px] text-neutral-400">by {sbc.currency_column}</span>
                          )}
                        </div>
                        <div className="border border-neutral-100 dark:border-neutral-800 rounded-lg overflow-hidden">
                          <table className="min-w-full text-xs">
                            <thead className="bg-neutral-50 dark:bg-neutral-800">
                              <tr>
                                <th className="px-3 py-2 text-left font-bold text-neutral-500 dark:text-neutral-400">Currency</th>
                                <th className="px-3 py-2 text-right font-bold text-neutral-500 dark:text-neutral-400">Total Spend</th>
                                <th className="px-3 py-2 text-right font-bold text-neutral-500 dark:text-neutral-400">Rows</th>
                                <th className="px-3 py-2 text-left font-bold text-neutral-500 dark:text-neutral-400 w-40">Distribution</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                              {breakdown.map((b: any, j: number) => {
                                const pct = Math.max(3, (Math.abs(b.total_spend || 0) / maxSpend) * 100);
                                return (
                                  <tr key={j} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50 transition-colors">
                                    <td className="px-3 py-2 font-bold text-neutral-900 dark:text-white">{b.currency}</td>
                                    <td className="px-3 py-2 text-right font-mono text-neutral-700 dark:text-neutral-300">
                                      {formatNumber(b.total_spend || 0)}
                                    </td>
                                    <td className="px-3 py-2 text-right text-neutral-500 dark:text-neutral-400">
                                      {(b.row_count || 0).toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="h-2.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-purple-400 dark:bg-purple-500 rounded-full transition-all"
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI Narrative */}
            {aiNarrative && (aiNarrative.narrative || aiNarrative.highlights?.length > 0) && (
              <div className="border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setNarrativeExpanded(!narrativeExpanded)}
                  className="w-full px-4 py-3 bg-red-50/50 dark:bg-red-950/20 border-b border-red-100 dark:border-red-900/30 flex items-center gap-2 text-left"
                >
                  <Sparkles className="w-4 h-4 text-red-500" />
                  <h3 className="text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wider flex-1">AI Narrative</h3>
                </button>
                {narrativeExpanded && (
                  <div className="p-5 space-y-4">
                    {aiNarrative.narrative && (
                      <div className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-line">
                        {aiNarrative.narrative}
                      </div>
                    )}

                    {aiNarrative.highlights?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest mb-2">Key Highlights</p>
                        <ul className="space-y-1.5">
                          {aiNarrative.highlights.map((h: string, i: number) => (
                            <li key={i} className="text-xs text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 rounded-lg px-3 py-2">
                              {h}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {aiNarrative.dataQualityNotes?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-amber-500 dark:text-amber-400 uppercase tracking-widest mb-2">Data Quality Notes</p>
                        <ul className="space-y-1.5">
                          {aiNarrative.dataQualityNotes.map((n: string, i: number) => (
                            <li key={i} className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 rounded-lg px-3 py-2">
                              {n}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* No data fallback */}
            {dateRanges.length === 0 && currencyUniques.length === 0 && spendByCurrency.length === 0 && !aiNarrative?.narrative && (
              <div className="py-8 text-center">
                <p className="text-sm text-neutral-400">No date, currency, or spend columns were detected in the merged dataset.</p>
                <p className="text-xs text-neutral-400 mt-1">Ensure your header mapping includes date, currency, and spend fields.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-6 border-t border-neutral-100 dark:border-neutral-800 flex justify-end">
        <PrimaryButton onClick={onProceedToProcurement} disabled={analysisLoading}>
          Proceed to Procurement Mapping
          <ArrowRight className="w-4 h-4" />
        </PrimaryButton>
      </div>
    </motion.section>
  );
}
