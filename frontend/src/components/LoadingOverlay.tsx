import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, BrainCircuit, Sparkles } from "lucide-react";

const LONG_RUNNING_SECONDS = 60;
const FORCE_DISMISS_SECONDS = 120;

const AI_MESSAGES = [
  "Comparing schemas across extracted tables...",
  "Finding likely join keys and resolving ambiguity...",
  "Building a normalized procurement field map...",
  "Validating column compatibility...",
  "Analyzing value distributions for best matches...",
];

interface LoadingOverlayProps {
  isLoading: boolean;
  message?: string;
  onCancel?: () => void;
  onForceDismiss?: () => void;
}

function useElapsedSeconds(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      setElapsed(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  return elapsed;
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s elapsed`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s elapsed`;
}

const SENDING_PHASE_SECONDS = 3;

function getPhase(elapsed: number) {
  if (elapsed < SENDING_PHASE_SECONDS) return "sending" as const;
  return "waiting" as const;
}

export default function LoadingOverlay({ isLoading, message, onCancel, onForceDismiss }: LoadingOverlayProps) {
  const elapsed = useElapsedSeconds(isLoading);
  const phase = getPhase(elapsed);
  const isLongRunning = elapsed >= LONG_RUNNING_SECONDS;
  const showForceDismiss = elapsed >= FORCE_DISMISS_SECONDS;

  const msgIndex = Math.floor(elapsed / 3) % AI_MESSAGES.length;

  return (
    <AnimatePresence>
      {isLoading && (
        <>
          {/* Top Progress Bar */}
          <motion.div
            initial={{ scaleX: 0, originX: 0 }}
            animate={{ scaleX: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="fixed top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-500 to-rose-500 z-[100]"
          />

          {/* Full Screen Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-neutral-950/35 backdrop-blur-md z-[90] flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="rounded-3xl border border-white/20 bg-white/90 shadow-2xl backdrop-blur-sm p-8 max-w-sm w-full text-center dark:bg-neutral-900/90 dark:border-neutral-700/30"
            >
              {/* Pulsing orb */}
              <div className="relative w-20 h-20 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full bg-red-50 dark:bg-red-950/30" />
                <motion.div
                  animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-2 rounded-full bg-gradient-to-br from-red-500 to-rose-500 shadow-lg shadow-red-200"
                />
                <motion.div
                  animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 rounded-full border-2 border-red-300"
                />
              </div>

              <h3 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white mb-2">AI is working on your data</h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                {message || "Analyzing your datasets to find the best connections..."}
              </p>

              {/* Rotating smart message */}
              {phase === "waiting" && (
                <AnimatePresence mode="wait">
                  <motion.p
                    key={msgIndex}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3 }}
                    className="mt-4 text-xs font-medium text-red-600 dark:text-red-400 italic"
                  >
                    {AI_MESSAGES[msgIndex]}
                  </motion.p>
                </AnimatePresence>
              )}

              {/* Phase indicator */}
              <div className="mt-6 flex items-center justify-center gap-4">
                <div className={`flex flex-col items-center gap-1 transition-opacity ${phase === "sending" ? "opacity-100" : "opacity-30"}`}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${phase === "sending" ? "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400" : "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"}`}>
                    <Send className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-semibold tracking-wider text-neutral-500 dark:text-neutral-400">Sending</span>
                </div>
                <div className={`w-8 h-px ${phase === "waiting" ? "bg-red-300 dark:bg-red-700" : "bg-neutral-200 dark:bg-neutral-700"}`} />
                <div className={`flex flex-col items-center gap-1 transition-opacity ${phase === "waiting" ? "opacity-100" : "opacity-30"}`}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${phase === "waiting" ? "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400" : "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"}`}>
                    <BrainCircuit className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-semibold tracking-wider text-neutral-500 dark:text-neutral-400">Thinking</span>
                </div>
                <div className="w-8 h-px bg-neutral-200 dark:bg-neutral-700" />
                <div className="flex flex-col items-center gap-1 opacity-30">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-semibold tracking-wider text-neutral-500 dark:text-neutral-400">Done</span>
                </div>
              </div>

              <div className="mt-6 space-y-2">
                <div className="h-2 w-full bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                  {phase === "sending" ? (
                    <motion.div
                      initial={{ width: "0%" }}
                      animate={{ width: "15%" }}
                      transition={{ duration: SENDING_PHASE_SECONDS, ease: "easeOut" }}
                      className="h-full bg-gradient-to-r from-red-500 to-rose-500 rounded-full"
                    />
                  ) : (
                    <motion.div
                      animate={{ x: ["-100%", "100%"] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                      className="h-full w-1/2 bg-gradient-to-r from-red-500 to-rose-500 rounded-full"
                    />
                  )}
                </div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-neutral-400 dark:text-neutral-500">
                  {phase === "sending" ? "Sending payload to AI..." : "Waiting for AI response..."}
                </p>
                <p className="text-xs tabular-nums font-medium text-neutral-400 dark:text-neutral-500 pt-1">
                  {formatElapsed(elapsed)}
                </p>
                {isLongRunning && (
                  <p className="text-xs text-amber-600 font-medium pt-2 leading-relaxed">
                    Still working — large datasets may take a few minutes. You can cancel anytime.
                  </p>
                )}
                {onCancel && (
                  <button
                    type="button"
                    onClick={onCancel}
                    className="mt-4 w-full py-2.5 px-4 rounded-xl border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-200 font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                  >
                    Cancel
                  </button>
                )}
                {showForceDismiss && onForceDismiss && (
                  <button
                    type="button"
                    onClick={onForceDismiss}
                    className="mt-2 w-full py-2 px-4 rounded-xl text-xs text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:text-neutral-300 dark:hover:bg-neutral-800 transition-colors"
                  >
                    Dismiss overlay (request continues in background)
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
