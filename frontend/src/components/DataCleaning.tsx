import React, { useState, useEffect } from "react";
import { Loader2, Sparkles, ArrowRight, Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { motion } from "motion/react";
import { PrimaryButton, SecondaryButton } from "./ui";

interface CleaningConfig {
  removeNullRows: boolean;
  removeNullColumns: boolean;
  dropColumns: string[];
  caseMode: "upper" | "lower";
  trimWhitespace: boolean;
  columnTypes: Record<string, "string" | "number" | "date">;
  deduplicateColumns: string[];
}

const DEFAULT_CONFIG: CleaningConfig = {
  removeNullRows: true,
  removeNullColumns: true,
  dropColumns: [],
  caseMode: "upper",
  trimWhitespace: true,
  columnTypes: {},
  deduplicateColumns: [],
};

interface DataCleaningProps {
  step: number;
  inventory: any[];
  previews: Record<string, { columns: string[]; rows: any[] }>;
  cleaningConfigs: Record<string, any>;
  loading: boolean;
  onCleanTable: (tableKey: string, config: CleaningConfig) => Promise<void>;
  onProceed: () => void;
  onSkip: () => void;
}

export default function DataCleaning({
  step,
  inventory,
  previews,
  cleaningConfigs,
  loading,
  onCleanTable,
  onProceed,
  onSkip,
}: DataCleaningProps) {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [localConfig, setLocalConfig] = useState<CleaningConfig>(DEFAULT_CONFIG);
  const [expandedPreview, setExpandedPreview] = useState(true);

  useEffect(() => {
    if (inventory.length > 0 && !selectedTable) {
      setSelectedTable(inventory[0].table_key);
    }
  }, [inventory, selectedTable]);

  useEffect(() => {
    if (selectedTable && cleaningConfigs[selectedTable]) {
      setLocalConfig({ ...DEFAULT_CONFIG, ...cleaningConfigs[selectedTable] });
    } else {
      const cols = selectedTable ? (previews[selectedTable]?.columns || []) : [];
      const autoDedup = cols.filter((c) => /id|number/i.test(c));
      setLocalConfig({ ...DEFAULT_CONFIG, deduplicateColumns: autoDedup });
    }
  }, [selectedTable, cleaningConfigs, previews]);

  const currentPreview = selectedTable ? previews[selectedTable] : null;
  const currentInv = selectedTable ? inventory.find((i) => i.table_key === selectedTable) : null;
  const visibleColumns = currentPreview?.columns.filter((c) => !localConfig.dropColumns.includes(c)) || [];
  const isCleaned = selectedTable ? !!cleaningConfigs[selectedTable] : false;

  const toggleDropColumn = (col: string) => {
    setLocalConfig((prev) => ({
      ...prev,
      dropColumns: prev.dropColumns.includes(col)
        ? prev.dropColumns.filter((c) => c !== col)
        : [...prev.dropColumns, col],
    }));
  };

  const setColumnType = (col: string, type: "string" | "number" | "date") => {
    setLocalConfig((prev) => ({
      ...prev,
      columnTypes: { ...prev.columnTypes, [col]: type },
    }));
  };

  const toggleDeduplicateColumn = (col: string) => {
    setLocalConfig((prev) => ({
      ...prev,
      deduplicateColumns: prev.deduplicateColumns.includes(col)
        ? prev.deduplicateColumns.filter((c) => c !== col)
        : [...prev.deduplicateColumns, col],
    }));
  };

  const handleApply = async () => {
    if (!selectedTable) return;
    await onCleanTable(selectedTable, localConfig);
  };

  if (step !== 5) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden"
    >
      <div className="p-6 border-b border-neutral-100 dark:border-neutral-800">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-red-600" />
          Data Cleaning
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          Optionally clean each table before grouping. Select a table, configure cleaning options, and apply.
        </p>
      </div>

      <div className="flex min-h-[500px]">
        {/* Table selector sidebar */}
        <div className="w-64 border-r border-neutral-100 dark:border-neutral-800 bg-neutral-50/30 dark:bg-neutral-800 overflow-y-auto shrink-0">
          <div className="p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 px-2 mb-2">
              Tables ({inventory.length})
            </p>
            {inventory.map((inv) => {
              const isSelected = selectedTable === inv.table_key;
              const isTableCleaned = !!cleaningConfigs[inv.table_key];
              return (
                <button
                  key={inv.table_key}
                  type="button"
                  onClick={() => setSelectedTable(inv.table_key)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium transition-colors mb-1 flex items-center gap-2 ${
                    isSelected
                      ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
                      : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 border border-transparent"
                  }`}
                >
                  <span className="truncate flex-1">{inv.table_key}</span>
                  {isTableCleaned && (
                    <span className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  )}
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">
                    {inv.rows}r
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main config area */}
        <div className="flex-1 overflow-y-auto">
          {selectedTable && currentPreview ? (
            <div className="p-6 space-y-6">
              {/* Table info */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold tracking-tight text-neutral-900 dark:text-white text-sm">{selectedTable}</h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                    {currentInv?.rows.toLocaleString()} rows, {currentPreview.columns.length} columns
                    {isCleaned && <span className="text-emerald-600 dark:text-emerald-400 font-medium ml-2">Cleaned</span>}
                  </p>
                </div>
                <PrimaryButton onClick={handleApply} disabled={loading} className="text-xs px-4 py-2">
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Apply Cleaning
                </PrimaryButton>
              </div>

              {/* Table-level options */}
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-3 px-4 py-3 border border-neutral-200 dark:border-neutral-700 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={localConfig.removeNullRows}
                    onChange={(e) => setLocalConfig((p) => ({ ...p, removeNullRows: e.target.checked }))}
                    className="w-4 h-4 text-red-600 rounded border-neutral-300 focus:ring-red-500"
                  />
                  <div>
                    <p className="text-xs font-bold text-neutral-900 dark:text-white">Remove Null Rows</p>
                    <p className="text-[10px] text-neutral-400 dark:text-neutral-500">Drop rows where all values are empty</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 px-4 py-3 border border-neutral-200 dark:border-neutral-700 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={localConfig.removeNullColumns}
                    onChange={(e) => setLocalConfig((p) => ({ ...p, removeNullColumns: e.target.checked }))}
                    className="w-4 h-4 text-red-600 rounded border-neutral-300 focus:ring-red-500"
                  />
                  <div>
                    <p className="text-xs font-bold text-neutral-900 dark:text-white">Remove Null Columns</p>
                    <p className="text-[10px] text-neutral-400 dark:text-neutral-500">Drop columns where all values are empty</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 px-4 py-3 border border-neutral-200 dark:border-neutral-700 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={localConfig.trimWhitespace}
                    onChange={(e) => setLocalConfig((p) => ({ ...p, trimWhitespace: e.target.checked }))}
                    className="w-4 h-4 text-red-600 rounded border-neutral-300 focus:ring-red-500"
                  />
                  <div>
                    <p className="text-xs font-bold text-neutral-900 dark:text-white">Trim Whitespace</p>
                    <p className="text-[10px] text-neutral-400 dark:text-neutral-500">Remove leading/trailing spaces</p>
                  </div>
                </label>

                <div className="flex items-center gap-3 px-4 py-3 border border-neutral-200 dark:border-neutral-700 rounded-xl">
                  <div className="flex-1">
                    <p className="text-xs font-bold text-neutral-900 dark:text-white">Standardize Case</p>
                    <p className="text-[10px] text-neutral-400 dark:text-neutral-500">Apply to all text values</p>
                  </div>
                  <select
                    value={localConfig.caseMode}
                    onChange={(e) => setLocalConfig((p) => ({ ...p, caseMode: e.target.value as "upper" | "lower" }))}
                    className="text-xs border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-1.5 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-red-500 transition-shadow"
                  >
                    <option value="upper">UPPER CASE</option>
                    <option value="lower">lower case</option>
                  </select>
                </div>
              </div>

              {/* Remove Duplicates */}
              <div className="border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-neutral-50/50 dark:bg-neutral-800 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Copy className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                    <div>
                      <p className="text-xs font-bold text-neutral-900 dark:text-white">Remove Duplicates</p>
                      <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
                        Select columns that define uniqueness — only the first occurrence of each combination is kept
                      </p>
                    </div>
                  </div>
                  {localConfig.deduplicateColumns.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setLocalConfig((p) => ({ ...p, deduplicateColumns: [] }))}
                      className="text-[10px] font-medium text-red-500 hover:text-red-700 transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                <div className="p-4">
                  {localConfig.deduplicateColumns.length > 0 && (
                    <div className="mb-3 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-[11px] text-amber-700 dark:text-amber-400">
                      Uniqueness key: <span className="font-bold">{localConfig.deduplicateColumns.join(" + ")}</span>
                      {" "}— rows with the same combination of these values will be deduplicated (first row kept).
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {(currentPreview?.columns || [])
                      .filter((col) => !localConfig.dropColumns.includes(col))
                      .map((col) => {
                        const isSelected = localConfig.deduplicateColumns.includes(col);
                        return (
                          <button
                            key={col}
                            type="button"
                            onClick={() => toggleDeduplicateColumn(col)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                              isSelected
                                ? "bg-red-50 dark:bg-red-950/30 border-red-300 text-red-700 dark:text-red-400 shadow-sm"
                                : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-600"
                            }`}
                          >
                            <span className={`w-3 h-3 rounded-sm border flex items-center justify-center transition-colors ${
                              isSelected ? "bg-red-600 border-red-600" : "border-neutral-300"
                            }`}>
                              {isSelected && <Check className="w-2 h-2 text-white" />}
                            </span>
                            {col}
                          </button>
                        );
                      })}
                  </div>
                  {localConfig.deduplicateColumns.length === 0 && (
                    <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-2 italic">
                      No columns selected — deduplication is disabled. Click columns above to define your uniqueness key.
                    </p>
                  )}
                </div>
              </div>

              {/* Column controls */}
              <div>
                <p className="text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider mb-3">
                  Column Settings
                  {localConfig.dropColumns.length > 0 && (
                    <span className="ml-2 text-red-500 normal-case">
                      ({localConfig.dropColumns.length} column{localConfig.dropColumns.length !== 1 ? "s" : ""} marked for removal)
                    </span>
                  )}
                </p>
                <div className="border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
                  <table className="min-w-full text-xs">
                    <thead className="bg-neutral-50 dark:bg-neutral-800">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-bold text-neutral-500 dark:text-neutral-400 w-8">Keep</th>
                        <th className="px-4 py-2.5 text-left font-bold text-neutral-500 dark:text-neutral-400">Column Name</th>
                        <th className="px-4 py-2.5 text-left font-bold text-neutral-500 dark:text-neutral-400">Sample Values</th>
                        <th className="px-4 py-2.5 text-left font-bold text-neutral-500 dark:text-neutral-400 w-32">Data Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {currentPreview.columns.map((col) => {
                        const isDropped = localConfig.dropColumns.includes(col);
                        const samples = currentPreview.rows
                          .map((r) => r[col])
                          .filter((v) => v !== null && v !== undefined && v !== "")
                          .slice(0, 3);
                        return (
                          <tr
                            key={col}
                            className={`transition-colors ${isDropped ? "bg-red-50/50 dark:bg-red-950/30 opacity-60" : "hover:bg-neutral-50/50 dark:hover:bg-neutral-800"}`}
                          >
                            <td className="px-4 py-2">
                              <input
                                type="checkbox"
                                checked={!isDropped}
                                onChange={() => toggleDropColumn(col)}
                                className="w-3.5 h-3.5 text-red-600 rounded border-neutral-300 focus:ring-red-500"
                              />
                            </td>
                            <td className={`px-4 py-2 font-bold ${isDropped ? "line-through text-neutral-400 dark:text-neutral-500" : "text-neutral-900 dark:text-white"}`}>
                              {col}
                            </td>
                            <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400 max-w-[200px] truncate">
                              {samples.length > 0 ? samples.map(String).join(", ") : <span className="italic text-neutral-300 dark:text-neutral-600">empty</span>}
                            </td>
                            <td className="px-4 py-2">
                              <select
                                value={localConfig.columnTypes[col] || "string"}
                                onChange={(e) => setColumnType(col, e.target.value as any)}
                                disabled={isDropped}
                                className="w-full text-xs border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-1 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-40 transition-shadow"
                              >
                                <option value="string">String</option>
                                <option value="number">Number</option>
                                <option value="date">Date</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Data preview */}
              <div>
                <button
                  type="button"
                  onClick={() => setExpandedPreview(!expandedPreview)}
                  className="flex items-center gap-2 text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider mb-3 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                >
                  {expandedPreview ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  Data Preview ({visibleColumns.length} columns)
                </button>
                {expandedPreview && visibleColumns.length > 0 && (
                  <div className="overflow-x-auto border border-neutral-200 dark:border-neutral-700 rounded-xl max-h-64">
                    <table className="min-w-full text-xs">
                      <thead className="bg-neutral-50 dark:bg-neutral-800 sticky top-0">
                        <tr>
                          {visibleColumns.map((col) => (
                            <th
                              key={col}
                              className="px-3 py-2 text-left font-bold text-neutral-500 whitespace-nowrap border-b border-neutral-200"
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {currentPreview.rows.map((row, ri) => (
                          <tr key={ri} className="hover:bg-red-50/30">
                            {visibleColumns.map((col) => (
                              <td
                                key={col}
                                className="px-3 py-1.5 whitespace-nowrap text-neutral-700 max-w-[200px] truncate"
                              >
                                {row[col] != null ? String(row[col]) : <span className="text-neutral-300 italic">null</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-neutral-400 text-sm">
              Select a table from the list to configure cleaning options.
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-6 border-t border-neutral-100 flex justify-between items-center">
        <div className="text-xs text-neutral-500">
          {Object.keys(cleaningConfigs).length > 0 ? (
            <span className="rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {Object.keys(cleaningConfigs).length} table{Object.keys(cleaningConfigs).length !== 1 ? "s" : ""} cleaned
            </span>
          ) : (
            <span>No cleaning applied yet. You can skip this step.</span>
          )}
        </div>
        <div className="flex gap-3">
          <SecondaryButton onClick={onSkip}>
            Skip Cleaning
          </SecondaryButton>
          <PrimaryButton onClick={onProceed} disabled={loading}>
            Proceed to Append Strategy
            <ArrowRight className="w-4 h-4" />
          </PrimaryButton>
        </div>
      </div>
    </motion.section>
  );
}
