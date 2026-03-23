import React, { useState, useMemo } from "react";
import { CheckCircle2, AlertCircle, Search, Filter, ArrowRight, Info, Loader2, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { PrimaryButton, EmptyState } from "./ui";

interface ProcurementProps {
  step: number;
  procurementMappings: any[];
  setProcurementMappings: (mappings: any[]) => void;
  standardFields: any[];
  viewCategories: any;
  possibleViews: any;
  handleAnalyzeViews: () => void;
  handleGenerateProcurementMapping: () => void;
  loading: boolean;
  onSelectChatItem?: (item: { type: string; id: string; label: string }) => void;
}

export default function Procurement({
  step,
  procurementMappings,
  setProcurementMappings,
  standardFields,
  viewCategories,
  possibleViews,
  handleAnalyzeViews,
  handleGenerateProcurementMapping,
  loading,
  onSelectChatItem,
}: ProcurementProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string | "all">("all");

  const filteredMappings = useMemo(() => {
    return procurementMappings.filter(m => {
      const matchesSearch = m.uploaded_column.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (m.best_match && m.best_match.toLowerCase().includes(searchTerm.toLowerCase()));
      
      if (filterType === "all") return matchesSearch;
      if (filterType === "mapped") return matchesSearch && m.best_match;
      if (filterType === "unmapped") return matchesSearch && !m.best_match;
      if (filterType === "low_confidence") return matchesSearch && m.confidence < 0.85 && m.best_match;
      return matchesSearch;
    });
  }, [procurementMappings, searchTerm, filterType]);

  const stats = useMemo(() => {
    const total = procurementMappings.length;
    const mapped = procurementMappings.filter(m => m.best_match).length;
    const lowConfidence = procurementMappings.filter(m => m.best_match && m.confidence < 0.85).length;
    return { total, mapped, unmapped: total - mapped, lowConfidence };
  }, [procurementMappings]);

  const { fullCount, partialCount } = useMemo(() => {
    const vals = Object.values(possibleViews) as any[];
    return {
      fullCount: vals.filter(v => v.status === "full").length,
      partialCount: vals.filter(v => v.status === "partial").length,
    };
  }, [possibleViews]);

  return (
    <div className="space-y-6">
      {/* Step 8: Procurement Mapping */}
      {step === 9 && (
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden"
        >
          <div className="p-6 border-b border-neutral-100 dark:border-neutral-800">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white">Procurement Mapping</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Align your data columns with standard procurement fields for advanced analytics.</p>
              </div>
              <div className="flex gap-2">
                <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-1.5 text-center">
                  <p className="text-[10px] uppercase font-bold text-neutral-400 dark:text-neutral-500">Mapped</p>
                  <p className="text-lg font-semibold text-red-600 dark:text-red-400">{stats.mapped}/{stats.total}</p>
                </div>
                {stats.lowConfidence > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 rounded-lg px-3 py-1.5 text-center">
                    <p className="text-[10px] uppercase font-bold text-amber-500">Review Needed</p>
                    <p className="text-lg font-semibold text-amber-600 dark:text-amber-400">{stats.lowConfidence}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 dark:text-neutral-500" />
                <input
                  type="text"
                  placeholder="Search columns..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm text-neutral-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="pl-3 pr-8 py-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm text-neutral-900 dark:text-white focus:ring-2 focus:ring-red-500 outline-none appearance-none cursor-pointer"
                >
                  <option value="all">All Columns</option>
                  <option value="mapped">Mapped Only</option>
                  <option value="unmapped">Unmapped Only</option>
                  <option value="low_confidence">Low Confidence</option>
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            {procurementMappings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center mb-5">
                  <Sparkles className="w-7 h-7 text-red-500" />
                </div>
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-2">Map Columns to Standard Fields</h3>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-md mb-6">
                  Use AI to automatically align your data columns with standard procurement fields for spend analysis, supplier analytics, and dashboarding.
                </p>
                <PrimaryButton onClick={handleGenerateProcurementMapping} disabled={loading}>
                  {loading ? <Loader2 className="animate-spin w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                  Generate Procurement Mapping
                </PrimaryButton>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
              <thead className="bg-neutral-50 dark:bg-neutral-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">Uploaded Column</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">Standard Field Mapping</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">AI Confidence</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-neutral-900 divide-y divide-neutral-100 dark:divide-neutral-800">
                <AnimatePresence mode="popLayout">
                  {filteredMappings.map((mapping, i) => (
                    <motion.tr 
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      key={mapping.uploaded_column}
                      className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-medium text-neutral-900 dark:text-white ${onSelectChatItem ? "cursor-pointer hover:text-red-600 dark:hover:text-red-400 transition-colors" : ""}`}
                            onClick={() => onSelectChatItem?.({ type: "mapping", id: mapping.uploaded_column, label: `Mapping: ${mapping.uploaded_column}` })}
                          >
                            {mapping.uploaded_column}
                          </span>
                          {mapping.reasoning && (
                            <div className="group relative">
                              <Info className="w-3.5 h-3.5 text-neutral-300 dark:text-neutral-600 cursor-help" />
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-neutral-900 text-white text-[10px] rounded shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                                {mapping.reasoning}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <select
                          value={mapping.best_match || ""}
                          onChange={(e) => {
                            const newMappings = [...procurementMappings];
                            const idx = procurementMappings.findIndex(m => m.uploaded_column === mapping.uploaded_column);
                            newMappings[idx].best_match = e.target.value || null;
                            setProcurementMappings(newMappings);
                          }}
                          className={`block w-full pl-3 pr-10 py-1.5 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 focus:outline-none focus:ring-red-500 focus:border-red-500 rounded-lg transition-all ${
                            !mapping.best_match ? 'text-neutral-400 dark:text-neutral-500 italic' : 'text-neutral-900 dark:text-white'
                          }`}
                        >
                          <option value="">-- No Mapping --</option>
                          {standardFields.map((f: any) => (
                            <option key={f.name} value={f.name}>{f.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {mapping.best_match ? (
                          <div className="flex items-center gap-2">
                            <div className="w-12 h-1.5 bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${
                                  mapping.confidence >= 0.85 ? 'bg-emerald-500' :
                                  mapping.confidence >= 0.65 ? 'bg-amber-500' : 'bg-red-500'
                                }`}
                                style={{ width: `${(mapping.confidence * 100)}%` }}
                              />
                            </div>
                            <span className={`text-xs font-bold ${
                              mapping.confidence >= 0.85 ? 'text-emerald-600 dark:text-emerald-400' :
                              mapping.confidence >= 0.65 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                            }`}>
                              {(mapping.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-neutral-300 dark:text-neutral-600 font-medium">N/A</span>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            )}
          </div>

          <div className="p-6 border-t border-neutral-100 dark:border-neutral-800 flex justify-between items-center">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Showing {filteredMappings.length} of {stats.total} columns
            </p>
            <PrimaryButton onClick={handleAnalyzeViews}>
              Analyze Possible Views
              <ArrowRight className="w-4 h-4" />
            </PrimaryButton>
          </div>
        </motion.section>
      )}

      {/* Step 10: Procurement Views */}
      {step === 10 && (
        <motion.section 
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden"
        >
          <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 bg-gradient-to-br from-red-600 to-rose-600 text-white rounded-t-3xl">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Procurement Intelligence Views</h2>
                <p className="text-red-100 text-sm mt-1">We've identified {fullCount + partialCount} usable analysis views based on your data.</p>
              </div>
              <div className="flex gap-3">
                <div className="bg-white/20 backdrop-blur-md rounded-xl px-4 py-2 text-center">
                  <p className="text-[10px] uppercase font-bold text-red-200">Ready</p>
                  <p className="text-2xl font-bold">{fullCount}</p>
                </div>
                {partialCount > 0 && (
                  <div className="bg-white/20 backdrop-blur-md rounded-xl px-4 py-2 text-center">
                    <p className="text-[10px] uppercase font-bold text-red-200">Partial</p>
                    <p className="text-2xl font-bold">{partialCount}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="p-6 space-y-10">
            {Object.entries(viewCategories).map(([category, views]) => (
              <div key={category}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-8 w-1 bg-red-600 rounded-full"></div>
                  <h3 className="text-lg font-bold text-neutral-900 dark:text-white">{category} Analysis</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(views as string[]).map(viewName => {
                    const viewStatus = possibleViews[viewName];
                    if (!viewStatus) return null;
                    const isFull = viewStatus.status === "full";
                    const isPartial = viewStatus.status === "partial";

                    return (
                      <motion.div 
                        whileHover={{ y: -2 }}
                        key={viewName} 
                        className={`relative border rounded-2xl p-5 transition-all ${
                          isFull
                            ? 'bg-white dark:bg-neutral-900 border-emerald-200 dark:border-emerald-800 shadow-sm hover:shadow-md'
                            : isPartial
                            ? 'bg-blue-50/50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 shadow-sm hover:shadow-md'
                            : 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 opacity-75'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-4">
                          <h4 className={`font-bold text-sm ${
                            isFull ? 'text-neutral-900 dark:text-white' : isPartial ? 'text-neutral-900 dark:text-white' : 'text-neutral-500 dark:text-neutral-400'
                          }`}>
                            {viewName}
                          </h4>
                          {isFull ? (
                            <div className="bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 p-1 rounded-full">
                              <CheckCircle2 className="w-4 h-4" />
                            </div>
                          ) : isPartial ? (
                            <div className="bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 p-1 rounded-full">
                              <CheckCircle2 className="w-4 h-4" />
                            </div>
                          ) : (
                            <div className="bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 p-1 rounded-full">
                              <AlertCircle className="w-4 h-4" />
                            </div>
                          )}
                        </div>

                        {isFull ? (
                          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            Ready for Dashboarding
                          </div>
                        ) : isPartial ? (
                          <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                            Possible with available data
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-1.5">
                              {viewStatus.missing.map((m: string) => (
                                <span key={m} className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-400 dark:text-neutral-500 uppercase tracking-tight">
                                  {m}
                                </span>
                              ))}
                            </div>
                            <p className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium italic">
                              Map these fields in the previous step to unlock this view.
                            </p>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          
          <div className="p-6 bg-neutral-50 dark:bg-neutral-800 border-t border-neutral-100 dark:border-neutral-800 flex justify-center">
            <button 
              onClick={() => window.print()}
              className="text-sm font-bold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-400 flex items-center gap-2"
            >
              Export Analysis Summary
            </button>
          </div>
        </motion.section>
      )}
    </div>
  );
}
