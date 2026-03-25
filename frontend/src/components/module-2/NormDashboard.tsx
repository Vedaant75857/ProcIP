import React, { useState, useCallback, useEffect } from "react";
import {
  Upload, FileSpreadsheet, Loader2, ArrowRight, CheckCircle2,
  Download, RefreshCw, Sparkles, ChevronDown, ChevronRight,
  AlertCircle, Eye, Columns, Globe, Calendar, DollarSign,
  Building2, MapPin, Tag, ClipboardList,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { SurfaceCard, PrimaryButton, SecondaryButton, EmptyState } from "../common/ui";
import * as api from "./services/normalizationApi";

type NormStep = "upload" | "mapping" | "operations" | "download";

interface NormDashboardProps {
  importedCsv?: string | null;
  onImportComplete?: () => void;
  apiKey: string;
}

interface SheetInfo {
  sheet_key: string;
  rows: number;
  columns: string[];
}

const OPERATIONS = [
  { id: "fix-supplier-names" as const, label: "Supplier Names", icon: Building2, desc: "Clean & deduplicate supplier names" },
  { id: "fix-supplier-country" as const, label: "Supplier Country", icon: Globe, desc: "Standardize country names" },
  { id: "fix-dates" as const, label: "Dates", icon: Calendar, desc: "Normalize date formats" },
  { id: "fix-terms" as const, label: "Payment Terms", icon: ClipboardList, desc: "Extract numeric payment terms" },
  { id: "fix-regions" as const, label: "Regions", icon: MapPin, desc: "Classify into NA/EMEA/APAC/LATAM" },
  { id: "fix-plant-names" as const, label: "Plant/Site", icon: Building2, desc: "Standardize plant codes & names" },
  { id: "add-record-id" as const, label: "Record ID", icon: Tag, desc: "Add unique record identifiers" },
];

export default function NormDashboard({ importedCsv, onImportComplete, apiKey }: NormDashboardProps) {
  const [normStep, setNormStep] = useState<NormStep>("upload");
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidecarOnline, setSidecarOnline] = useState<boolean | null>(null);
  const [mappingResult, setMappingResult] = useState<any>(null);
  const [completedOps, setCompletedOps] = useState<Set<string>>(new Set());
  const [activeOp, setActiveOp] = useState<string | null>(null);
  const [opResults, setOpResults] = useState<Record<string, any>>({});
  const [pendingPreview, setPendingPreview] = useState<any>(null);
  const [previewOpen, setPreviewOpen] = useState<string | null>(null);
  const [spendConfig, setSpendConfig] = useState<any>(null);

  useEffect(() => {
    api.checkHealth()
      .then(() => setSidecarOnline(true))
      .catch(() => setSidecarOnline(false));
  }, []);

  useEffect(() => {
    if (importedCsv && sidecarOnline) {
      handleImportFromStitching(importedCsv);
    }
  }, [importedCsv, sidecarOnline]);

  const handleImportFromStitching = useCallback(async (csv: string) => {
    setLoading(true);
    setError(null);
    try {
      if (apiKey) await api.setApiKey(apiKey);
      const result = await api.importFromStitching(csv);
      setSheets([{ sheet_key: result.sheet_key, rows: result.rows, columns: result.columns }]);
      setNormStep("mapping");
      onImportComplete?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiKey, onImportComplete]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setLoading(true);
    setError(null);
    try {
      if (apiKey) await api.setApiKey(apiKey);
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }
      const result = await api.uploadFiles(formData);
      const sheetData = await api.listSheets();
      setSheets(sheetData.sheets);
      setNormStep("mapping");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  const handleMapHeaders = useCallback(async () => {
    if (!apiKey) { setError("API key required for header mapping"); return; }
    setLoading(true);
    setError(null);
    try {
      const result = await api.mapHeaders(apiKey);
      setMappingResult(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  const handleApplyMappings = useCallback(async () => {
    if (!mappingResult?.mappings) return;
    setLoading(true);
    setError(null);
    try {
      await api.applyMappings(mappingResult.mappings);
      const sheetData = await api.listSheets();
      setSheets(sheetData.sheets);
      setNormStep("operations");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [mappingResult]);

  const handleSkipMapping = useCallback(() => {
    setNormStep("operations");
  }, []);

  const handleRunOperation = useCallback(async (opId: api.NormOperation) => {
    setActiveOp(opId);
    setError(null);
    try {
      const result = await api.runNormOperation(opId, { api_key: apiKey });
      setOpResults(prev => ({ ...prev, [opId]: result }));
      if (result.pending || result.preview_mode) {
        setPendingPreview(result);
      } else {
        setCompletedOps(prev => new Set([...prev, opId]));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActiveOp(null);
    }
  }, [apiKey]);

  const handleApplyPending = useCallback(async () => {
    setLoading(true);
    try {
      await api.applyPendingOperation();
      if (activeOp) setCompletedOps(prev => new Set([...prev, activeOp]));
      setPendingPreview(null);
      const sheetData = await api.listSheets();
      setSheets(sheetData.sheets);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeOp]);

  const handleDiscardPending = useCallback(async () => {
    try {
      await api.discardPendingOperation();
      setPendingPreview(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    setLoading(true);
    try {
      const blob = await api.downloadResults();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "normalized_data.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDetectSpend = useCallback(async () => {
    try {
      const result = await api.detectSpendColumns();
      setSpendConfig(result);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const handleNormalizeSpend = useCallback(async () => {
    if (!spendConfig) return;
    setActiveOp("normalize-spend");
    setError(null);
    try {
      const result = await api.normalizeSpend({
        currency_col: spendConfig.currency_col,
        spend_cols: spendConfig.spend_cols,
        date_col: spendConfig.date_col,
        target_currency: "USD",
      });
      setOpResults(prev => ({ ...prev, "normalize-spend": result }));
      setCompletedOps(prev => new Set([...prev, "normalize-spend"]));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActiveOp(null);
    }
  }, [spendConfig]);

  if (sidecarOnline === false) {
    return (
      <SurfaceCard>
        <div className="text-center py-12 space-y-4">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto" />
          <h3 className="text-lg font-semibold">Normalization Service Offline</h3>
          <p className="text-sm text-neutral-500 max-w-md mx-auto">
            The Python normalization backend is not running. Start it with:
          </p>
          <code className="block text-xs bg-neutral-100 dark:bg-neutral-800 rounded-xl px-4 py-2 font-mono">
            cd backend/python && python app.py
          </code>
          <SecondaryButton onClick={() => api.checkHealth().then(() => setSidecarOnline(true)).catch(() => setSidecarOnline(false))}>
            <RefreshCw className="w-4 h-4 mr-2" /> Retry Connection
          </SecondaryButton>
        </div>
      </SurfaceCard>
    );
  }

  if (sidecarOnline === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
        <span className="ml-3 text-sm text-neutral-500">Connecting to normalization service...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(["upload", "mapping", "operations", "download"] as NormStep[]).map((s, i) => {
          const labels = ["Upload / Import", "Header Mapping", "Normalize", "Download"];
          const isCurrent = s === normStep;
          const isPast = ["upload", "mapping", "operations", "download"].indexOf(normStep) > i;
          return (
            <React.Fragment key={s}>
              {i > 0 && <ArrowRight className="w-3 h-3 text-neutral-300" />}
              <button
                onClick={() => isPast && setNormStep(s)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  isCurrent
                    ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800"
                    : isPast
                    ? "text-emerald-600 dark:text-emerald-400 cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                    : "text-neutral-400 cursor-default"
                }`}
              >
                {isPast && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                {labels[i]}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-4 flex items-center gap-3"
        >
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xs font-semibold">Dismiss</button>
        </motion.div>
      )}

      {/* UPLOAD STEP */}
      {normStep === "upload" && (
        <SurfaceCard title="Load Data" subtitle="Upload files or import from Data Stitching" icon={Upload}>
          <div className="space-y-6">
            {sheets.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-emerald-600 font-medium">
                  <CheckCircle2 className="w-4 h-4 inline mr-1" />
                  {sheets.length} sheet(s) loaded ({sheets.reduce((s, sh) => s + sh.rows, 0)} total rows)
                </p>
                <PrimaryButton onClick={() => setNormStep("mapping")}>
                  Continue to Header Mapping <ArrowRight className="w-4 h-4 ml-2" />
                </PrimaryButton>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-2xl cursor-pointer hover:border-red-300 dark:hover:border-red-700 transition-colors">
                  <FileSpreadsheet className="w-10 h-10 text-neutral-400" />
                  <span className="text-sm font-medium text-neutral-600 dark:text-neutral-300">Upload Excel / CSV files</span>
                  <span className="text-xs text-neutral-400">Click to browse or drag files here</span>
                  <input type="file" multiple accept=".xlsx,.xls,.csv,.zip" className="hidden" onChange={handleFileUpload} />
                </label>
                {importedCsv && (
                  <button
                    onClick={() => handleImportFromStitching(importedCsv)}
                    className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-emerald-200 dark:border-emerald-800 rounded-2xl cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors bg-emerald-50/30 dark:bg-emerald-950/10"
                  >
                    <Columns className="w-10 h-10 text-emerald-500" />
                    <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Import from Data Stitching</span>
                    <span className="text-xs text-emerald-500">Use merged dataset from Module 1</span>
                  </button>
                )}
              </div>
            )}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Processing files...
              </div>
            )}
          </div>
        </SurfaceCard>
      )}

      {/* HEADER MAPPING STEP */}
      {normStep === "mapping" && (
        <SurfaceCard title="Header Mapping" subtitle="Map your columns to standard procurement fields" icon={Columns}>
          <div className="space-y-4">
            <p className="text-sm text-neutral-500">
              AI will map your column headers to standard Bain procurement fields for consistent normalization.
            </p>
            {!mappingResult ? (
              <div className="flex gap-3">
                <PrimaryButton onClick={handleMapHeaders} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Auto-Map Headers
                </PrimaryButton>
                <SecondaryButton onClick={handleSkipMapping}>
                  Skip Mapping
                </SecondaryButton>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="max-h-80 overflow-y-auto border border-neutral-200 dark:border-neutral-700 rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 dark:bg-neutral-800 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-neutral-600 dark:text-neutral-300">Original Column</th>
                        <th className="px-4 py-2 text-left font-medium text-neutral-600 dark:text-neutral-300">Mapped To</th>
                        <th className="px-4 py-2 text-left font-medium text-neutral-600 dark:text-neutral-300">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(mappingResult.mappings || {}).flatMap(([sheet, mappings]: [string, any]) =>
                        Object.entries(mappings).map(([original, mapped]: [string, any]) => (
                          <tr key={`${sheet}-${original}`} className="border-t border-neutral-100 dark:border-neutral-800">
                            <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300 font-mono text-xs">{original}</td>
                            <td className="px-4 py-2 text-neutral-900 dark:text-neutral-100 font-medium">{String(mapped)}</td>
                            <td className="px-4 py-2">
                              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                                AI match
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-3">
                  <PrimaryButton onClick={handleApplyMappings} disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Apply Mappings
                  </PrimaryButton>
                  <SecondaryButton onClick={handleSkipMapping}>Skip</SecondaryButton>
                </div>
              </div>
            )}
          </div>
        </SurfaceCard>
      )}

      {/* OPERATIONS STEP */}
      {normStep === "operations" && (
        <div className="space-y-4">
          <SurfaceCard title="Normalization Operations" subtitle="Run AI-powered data cleaning agents" icon={Sparkles}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {OPERATIONS.map(op => {
                const Icon = op.icon;
                const isCompleted = completedOps.has(op.id);
                const isRunning = activeOp === op.id;
                return (
                  <motion.button
                    key={op.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => !isRunning && handleRunOperation(op.id)}
                    disabled={isRunning}
                    className={`relative p-4 rounded-2xl border text-left transition-all ${
                      isCompleted
                        ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                        : isRunning
                        ? "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
                        : "border-neutral-200 dark:border-neutral-700 hover:border-red-200 dark:hover:border-red-800 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isCompleted ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400" :
                        isRunning ? "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400" :
                        "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                      }`}>
                        {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> :
                         isCompleted ? <CheckCircle2 className="w-4 h-4" /> :
                         <Icon className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{op.label}</p>
                        <p className="text-xs text-neutral-500 mt-0.5">{op.desc}</p>
                      </div>
                    </div>
                    {opResults[op.id]?.message && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 pl-12">{opResults[op.id].message}</p>
                    )}
                  </motion.button>
                );
              })}

              {/* Spend / FX conversion card */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => !spendConfig ? handleDetectSpend() : handleNormalizeSpend()}
                disabled={activeOp === "normalize-spend"}
                className={`relative p-4 rounded-2xl border text-left transition-all ${
                  completedOps.has("normalize-spend")
                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                    : "border-neutral-200 dark:border-neutral-700 hover:border-red-200 dark:hover:border-red-800 hover:shadow-sm"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    completedOps.has("normalize-spend") ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40" :
                    activeOp === "normalize-spend" ? "bg-amber-100 text-amber-600" :
                    "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                  }`}>
                    {activeOp === "normalize-spend" ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Spend / FX Conversion</p>
                    <p className="text-xs text-neutral-500 mt-0.5">{spendConfig ? "Convert currencies to USD" : "Detect & convert currencies"}</p>
                  </div>
                </div>
              </motion.button>
            </div>
          </SurfaceCard>

          {/* Pending operation preview */}
          {pendingPreview && (
            <SurfaceCard title="Preview Changes" subtitle="Review before applying" icon={Eye}>
              <div className="space-y-3">
                <p className="text-sm text-neutral-600 dark:text-neutral-400">{pendingPreview.message}</p>
                <div className="flex gap-3">
                  <PrimaryButton onClick={handleApplyPending} disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                    Apply Changes
                  </PrimaryButton>
                  <SecondaryButton onClick={handleDiscardPending}>Discard</SecondaryButton>
                </div>
              </div>
            </SurfaceCard>
          )}

          <div className="flex justify-end">
            <PrimaryButton onClick={() => setNormStep("download")}>
              Proceed to Download <ArrowRight className="w-4 h-4 ml-2" />
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* DOWNLOAD STEP */}
      {normStep === "download" && (
        <SurfaceCard title="Download Normalized Data" subtitle="Export your cleaned and standardized dataset" icon={Download}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 text-sm">
              {Array.from(completedOps).map(op => (
                <span key={op} className="px-3 py-1 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-full text-xs font-medium">
                  <CheckCircle2 className="w-3 h-3 inline mr-1" />{op.replace("fix-", "").replace("-", " ")}
                </span>
              ))}
              {completedOps.size === 0 && (
                <span className="text-neutral-400 text-xs">No normalization operations were applied</span>
              )}
            </div>
            <div className="flex gap-3">
              <PrimaryButton onClick={handleDownload} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                Download Excel
              </PrimaryButton>
              <SecondaryButton onClick={() => setNormStep("operations")}>
                Back to Operations
              </SecondaryButton>
            </div>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
