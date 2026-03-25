import React, { useState, useCallback, useRef, useEffect } from "react";
import { Database, AlertCircle, CheckCircle2, KeyRound, RefreshCw, MessageSquare, Sun, Moon, Table2, Sparkles } from "lucide-react";

import { AnimatePresence, motion } from "motion/react";
import DataLoading from "./components/DataLoading";
import DataCleaning from "./components/DataCleaning";
import HeaderNormalisation from "./components/HeaderNormalisation";
import Appending from "./components/Appending";
import Merging from "./components/Merging";
import Procurement from "./components/Procurement";
import Analysis from "./components/Analysis";
import LoadingOverlay from "./components/LoadingOverlay";
import StatusLog, { type LogEntry } from "./components/StatusLog";
import ChatPanel from "./components/ChatPanel";
import { StepHero, pageVariants, horizontalVariants } from "./components/ui";
import DataPreviewOverlay from "./components/DataPreviewOverlay";
import { useTheme } from "./components/ThemeProvider";
import NormDashboard from "./modules/normalization/NormDashboard";
import ErrorBoundary from "./components/ErrorBoundary";

type ActiveModule = "stitching" | "normalization";
type StitchingMode = "pipeline" | "modular";
type OperationId =
  | "header_norm_run"
  | "header_norm_apply"
  | "append_plan"
  | "append_mapping"
  | "append_execute"
  | "analysis_run"
  | "procurement_mapping"
  | "append_datasets"
  | "header_normalize"
  | "append";

function jsonSafeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, currentValue) => {
    if (currentValue instanceof Date) {
      return currentValue.toISOString();
    }
    return currentValue;
  });
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [activeModule, setActiveModule] = useState<ActiveModule>("stitching");
  const [stitchingMode, setStitchingMode] = useState<StitchingMode>("pipeline");
  const [importedCsvForNorm, setImportedCsvForNorm] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [lastFailedAction, setLastFailedAction] = useState<(() => void) | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [statusLog, setStatusLog] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const prevStepRef = useRef(step);

  const cancelAiRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const addLog = useCallback((stepName: string, type: LogEntry["type"], message: string) => {
    setStatusLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: new Date(), step: stepName, type, message }]);
  }, []);

  const slideDirection = step >= prevStepRef.current ? 1 : -1;
  useEffect(() => {
    setLoading(false);
    setAiLoading(false);
    setError(null);
    setLastFailedAction(null);
    setMaxStepReached(prev => Math.max(prev, step));
    prevStepRef.current = step;
  }, [step]);

  // Safety net: auto-clear aiLoading if stuck for more than 5 minutes
  const AI_LOADING_TIMEOUT_MS = 5 * 60 * 1000;
  useEffect(() => {
    if (!aiLoading) return;
    const timer = setTimeout(() => {
      setAiLoading(false);
      setLoading(false);
    }, AI_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [aiLoading]);

  // Step 2: Inventory
  const [inventory, setInventory] = useState<any[]>([]);
  const [previews, setPreviews] = useState<Record<string, { columns: string[]; rows: any[] }>>({});
  const [showDataPreview, setShowDataPreview] = useState(false);
  const [showResultsPreview, setShowResultsPreview] = useState(false);
  const [resultsPreviews, setResultsPreviews] = useState<Record<string, { columns: string[]; rows: any[] }>>({});
  const [resultsInventory, setResultsInventory] = useState<any[]>([]);
  const [uploadWarnings, setUploadWarnings] = useState<{ file: string; message: string }[]>([]);

  // Step 3: Append Strategy (groups + mapping)
  const [appendGroups, setAppendGroups] = useState<any[]>([]);
  const [unassigned, setUnassigned] = useState<any[]>([]);
  const [excludedTables, setExcludedTables] = useState<string[]>([]);
  const [appendGroupMappings, setAppendGroupMappings] = useState<any[]>([]);
  const groupNameMap: Record<string, string> = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of appendGroups) {
      if (g.group_id && g.group_name) map[g.group_id] = g.group_name;
    }
    return map;
  }, [appendGroups]);
  const [groupSchema, setGroupSchema] = useState<any[]>([]);
  const [appendReport, setAppendReport] = useState<any[] | null>(null);

  // Step 4: Header Normalisation
  const [headerNormDecisions, setHeaderNormDecisions] = useState<any>(null);
  const [headerNormStandardFields, setHeaderNormStandardFields] = useState<any[]>([]);
  const [groupPreviewData, setGroupPreviewData] = useState<Record<string, { columns: string[]; rows: any[]; total_rows: number }>>({});

  // Step 5: Data Cleaning (per-table)
  const [cleaningConfigs, setCleaningConfigs] = useState<Record<string, any>>({});

  // Step 6-7: Guided Merge
  const [mergeBaseGroupId, setMergeBaseGroupId] = useState<string>("");
  const [mergeBaseRecommendation, setMergeBaseRecommendation] = useState<any>(null);
  const [mergeSourceGroupIds, setMergeSourceGroupIds] = useState<string[]>([]);
  const [mergeCurrentSourceIdx, setMergeCurrentSourceIdx] = useState(0);
  const [mergeCommonColumns, setMergeCommonColumns] = useState<any[]>([]);
  const [mergeSelectedKeys, setMergeSelectedKeys] = useState<Array<{base_col: string; source_col: string}>>([]);
  const [mergePullColumns, setMergePullColumns] = useState<string[]>([]);
  const [mergeSimulation, setMergeSimulation] = useState<any>(null);
  const [mergeValidationReport, setMergeValidationReport] = useState<any>(null);
  const [mergeResult, setMergeResult] = useState<any>(null);
  const [mergeApprovedSources, setMergeApprovedSources] = useState<any[]>([]);
  const [mergeHistory, setMergeHistory] = useState<any[]>([]);

  // Step 8: Analysis
  const [analysisResults, setAnalysisResults] = useState<any | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // Step 9: Procurement Mapping
  const [procurementMappings, setProcurementMappings] = useState<any[]>([]);
  const [standardFields, setStandardFields] = useState<any[]>([]);
  const [viewCategories, setViewCategories] = useState<any>({});
  const [viewRequirements, setViewRequirements] = useState<any>({});

  // Step 10: Procurement Views
  const [possibleViews, setPossibleViews] = useState<any>({});

  // Group Insights
  const [groupInsights, setGroupInsights] = useState<Record<string, any>>({});
  const [groupReports, setGroupReports] = useState<any[]>([]);
  const [crossGroupOverview, setCrossGroupOverview] = useState<any | null>(null);
  const [groupInsightsLoading, setGroupInsightsLoading] = useState(false);

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [selectedChatItem, setSelectedChatItem] = useState<{ type: string; id: string; label: string } | null>(null);
  const [modularOperation, setModularOperation] = useState<OperationId>("header_normalize");
  const [modularSelectedTables, setModularSelectedTables] = useState<string[]>([]);
  const [modularLastResult, setModularLastResult] = useState<any>(null);

  const onSelectChatItem = useCallback((item: { type: string; id: string; label: string }) => {
    setSelectedChatItem(item);
    setChatOpen(true);
  }, []);

  const insightsAbortRef = useRef<AbortController | null>(null);

  const fetchGroupInsights = useCallback(async (sid: string, key: string) => {
    insightsAbortRef.current?.abort();
    const controller = new AbortController();
    insightsAbortRef.current = controller;
    setGroupInsightsLoading(true);
    try {
      const res = await fetch("/api/group-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, apiKey: key }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to fetch group insights");
      const data = await res.json();
      setGroupInsights(data.insights || {});
      setGroupReports(data.groupReports || []);
      setCrossGroupOverview(data.crossGroupOverview || null);
      addLog("Group Insights", "success", `Generated insights for ${Object.keys(data.insights || {}).length} group(s)`);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error("Group insights error:", err);
      addLog("Group Insights", "error", err.message);
    } finally {
      setGroupInsightsLoading(false);
      if (insightsAbortRef.current === controller) insightsAbortRef.current = null;
    }
  }, [addLog]);

  const fetchGroupPreviewForHeaderNorm = useCallback(async (groupIds: string[]) => {
    if (!sessionId || groupIds.length === 0) return;
    try {
      const res = await fetch("/api/header-norm-group-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, groupIds, limit: 50 }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const previews = data.previews || [];
      setGroupPreviewData((prev) => {
        const next = { ...prev };
        for (const p of previews) {
          next[p.group_id] = { columns: p.columns || [], rows: p.rows || [], total_rows: p.total_rows || 0 };
        }
        return next;
      });
    } catch (err) {
      console.error("Group preview fetch error:", err);
    }
  }, [sessionId]);

  const STORAGE_KEY = "datastitcher_session";
  const APIKEY_STORAGE_KEY = "datastitcher_apikey";

  // Persist apiKey separately in localStorage so it survives across sessions
  useEffect(() => {
    try {
      const saved = localStorage.getItem(APIKEY_STORAGE_KEY);
      if (saved) setApiKey(saved);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (apiKey) localStorage.setItem(APIKEY_STORAGE_KEY, apiKey);
      else localStorage.removeItem(APIKEY_STORAGE_KEY);
    } catch { /* ignore */ }
  }, [apiKey]);

  // Hydrate lightweight state from sessionStorage, then recover full state from backend
  useEffect(() => {
    let cancelled = false;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.stitchingMode === "pipeline" || s.stitchingMode === "modular") setStitchingMode(s.stitchingMode);
      if (s.step) { setStep(s.step); setMaxStepReached(s.maxStepReached || s.step); }
      if (s.excludedTables) setExcludedTables(s.excludedTables);
      if (s.cleaningConfigs) setCleaningConfigs(s.cleaningConfigs);
      if (s.possibleViews) setPossibleViews(s.possibleViews);

      const sid = s.sessionId;
      if (!sid) return;
      setSessionId(sid);

      (async () => {
        try {
          const res = await fetch(`/api/execution/state?sessionId=${encodeURIComponent(sid)}`);
          if (!res.ok || cancelled) {
            sessionStorage.removeItem(STORAGE_KEY);
            setSessionId("");
            setStep(1);
            setMaxStepReached(1);
            return;
          }
          const data = await res.json();
          if (cancelled) return;
          const patch = data.statePatch || {};
          if (!patch.inventory || (Array.isArray(patch.inventory) && patch.inventory.length === 0)) {
            sessionStorage.removeItem(STORAGE_KEY);
            setSessionId("");
            setStep(1);
            setMaxStepReached(1);
            return;
          }
          applyStatePatch(patch);
        } catch {
          sessionStorage.removeItem(STORAGE_KEY);
          setSessionId("");
          setStep(1);
          setMaxStepReached(1);
        }
      })();
    } catch { /* ignore corrupt storage */ }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist to sessionStorage on state changes (clears when tab closes)
  useEffect(() => {
    if (!sessionId) return;
    try {
      const persistable = {
        stitchingMode,
        sessionId, step, maxStepReached,
        inventory, previews, uploadWarnings,
        cleaningConfigs,
        headerNormDecisions, headerNormStandardFields,
        appendGroups, unassigned, excludedTables,
        appendGroupMappings, groupSchema, appendReport, groupInsights, groupReports, crossGroupOverview,
        analysisResults,
        mergeBaseGroupId, mergeSourceGroupIds, mergeApprovedSources, mergeHistory,
        mergeResult: mergeResult ? { ...mergeResult, csv: undefined } : null,
        procurementMappings, standardFields, viewCategories, viewRequirements,
        possibleViews,
      };
      sessionStorage.setItem(STORAGE_KEY, jsonSafeStringify(persistable));
    } catch { /* storage full or serialization error */ }
  }, [
    stitchingMode,
    sessionId, step, maxStepReached,
    inventory, previews, uploadWarnings,
    cleaningConfigs,
    headerNormDecisions, headerNormStandardFields,
    appendGroups, unassigned, excludedTables,
    appendGroupMappings, groupSchema, appendReport, groupInsights, groupReports, crossGroupOverview,
    analysisResults,
    mergeBaseGroupId, mergeSourceGroupIds, mergeApprovedSources, mergeResult, mergeHistory,
    procurementMappings, standardFields, viewCategories, viewRequirements,
    possibleViews,
  ]);

  // Warn before page unload when session is active
  useEffect(() => {
    if (!sessionId) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sessionId]);

  const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300 MB

  const applyStatePatch = useCallback((patch: any) => {
    if (!patch || typeof patch !== "object") return;
    if (patch.inventory) setInventory(patch.inventory);
    if (patch.previews) setPreviews(patch.previews);
    if (patch.filesPayload) {
      // no direct UI state for filesPayload; kept in backend as source-of-truth
    }
    if (patch.headerNormDecisions) setHeaderNormDecisions(patch.headerNormDecisions);
    if (patch.headerNormStandardFields) setHeaderNormStandardFields(patch.headerNormStandardFields);
    if (patch.appendGroups) setAppendGroups(patch.appendGroups);
    if (patch.appendGroupMappings) setAppendGroupMappings(patch.appendGroupMappings);
    if (patch.unassigned) setUnassigned(patch.unassigned);
    if (patch.groupSchema) setGroupSchema(patch.groupSchema);
    if (!patch.groupSchema && patch.groupSchemaTableRows) setGroupSchema(patch.groupSchemaTableRows);
    if (patch.mergeBaseGroupId) setMergeBaseGroupId(patch.mergeBaseGroupId);
    if (patch.mergeApprovedSources) setMergeApprovedSources(patch.mergeApprovedSources);
    if (patch.mergeResult) setMergeResult(patch.mergeResult);
    if (patch.analysisResults) setAnalysisResults(patch.analysisResults);
    // date state removed - procurement analysis replaces it
    if (patch.procurementMappings) setProcurementMappings(patch.procurementMappings);
    if (patch.standardFields) setStandardFields(patch.standardFields);
    if (patch.viewCategories) setViewCategories(patch.viewCategories);
    if (patch.viewRequirements) setViewRequirements(patch.viewRequirements);
  }, []);

  const runOperation = useCallback(async (
    operation: OperationId,
    input: Record<string, any> = {},
    options: {
      mode?: "pipeline" | "modular";
      autoPrepare?: boolean;
      persist?: boolean;
      directUploadFile?: File | null;
    } = {},
  ) => {
    let sid = sessionId;

    if (options.directUploadFile) {
      const uploadFile = options.directUploadFile;
      if (uploadFile.size > MAX_FILE_SIZE) {
        throw new Error(`File is too large (${(uploadFile.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 300 MB.`);
      }
      const formData = new FormData();
      formData.append("file", uploadFile);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error((await uploadRes.json()).error || "Failed to upload file");
      const uploadData = await uploadRes.json();
      sid = uploadData.sessionId;
      setSessionId(sid);
      setInventory(uploadData.inventory || []);
      setPreviews(uploadData.previews || {});
      setUploadWarnings(uploadData.warnings || []);
      addLog("Modular Upload", "success", `Uploaded ${uploadData.inventory?.length || 0} table(s)`);
    }

    if (!sid) throw new Error("Missing session. Upload a file first.");

    const res = await fetch("/api/execution/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sid,
        operation,
        apiKey,
        input,
        options: {
          mode: options.mode || "pipeline",
          autoPrepare: options.autoPrepare ?? true,
          persist: options.persist ?? true,
        },
      }),
    });

    const payload = await res.json();
    if (!res.ok || payload?.ok === false) {
      const missing = payload?.missing_requirements;
      if (Array.isArray(missing) && missing.length > 0) {
        throw new Error(`Missing requirements: ${missing.join(", ")}`);
      }
      throw new Error(payload?.error || "Operation failed.");
    }

    if (payload?.sessionId) {
      setSessionId(payload.sessionId);
    }
    applyStatePatch(payload.statePatch || {});
    setModularLastResult(payload);
    return payload;
  }, [sessionId, apiKey, applyStatePatch, addLog]);

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a file or folder to upload.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 300 MB.`);
      return;
    }
    setLoading(true);
    setLoadingMessage("Uploading and extracting your data...");
    setError(null);
    addLog("Upload", "info", "Uploading and extracting data...");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to upload file");
      const data = await res.json();
      setSessionId(data.sessionId);
      setInventory(data.inventory);
      setPreviews(data.previews || {});
      setUploadWarnings(data.warnings || []);
      addLog("Upload", "success", `Extracted ${data.inventory.length} tables from archive`);
      if (data.warnings?.length > 0) {
        for (const w of data.warnings) {
          addLog("Upload", "error", `Failed to parse "${w.file}": ${w.message}`);
        }
      }
      setStep(2);
    } catch (err: any) {
      setError(err.message);
      addLog("Upload", "error", err.message);
      setLastFailedAction(() => handleUpload);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTable = async (tableKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/delete-table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, tableKey }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete table");
      const data = await res.json();
      setInventory(data.inventory);
      setPreviews(data.previews || {});
      addLog("Inventory", "success", `Deleted table "${tableKey}"`);
    } catch (err: any) {
      setError(err.message);
      addLog("Inventory", "error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRows = async (tableKey: string, rowIds: (string | number)[]) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/delete-rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, tableKey, rowIds }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete rows");
      const data = await res.json();
      if (data.preview) setPreviews((prev) => ({ ...prev, [tableKey]: data.preview }));
      if (data.inventoryRow) {
        setInventory((prev) => prev.map((inv) => inv.table_key === tableKey ? data.inventoryRow : inv));
      }
      addLog("Inventory", "success", `Deleted ${data.deletedCount || rowIds.length} row(s) from "${tableKey}"`);
    } catch (err: any) {
      setError(err.message);
      addLog("Inventory", "error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetHeaderRow = async (tableKey: string, headerRowIndex: number, customColumnNames?: Record<number, string>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/set-header-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, tableKey, headerRowIndex, customColumnNames }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to set header row");
      const data = await res.json();
      setInventory(data.inventory);
      setPreviews(data.previews || {});
      addLog("Inventory", "success", `Header row set to row ${headerRowIndex} for "${tableKey}"`);
    } catch (err: any) {
      setError(err.message);
      addLog("Inventory", "error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCleanTable = async (tableKey: string, config: any) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/clean-table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, tableKey, config }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to clean table");
      const data = await res.json();
      setPreviews((prev) => ({ ...prev, [tableKey]: data.preview }));
      if (data.inventoryRow) {
        setInventory((prev) => prev.map((inv) => inv.table_key === tableKey ? data.inventoryRow : inv));
      }
      setCleaningConfigs((prev) => ({ ...prev, [tableKey]: config }));
      addLog("Data Cleaning", "success", `Cleaned table "${tableKey}"`);
    } catch (err: any) {
      setError(err.message);
      addLog("Data Cleaning", "error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCleanGroup = async (groupId: string, config: any) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/clean-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, groupId, config }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to clean group");
      const data = await res.json();
      if (data.groupRow) {
        setGroupSchema((prev) => prev.map((gs) => gs.group_id === groupId ? { ...gs, ...data.groupRow } : gs));
      }
      setCleaningConfigs((prev) => ({ ...prev, [groupId]: config }));
      addLog("Data Cleaning", "success", `Cleaned group "${groupNameMap[groupId] || groupId}"`);
    } catch (err: any) {
      setError(err.message);
      addLog("Data Cleaning", "error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchResultsPreviews = async () => {
    if (!sessionId) return;
    try {
      if (groupSchema.length > 0) {
        const groupIds = groupSchema.map((g: any) => g.group_id);
        let data: any = null;

        const hnRes = await fetch("/api/header-norm-group-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, groupIds }),
        });
        if (hnRes.ok) {
          const hnData = await hnRes.json();
          const previews = hnData.previews || [];
          if (previews.length > 0) {
            const mapped: any = {};
            for (const p of previews) { mapped[p.group_id] = p; }
            if (groupIds.some((gid: string) => mapped[gid])) {
              data = mapped;
            }
          }
        }

        if (!data) {
          const gpRes = await fetch("/api/group-preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, groupIds }),
          });
          if (gpRes.ok) {
            data = await gpRes.json();
          }
        }

        if (data) {
          const newPreviews: Record<string, { columns: string[]; rows: any[] }> = {};
          const newInv: any[] = [];
          for (const gid of groupIds) {
            if (data[gid]) {
              const displayName = groupNameMap[gid] || gid;
              newPreviews[displayName] = { columns: data[gid].columns, rows: data[gid].rows };
              newInv.push({ table_key: displayName, rows: data[gid].total_rows || data[gid].rows.length, cols: data[gid].columns.length });
            }
          }
          setResultsPreviews(newPreviews);
          setResultsInventory(newInv);
        }
      }
    } catch { /* ignore */ }
    setShowResultsPreview(true);
  };

  const handleHeaderNormRun = async () => {
    if (!apiKey?.trim()) {
      setError("Please enter your API key to use AI features.");
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    setAiLoading(true);
    setLoadingMessage("AI is mapping your column headers to the standard procurement schema...");
    setError(null);
    addLog("Header Normalisation", "info", "Profiling columns and running AI mapping...");
    try {
      if (controller.signal.aborted) throw new DOMException("Request cancelled.", "AbortError");
      const exec = await runOperation("header_norm_run", {}, { mode: "pipeline", autoPrepare: true, persist: true });
      const data = exec?.result || {};
      setHeaderNormDecisions(data.tables || []);
      setHeaderNormStandardFields(data.standardFields || []);
      // Cascade-reset downstream step (cleaning)
      setCleaningConfigs({});
      const totalCols = (data.tables || []).reduce((s: number, t: any) => s + (t.decisions?.length || 0), 0);
      addLog("Header Normalisation", "success", `Mapped ${totalCols} columns across ${data.tables?.length || 0} table(s)`);
      const normGroupIds = (data.tables || []).map((t: any) => t.tableKey);
      if (normGroupIds.length > 0) fetchGroupPreviewForHeaderNorm(normGroupIds);
    } catch (err: any) {
      const message = err?.name === "AbortError" ? "Request cancelled." : err.message;
      setError(message);
      addLog("Header Normalisation", "error", message);
      setLastFailedAction(() => handleHeaderNormRun);
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      setAiLoading(false);
    }
  };

  const handleHeaderNormApply = async (decisions: Record<string, any[]>) => {
    setLoading(true);
    setLoadingMessage("Applying header mappings...");
    setError(null);
    addLog("Header Normalisation", "info", "Applying approved header mappings...");
    try {
      const exec = await runOperation("header_norm_apply", { decisions }, { mode: "pipeline", autoPrepare: true, persist: true });
      const data = exec?.result || {};
      const applied = data.appliedTables || [];
      const totalMapped = applied.reduce((s: number, t: any) => s + (t.mapped || 0), 0);
      addLog("Header Normalisation", "success", `Applied mappings to ${applied.length} table(s), ${totalMapped} columns renamed`);
      // Cascade-reset downstream step (cleaning configs reference old column names)
      setCleaningConfigs({});
      setStep(5);
    } catch (err: any) {
      setError(err.message);
      addLog("Header Normalisation", "error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAppendPlan = async () => {
    if (!apiKey?.trim()) {
      setError("Please enter your API key above to use AI features.");
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    setAiLoading(true);
    setLoadingMessage("AI is analyzing file structures to group related tables...");
    setError(null);
    addLog("Append Plan", "info", "AI analyzing file structures to group related tables...");
    try {
      if (controller.signal.aborted) throw new DOMException("Request cancelled.", "AbortError");
      const exec = await runOperation("append_plan", {}, { mode: "pipeline", autoPrepare: true, persist: true });
      const data = exec?.result || {};
      let finalGroups = data.appendGroups || [];
      let finalUnassigned = data.unassigned || [];

      if (finalUnassigned.length > 0) {
        const ts = Date.now();
        const autoGroups = finalUnassigned.map((u: any, i: number) => {
          const parts = String(u.table_key).split("::");
          const fileName = (parts[0] || "").split("/").pop() || `File ${i + 1}`;
          return {
            group_id: `auto_group_${i + 1}_${ts}`,
            group_name: fileName,
            tables: [u.table_key],
            reason: u.reason || "Auto-grouped (no matching tables found)",
          };
        });
        finalGroups = [...finalGroups, ...autoGroups];
        finalUnassigned = [];
        syncGroupsToServer(finalGroups, finalUnassigned);
        addLog("Append Plan", "info", `Auto-created ${autoGroups.length} group(s) for unassigned tables`);
      }

      setAppendGroups(finalGroups);
      setUnassigned(finalUnassigned);
      setAppendGroupMappings([]);
      setGroupSchema([]);
      setAppendReport(null);
      // Cascade-reset downstream steps (header norm, cleaning, merge)
      setHeaderNormDecisions(null);
      setHeaderNormStandardFields([]);
      setGroupPreviewData({});
      setCleaningConfigs({});
      setMergeBaseGroupId("");
      setMergeSourceGroupIds([]);
      setMergeApprovedSources([]);
      setMergeResult(null);
      setGroupInsights({});
      setGroupReports([]);
      setCrossGroupOverview(null);
      addLog("Append Plan", "success", `Created ${finalGroups.length} group(s), ${finalUnassigned.length} unassigned`);
      setStep(3);
    } catch (err: any) {
      const message = err?.name === "AbortError" ? "Request cancelled. Please try again." : err.message;
      setError(message);
      addLog("Append Plan", "error", message);
      setLastFailedAction(() => handleGenerateAppendPlan);
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      setAiLoading(false);
    }
  };

  const syncGroupsToServer = useCallback((groups: any[], unassignedItems: any[]) => {
    if (!sessionId) return;
    fetch("/api/save-append-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, appendGroups: groups, unassigned: unassignedItems }),
    }).catch(err => console.error("Failed to sync groups to server:", err));
  }, [sessionId]);

  const moveTableToGroup = (tableKey: string, targetGroupId: string | null) => {
    let tableData: any = null;
    
    // Find the table and remove it from its current location
    const newAppendGroups = appendGroups.map(group => {
      if (group.tables.includes(tableKey)) {
        tableData = { table_key: tableKey, reason: "Manually moved" };
        return { ...group, tables: group.tables.filter((t: string) => t !== tableKey) };
      }
      return group;
    }).filter(group => group.tables.length > 0);

    const newUnassigned = unassigned.filter(u => {
      if (u.table_key === tableKey) {
        tableData = u;
        return false;
      }
      return true;
    });

    if (!tableData) return;

    if (targetGroupId === null) {
      const finalUnassigned = [...newUnassigned, tableData];
      setUnassigned(finalUnassigned);
      setAppendGroups(newAppendGroups);
      syncGroupsToServer(newAppendGroups, finalUnassigned);
    } else {
      const updatedGroups = newAppendGroups.map(group => {
        if (group.group_id === targetGroupId) {
          return { ...group, tables: [...group.tables, tableKey] };
        }
        return group;
      });
      setAppendGroups(updatedGroups);
      setUnassigned(newUnassigned);
      syncGroupsToServer(updatedGroups, newUnassigned);
    }
    setAppendGroupMappings([]);
  };

  const createNewGroup = (tableKeys: string[]) => {
    const newGroupId = `manual_group_${Date.now()}`;
    const newGroup = {
      group_id: newGroupId,
      group_name: `Custom Group (${tableKeys.length} files)`,
      tables: tableKeys,
      reason: "Manually created group"
    };

    // Remove tables from current locations
    const newAppendGroups = appendGroups.map(group => ({
      ...group,
      tables: group.tables.filter((t: string) => !tableKeys.includes(t))
    })).filter(group => group.tables.length > 0);

    const newUnassigned = unassigned.filter(u => !tableKeys.includes(u.table_key));

    const finalGroups = [...newAppendGroups, newGroup];
    setAppendGroups(finalGroups);
    setUnassigned(newUnassigned);
    setAppendGroupMappings([]);
    syncGroupsToServer(finalGroups, newUnassigned);
  };

  const excludeTable = (tableKey: string) => {
    const newGroups = appendGroups.map(g => ({
      ...g, tables: g.tables.filter((t: string) => t !== tableKey)
    })).filter(g => g.tables.length > 0);
    const newUnassigned = unassigned.filter(u => u.table_key !== tableKey);
    setAppendGroups(newGroups);
    setUnassigned(newUnassigned);
    setExcludedTables(prev => [...prev, tableKey]);
    setAppendGroupMappings([]);
    syncGroupsToServer(newGroups, newUnassigned);
  };

  const restoreTable = (tableKey: string) => {
    setExcludedTables(prev => prev.filter(t => t !== tableKey));
    const newUnassigned = [...unassigned, { table_key: tableKey, reason: "Restored" }];
    setUnassigned(newUnassigned);
    setAppendGroupMappings([]);
    syncGroupsToServer(appendGroups, newUnassigned);
  };

  const handleGenerateAppendMapping = async () => {
    if (!apiKey?.trim()) {
      setError("Please enter your API key to use AI features.");
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    setAiLoading(true);
    setLoadingMessage("AI is aligning column headers across your groups...");
    setError(null);
    addLog("Append Mapping", "info", "AI aligning column headers across groups...");
    try {
      if (controller.signal.aborted) throw new DOMException("Request cancelled.", "AbortError");
      const exec = await runOperation("append_mapping", { appendGroups }, { mode: "pipeline", autoPrepare: true, persist: true });
      const data = exec?.result || {};
      setAppendGroupMappings(data.appendGroupMappings);
      addLog("Append Mapping", "success", `Mappings generated for ${(data.appendGroupMappings || []).length} group(s)`);
    } catch (err: any) {
      const message = err?.name === "AbortError" ? "Request cancelled. Please try again." : err.message;
      setError(message);
      addLog("Append Mapping", "error", message);
      setLastFailedAction(() => handleGenerateAppendMapping);
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      setAiLoading(false);
    }
  };

  const handleExecuteAppend = async () => {
    setLoading(true);
    setLoadingMessage("Stacking your data into unified tables...");
    setError(null);
    addLog("Append Execute", "info", "Stacking data into unified tables...");
    try {
      const unassignedTables = unassigned.map(u => u.table_key);
      const exec = await runOperation(
        "append_execute",
        { appendGroupMappings, unassignedTables },
        { mode: "pipeline", autoPrepare: true, persist: true },
      );
      const data = exec?.result || {};
      setGroupSchema(data.groupSchema);
      setAppendReport(data.appendReport || null);
      // Cascade-reset downstream steps (header norm, cleaning)
      setHeaderNormDecisions(null);
      setHeaderNormStandardFields([]);
      setGroupPreviewData({});
      setCleaningConfigs({});
      addLog("Append Execute", "success", `Appended into ${(data.groupSchema || []).length} group(s)`);
    } catch (err: any) {
      setError(err.message);
      addLog("Append Execute", "error", err.message);
      setLastFailedAction(() => handleExecuteAppend);
    } finally {
      setLoading(false);
    }
  };

  const handleProceedToHeaderNorm = useCallback(() => {
    setStep(4);
  }, []);

  const handleRunAnalysis = useCallback(async () => {
    if (!apiKey?.trim()) return;
    setAnalysisLoading(true);
    setAnalysisResults(null);
    addLog("Analysis", "info", "Running procurement analysis...");
    try {
      const res = await fetch("/api/analysis/procurement-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, apiKey }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Analysis failed");
      const data = await res.json();
      setAnalysisResults(data);
      addLog("Analysis", "success", "Procurement analysis completed");
    } catch (err: any) {
      console.error("Analysis error:", err);
      addLog("Analysis", "error", err.message);
    } finally {
      setAnalysisLoading(false);
    }
  }, [sessionId, apiKey, addLog]);

  const handleGenerateProcurementMapping = async () => {
    if (!apiKey?.trim()) {
      setError("Please enter your API key to use AI features.");
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    setAiLoading(true);
    setLoadingMessage("AI is mapping your columns to standard procurement fields...");
    setError(null);
    addLog("Procurement Mapping", "info", "AI mapping columns to standard procurement fields...");
    try {
      if (controller.signal.aborted) throw new DOMException("Request cancelled.", "AbortError");
      const exec = await runOperation(
        "procurement_mapping",
        {},
        { mode: "pipeline", autoPrepare: true, persist: true },
      );
      const data = exec?.result || {};
      setProcurementMappings(data.mappings);
      setStandardFields(data.standardFields);
      setViewCategories(data.viewCategories);
      setViewRequirements(data.viewRequirements);
      addLog("Procurement Mapping", "success", `Mapped ${(data.mappings || []).length} columns`);
      setStep(9);
    } catch (err: any) {
      const message = err?.name === "AbortError" ? "Request cancelled. Please try again." : err.message;
      setError(message);
      addLog("Procurement Mapping", "error", message);
      setLastFailedAction(() => handleGenerateProcurementMapping);
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      setAiLoading(false);
    }
  };

  const handleRegisterMergedGroup = useCallback((groupId: string, groupName: string, groupRow: any) => {
    setGroupSchema((prev) => [...prev, groupRow]);
    setAppendGroups((prev) => [...prev, { group_id: groupId, group_name: groupName }]);
  }, []);

  const DATE_FIELDS = [
    "Invoice Date", "Goods Receipt Date", "Payment date",
    "PO Document Date", "Contract End Date", "Contract Start Date",
  ];
  const AMOUNT_FIELDS = [
    "Total Amount paid in Local Currency", "Total Amount paid in Reporting Currency",
    "PO Total Amount in Local Currency", "PO Total Amount in reporting currency",
  ];

  const handleAnalyzeViews = () => {
    const mappedFields = new Set(procurementMappings.map(m => m.best_match).filter(Boolean));
    const hasAnyDate = DATE_FIELDS.some(f => mappedFields.has(f));
    const hasAnyAmount = AMOUNT_FIELDS.some(f => mappedFields.has(f));
    const views: any = {};

    for (const [viewName, requirements] of Object.entries(viewRequirements)) {
      const reqs = requirements as string[];
      const missing = reqs.filter(req => !mappedFields.has(req));

      if (missing.length === 0) {
        views[viewName] = { status: "full", missing: [] };
      } else {
        const unresolvable = missing.filter(req => {
          if (DATE_FIELDS.includes(req) && hasAnyDate) return false;
          if (AMOUNT_FIELDS.includes(req) && hasAnyAmount) return false;
          return true;
        });

        if (unresolvable.length === 0) {
          views[viewName] = { status: "partial", missing };
        } else {
          views[viewName] = { status: "none", missing };
        }
      }
    }

    setPossibleViews(views);
    const total = Object.keys(views).length;
    const full = Object.values(views).filter((v: any) => v.status === "full").length;
    const partial = Object.values(views).filter((v: any) => v.status === "partial").length;
    addLog("Procurement Views", "success", `Analyzed ${total} view(s), ${full} ready, ${partial} partially ready`);
    setStep(10);
  };

  const modularOperations: Array<{ id: OperationId; label: string; description: string; requiresApi: boolean; supportsTableSelection?: boolean }> = [
    { id: "header_normalize", label: "Header Normalisation", description: "AI normalises column headers across selected tables", requiresApi: true, supportsTableSelection: true },
    { id: "append", label: "Append Strategy", description: "AI groups, aligns headers, and appends selected tables", requiresApi: true, supportsTableSelection: true },
    { id: "analysis_run", label: "Analysis", description: "AI analyses the final merged dataset", requiresApi: true },
  ];

  const handleModularExecute = async () => {
    if (!sessionId) {
      setError("No active session. Upload data first.");
      return;
    }
    const opInfo = modularOperations.find((o) => o.id === modularOperation);
    if (opInfo?.requiresApi && !apiKey?.trim()) {
      setError("This operation requires an API key.");
      return;
    }
    setLoading(true);
    setAiLoading(Boolean(opInfo?.requiresApi));
    setLoadingMessage(`Running ${opInfo?.label || modularOperation}...`);
    setError(null);
    try {
      const parsedInput: Record<string, any> = {};
      if (modularSelectedTables.length > 0) {
        parsedInput.tableKeys = modularSelectedTables;
      }
      const exec = await runOperation(
        modularOperation,
        parsedInput,
        { mode: "modular", autoPrepare: true, persist: true },
      );
      setModularLastResult(exec);
      addLog("Modular", "success", `${opInfo?.label || modularOperation} completed successfully`);
    } catch (err: any) {
      setError(err.message || "Modular operation failed.");
      addLog("Modular", "error", err.message || "Operation failed");
    } finally {
      setLoading(false);
      setAiLoading(false);
    }
  };

  const AI_STEPS = new Set([3, 4, 6, 8, 9]);

  const sidebarItems = [
    { name: "Upload + Settings",     steps: [1],      sub: "Manual" },
    { name: "Inventory",             steps: [2],      sub: "Manual" },
    { name: "Append Strategy",       steps: [3],      sub: "AI-assisted" },
    { name: "Header Normalisation",  steps: [4],      sub: "AI-assisted" },
    { name: "Data Cleaning",         steps: [5],      sub: "Manual" },
    { name: "Merge",                 steps: [6, 7],   sub: "AI-assisted" },
    { name: "Analysis",              steps: [8],      sub: "AI-assisted" },
    { name: "Procurement Mapping",   steps: [9],      sub: "AI-assisted" },
    { name: "Procurement Views",     steps: [10],     sub: "Manual" },
  ];

  const getDisplayStep = (s: number) => s <= 5 ? s : s <= 7 ? 6 : s - 1;
  const animationKey = step;

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-white to-neutral-100 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans flex relative overflow-hidden">
      {/* Decorative background blurs */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-red-100/40 dark:bg-red-950/20 blur-3xl" />
        <div className="absolute -bottom-60 -left-40 h-[500px] w-[500px] rounded-full bg-rose-100/30 dark:bg-rose-950/15 blur-3xl" />
      </div>

      {/* Sidebar */}
      <aside className="w-72 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border-r border-neutral-200/80 dark:border-neutral-700/80 flex-shrink-0 flex flex-col z-10">
        <div className="p-6 border-b border-neutral-200/80 dark:border-neutral-700/80 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-rose-600 flex items-center justify-center shadow-md shadow-red-200/40">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white">DataStitcher</h1>
            <p className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium tracking-wide">Data pipeline assistant</p>
          </div>
        </div>

        {/* Module selector */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex rounded-2xl bg-neutral-100 dark:bg-neutral-800 p-1">
            <button
              onClick={() => setActiveModule("stitching")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeModule === "stitching"
                  ? "bg-white dark:bg-neutral-700 text-red-600 dark:text-red-400 shadow-sm"
                  : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              Stitching
            </button>
            <button
              onClick={() => setActiveModule("normalization")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeModule === "normalization"
                  ? "bg-white dark:bg-neutral-700 text-red-600 dark:text-red-400 shadow-sm"
                  : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Normalize
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {activeModule === "stitching" ? (
          <>
          <div className="px-2 mb-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-500 font-semibold mb-2">Execution Mode</p>
            <div className="flex rounded-xl bg-neutral-100 dark:bg-neutral-800 p-1">
              <button
                onClick={() => setStitchingMode("pipeline")}
                className={`flex-1 px-2 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
                  stitchingMode === "pipeline"
                    ? "bg-white dark:bg-neutral-700 text-red-600 dark:text-red-400 shadow-sm"
                    : "text-neutral-500 dark:text-neutral-400"
                }`}
              >
                Pipeline
              </button>
              <button
                onClick={() => setStitchingMode("modular")}
                className={`flex-1 px-2 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
                  stitchingMode === "modular"
                    ? "bg-white dark:bg-neutral-700 text-red-600 dark:text-red-400 shadow-sm"
                    : "text-neutral-500 dark:text-neutral-400"
                }`}
              >
                Modular
              </button>
            </div>
          </div>
          {stitchingMode === "pipeline" ? (
            <>
              <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-500 font-semibold mb-4 px-2">Workflow</p>
              <nav className="relative">
                <div className="absolute left-[18px] top-5 bottom-5 w-px bg-neutral-200 dark:bg-neutral-700 z-0" />
                <div className="space-y-1 relative z-10">
                  {sidebarItems.map((s, idx) => {
                    const displayNum = idx + 1;
                    const firstStep = s.steps[0];
                    const lastStep = s.steps[s.steps.length - 1];
                    const isActive = s.steps.includes(step);
                    const isCompleted = step > lastStep;
                    const isReachable = firstStep <= maxStepReached;
                    const isAi = s.steps.some(st => AI_STEPS.has(st));
                    const targetStep = s.steps.filter(st => st <= maxStepReached).pop() || firstStep;
                    return (
                      <motion.div
                        key={displayNum}
                        whileHover={isReachable ? { x: 2 } : undefined}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all ${
                          isActive ? "bg-red-50 dark:bg-red-950/30 ring-1 ring-red-200 dark:ring-red-800 shadow-sm cursor-pointer" :
                          isCompleted ? "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer" :
                          isReachable ? "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer" :
                          "text-neutral-300 dark:text-neutral-600 cursor-not-allowed"
                        }`}
                        onClick={() => { if (isReachable) setStep(isActive ? step : targetStep); }}
                        title={!isReachable ? "Complete previous steps first" : undefined}
                      >
                        <span className={`h-9 w-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${
                          isActive ? "bg-red-600 text-white shadow-md shadow-red-200 dark:shadow-red-900/30" :
                          isCompleted ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" :
                          isReachable ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400" :
                          "bg-neutral-50 text-neutral-300 dark:bg-neutral-800/50 dark:text-neutral-600"
                        }`}>
                          {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : displayNum}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-semibold truncate ${isActive ? "text-red-700 dark:text-red-400" : ""}`}>{s.name}</p>
                          <p className="text-[10px] text-neutral-400 dark:text-neutral-500">{isAi ? "AI-assisted" : "Manual"}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </nav>
            </>
          ) : (
            <>
              <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-500 font-semibold mb-3 px-2">Operations</p>
              <div className="space-y-1 px-1">
                {modularOperations.map((op) => (
                  <button
                    key={op.id}
                    onClick={() => setModularOperation(op.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition-colors ${
                      modularOperation === op.id
                        ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
                        : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 border border-transparent"
                    }`}
                  >
                    <div className="font-semibold">{op.label}</div>
                    <div className="text-[10px] opacity-60 mt-0.5">{op.description}</div>
                  </button>
                ))}
              </div>
            </>
          )}
          </>
          ) : (
          <>
          <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-500 font-semibold mb-4 px-2">Normalization</p>
          <nav className="space-y-1">
            {["Upload / Import", "Header Mapping", "Run Normalizations", "Download"].map((label, i) => (
              <div key={label} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl text-neutral-600 dark:text-neutral-400">
                <span className="h-9 w-9 rounded-xl flex items-center justify-center text-xs font-bold bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400 shrink-0">{i + 1}</span>
                <p className="text-sm font-semibold truncate">{label}</p>
              </div>
            ))}
          </nav>
          </>
          )}
        </div>
        <div
          className={`p-4 border-t border-neutral-200/80 dark:border-neutral-700/80 flex items-center gap-2.5 text-xs font-medium cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors ${
            apiKey ? "text-emerald-600" : "text-red-500"
          }`}
          onClick={() => { setActiveModule("stitching"); setStep(1); }}
          title={apiKey ? "API key is configured" : "Click to set API key"}
        >
          <KeyRound className="w-4 h-4" />
          {apiKey ? "API Key Set" : "API Key Missing"}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto space-y-6">

          {activeModule === "normalization" ? (
            <>
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-neutral-900 dark:text-white">Data Normalization</h2>
                  <p className="text-sm text-neutral-500 mt-1">AI-powered procurement data standardization</p>
                </div>
                <div className="flex gap-2">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={toggleTheme}
                    className="p-2.5 rounded-xl bg-white/80 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700 shadow-sm backdrop-blur-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors"
                  >
                    {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  </motion.button>
                </div>
              </div>
              <ErrorBoundary moduleName="Data Normalization">
                <NormDashboard
                  importedCsv={importedCsvForNorm}
                  onImportComplete={() => setImportedCsvForNorm(null)}
                  apiKey={apiKey}
                />
              </ErrorBoundary>
            </>
          ) : (
            <>
            {stitchingMode === "modular" && (
              <div className="space-y-4">
                <div className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">Modular Execution</h2>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-5">
                    Run any pipeline step independently on your session data.
                  </p>

                  {/* Operation cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
                    {modularOperations.map((op) => (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => setModularOperation(op.id)}
                        className={[
                          "text-left rounded-xl border px-4 py-3 text-xs transition-all",
                          modularOperation === op.id
                            ? "border-red-500 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-800"
                            : "border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-red-300",
                        ].join(" ")}
                      >
                        <div className="font-bold">{op.label}</div>
                        <div className="mt-0.5 opacity-60 text-[11px]">{op.description}</div>
                      </button>
                    ))}
                  </div>

                  {/* Table selection */}
                  {modularOperations.find((op) => op.id === modularOperation)?.supportsTableSelection && (
                    <div className="mb-5">
                      <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2">
                        Select Tables
                      </p>
                      <div className="max-h-48 overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700 p-2.5 space-y-1">
                        {inventory.length === 0 ? (
                          <p className="text-xs text-neutral-400 italic">No session tables. Upload data first via Pipeline mode.</p>
                        ) : (
                          <>
                            <label className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300 pb-1 border-b border-neutral-100 dark:border-neutral-800 mb-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={modularSelectedTables.length === inventory.length && inventory.length > 0}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setModularSelectedTables(inventory.map((row: any, idx: number) => String(row?.table_key || row?.tableKey || row?.name || row?.id || `table_${idx}`)));
                                  } else {
                                    setModularSelectedTables([]);
                                  }
                                }}
                              />
                              Select All ({inventory.length})
                            </label>
                            {inventory.map((row: any, idx: number) => {
                              const tableKey = String(row?.table_key || row?.tableKey || row?.name || row?.id || `table_${idx}`);
                              const checked = modularSelectedTables.includes(tableKey);
                              return (
                                <label key={tableKey} className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded px-1 py-0.5">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const on = e.target.checked;
                                      setModularSelectedTables((prev) =>
                                        on ? [...prev, tableKey] : prev.filter((t) => t !== tableKey),
                                      );
                                    }}
                                  />
                                  <span className="truncate">{tableKey}</span>
                                </label>
                              );
                            })}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { void handleModularExecute(); }}
                      disabled={loading || !sessionId}
                      className="px-5 py-2.5 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
                    >
                      {loading ? "Running..." : `Run ${modularOperations.find(o => o.id === modularOperation)?.label || "Operation"}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStitchingMode("pipeline")}
                      className="px-4 py-2.5 rounded-xl text-xs font-semibold border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                    >
                      Switch To Pipeline
                    </button>
                  </div>

                  {!sessionId && (
                    <p className="mt-3 text-xs text-amber-600 dark:text-amber-400 font-medium">
                      No active session. Switch to Pipeline mode and upload data first.
                    </p>
                  )}
                </div>

                {/* Result display */}
                {modularLastResult && (
                  <div className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Result</h3>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${modularLastResult?.ok ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400"}`}>
                        {modularLastResult?.ok ? "Success" : "Error"}
                      </span>
                    </div>
                    {modularLastResult?.ok && modularLastResult?.metrics && (
                      <div className="flex gap-3 mb-3 flex-wrap">
                        {Object.entries(modularLastResult.metrics as Record<string, any>).map(([op, m]: [string, any]) => (
                          <span key={op} className="text-[10px] bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded-lg text-neutral-500 dark:text-neutral-400">
                            {op}: {m?.duration_ms}ms
                          </span>
                        ))}
                      </div>
                    )}
                    <pre className="text-[11px] overflow-auto max-h-[400px] bg-neutral-50 dark:bg-neutral-800 rounded-xl p-3 border border-neutral-200 dark:border-neutral-700">
                      {JSON.stringify(modularLastResult?.result || modularLastResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
            {stitchingMode === "pipeline" && (
            <>
            <div className="flex justify-end gap-2">
              {Object.keys(previews).length > 0 && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowDataPreview(true)}
                  className="p-2.5 rounded-xl bg-white/80 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700 shadow-sm backdrop-blur-sm text-neutral-600 dark:text-neutral-300 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  title="Raw Data Preview"
                >
                  <Table2 className="w-4 h-4" />
                </motion.button>
              )}
              {groupSchema.length > 0 && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={fetchResultsPreviews}
                  className="p-2.5 rounded-xl bg-white/80 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700 shadow-sm backdrop-blur-sm text-neutral-600 dark:text-neutral-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                  title="Results Preview"
                >
                  <Database className="w-4 h-4" />
                </motion.button>
              )}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={toggleTheme}
                className="p-2.5 rounded-xl bg-white/80 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700 shadow-sm backdrop-blur-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors"
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {theme === "dark" ? (
                    <motion.span key="sun" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                      <Sun className="w-4 h-4" />
                    </motion.span>
                  ) : (
                    <motion.span key="moon" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.2 }}>
                      <Moon className="w-4 h-4" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>

            <StepHero step={step} displayStep={getDisplayStep(step)} isAi={AI_STEPS.has(step)} totalSteps={9} />

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-gradient-to-r from-red-50 to-white dark:from-red-950/30 dark:to-neutral-900 shadow-sm p-4 flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm font-medium text-red-700 dark:text-red-400 flex-1">{error}</p>
                {lastFailedAction && (
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { setError(null); lastFailedAction(); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors shrink-0 shadow-md shadow-red-200"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry
                  </motion.button>
                )}
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={animationKey}
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <DataLoading
                  step={step}
                  file={file}
                  setFile={setFile}
                  apiKey={apiKey}
                  setApiKey={setApiKey}
                  handleUpload={handleUpload}
                  loading={loading}
                  sessionId={sessionId}
                  inventory={inventory}
                  previews={previews}
                  uploadWarnings={uploadWarnings}
                  handleGenerateAppendPlan={handleGenerateAppendPlan}
                  onProceedToAppend={() => setStep(3)}
                  onDeleteTable={handleDeleteTable}
                  onSetHeaderRow={handleSetHeaderRow}
                  onSelectChatItem={onSelectChatItem}
                  onDeleteRows={handleDeleteRows}
                />

                {step === 3 && (
                  <Appending
                    step={step}
                    appendGroups={appendGroups}
                    unassigned={unassigned}
                    excludedTables={excludedTables}
                    appendGroupMappings={appendGroupMappings}
                    setAppendGroupMappings={setAppendGroupMappings}
                    previews={previews}
                    loading={loading}
                    handleGenerateAppendPlan={handleGenerateAppendPlan}
                    handleGenerateAppendMapping={handleGenerateAppendMapping}
                    handleExecuteAppend={handleExecuteAppend}
                    moveTableToGroup={moveTableToGroup}
                    createNewGroup={createNewGroup}
                    excludeTable={excludeTable}
                    restoreTable={restoreTable}
                    appendReport={appendReport}
                    handleProceedToHeaderNorm={handleProceedToHeaderNorm}
                    onSelectChatItem={onSelectChatItem}
                  />
                )}

                {step === 4 && (
                  <HeaderNormalisation
                    sessionId={sessionId}
                    apiKey={apiKey}
                    loading={loading}
                    decisions={headerNormDecisions}
                    standardFields={headerNormStandardFields}
                    groupSchema={groupSchema}
                    groupPreviewData={groupPreviewData}
                    groupNameMap={groupNameMap}
                    onRun={handleHeaderNormRun}
                    onApply={handleHeaderNormApply}
                    onSkip={() => setStep(5)}
                    onFetchGroupPreview={fetchGroupPreviewForHeaderNorm}
                  />
                )}

                <DataCleaning
                  step={step}
                  groupSchema={groupSchema}
                  groupNameMap={groupNameMap}
                  sessionId={sessionId}
                  cleaningConfigs={cleaningConfigs}
                  loading={loading}
                  onCleanGroup={handleCleanGroup}
                  onProceed={() => setStep(6)}
                  onSkip={() => setStep(6)}
                />

                {step >= 6 && step <= 7 && (
                  <AnimatePresence mode="wait" custom={slideDirection} initial={false}>
                    <motion.div
                      key={step}
                      custom={slideDirection}
                      variants={horizontalVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      <Merging
                        sessionId={sessionId}
                        apiKey={apiKey}
                        step={step}
                        setStep={setStep}
                        groupSchema={groupSchema}
                        groupNameMap={groupNameMap}
                        loading={loading}
                        setLoading={setLoading}
                        setAiLoading={setAiLoading}
                        setLoadingMessage={setLoadingMessage}
                        setError={setError}
                        addLog={addLog}
                        mergeBaseGroupId={mergeBaseGroupId}
                        setMergeBaseGroupId={setMergeBaseGroupId}
                        mergeBaseRecommendation={mergeBaseRecommendation}
                        setMergeBaseRecommendation={setMergeBaseRecommendation}
                        mergeSourceGroupIds={mergeSourceGroupIds}
                        setMergeSourceGroupIds={setMergeSourceGroupIds}
                        mergeCurrentSourceIdx={mergeCurrentSourceIdx}
                        setMergeCurrentSourceIdx={setMergeCurrentSourceIdx}
                        mergeCommonColumns={mergeCommonColumns}
                        setMergeCommonColumns={setMergeCommonColumns}
                        mergeSelectedKeys={mergeSelectedKeys}
                        setMergeSelectedKeys={setMergeSelectedKeys}
                        mergePullColumns={mergePullColumns}
                        setMergePullColumns={setMergePullColumns}
                        mergeSimulation={mergeSimulation}
                        setMergeSimulation={setMergeSimulation}
                        mergeValidationReport={mergeValidationReport}
                        setMergeValidationReport={setMergeValidationReport}
                        mergeResult={mergeResult}
                        setMergeResult={setMergeResult}
                        mergeApprovedSources={mergeApprovedSources}
                        setMergeApprovedSources={setMergeApprovedSources}
                        mergeHistory={mergeHistory}
                        setMergeHistory={setMergeHistory}
                        onProceedToAnalysis={() => setStep(8)}
                        handleGenerateProcurementMapping={handleGenerateProcurementMapping}
                        onRegisterMergedGroup={handleRegisterMergedGroup}
                      />
                    </motion.div>
                  </AnimatePresence>
                )}

                {step === 8 && (
                  <Analysis
                    mergeResult={mergeResult}
                    analysisResults={analysisResults}
                    analysisLoading={analysisLoading}
                    handleRunAnalysis={handleRunAnalysis}
                    onProceedToProcurement={() => setStep(9)}
                  />
                )}

                <Procurement
                  step={step}
                  procurementMappings={procurementMappings}
                  setProcurementMappings={setProcurementMappings}
                  standardFields={standardFields}
                  viewCategories={viewCategories}
                  possibleViews={possibleViews}
                  handleAnalyzeViews={handleAnalyzeViews}
                  handleGenerateProcurementMapping={handleGenerateProcurementMapping}
                  loading={loading}
                  onSelectChatItem={onSelectChatItem}
                />
              </motion.div>
            </AnimatePresence>

            <LoadingOverlay isLoading={aiLoading} message={loadingMessage} onCancel={cancelAiRequest} />
            </>
            )}
            </>
          )}

          </div>
        </div>
        <StatusLog entries={statusLog} onClear={() => setStatusLog([])} />

        {!chatOpen && sessionId && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => setChatOpen(true)}
            className={`absolute bottom-20 right-6 z-30 w-14 h-14 rounded-2xl bg-gradient-to-br from-red-600 to-rose-600 text-white shadow-xl shadow-red-200/40 dark:shadow-red-900/30 flex items-center justify-center ${
              selectedChatItem ? "ring-4 ring-red-200 ring-offset-2" : ""
            }`}
            title="Open Data Assistant"
          >
            <MessageSquare className="w-5 h-5" />
            {selectedChatItem && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white" />
            )}
          </motion.button>
        )}
      </main>

      {chatOpen && sessionId && (
        <ChatPanel
          sessionId={sessionId}
          apiKey={apiKey}
          stage={step}
          selectedItem={selectedChatItem}
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          onClearSelection={() => setSelectedChatItem(null)}
        />
      )}

      {showDataPreview && (
        <DataPreviewOverlay
          previews={previews}
          inventory={inventory}
          onClose={() => setShowDataPreview(false)}
          title="Raw Data Preview"
        />
      )}

      {showResultsPreview && (
        <DataPreviewOverlay
          previews={resultsPreviews}
          inventory={resultsInventory}
          onClose={() => setShowResultsPreview(false)}
          title="Results Preview"
        />
      )}
    </div>
  );
}
