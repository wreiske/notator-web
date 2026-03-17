"use client";

/**
 * UploadProgressOverlay — Shows per-file upload progress bars
 */

export interface UploadItem {
  name: string;
  progress: number; // 0–100
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

interface UploadProgressOverlayProps {
  items: UploadItem[];
  onClose?: () => void;
}

export function UploadProgressOverlay({
  items,
  onClose,
}: UploadProgressOverlayProps) {
  if (items.length === 0) return null;

  const allDone = items.every(
    (item) => item.status === "done" || item.status === "error",
  );
  const completedCount = items.filter((i) => i.status === "done").length;
  const errorCount = items.filter((i) => i.status === "error").length;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-notator-border-bright bg-notator-panel shadow-xl font-mono animate-[notator-scale-in_0.2s_ease]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-notator-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          {allDone ? (
            <span className="text-sm">{errorCount > 0 ? "⚠️" : "✅"}</span>
          ) : (
            <span className="animate-spin text-sm">⏳</span>
          )}
          <span className="text-xs font-bold text-notator-text">
            {allDone
              ? `Upload complete — ${completedCount}/${items.length}`
              : `Uploading ${items.length} file${items.length > 1 ? "s" : ""}…`}
          </span>
        </div>
        {allDone && onClose && (
          <button
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded text-[10px] text-notator-text-dim hover:bg-notator-surface-hover hover:text-notator-text"
            id="upload-progress-close"
          >
            ✕
          </button>
        )}
      </div>

      {/* File list */}
      <div className="max-h-60 overflow-y-auto px-4 py-2 space-y-2.5">
        {items.map((item, i) => (
          <div key={`${item.name}-${i}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="truncate text-[11px] text-notator-text max-w-[200px]">
                🎵 {item.name}
              </span>
              <span className="flex-shrink-0 text-[10px] ml-2">
                {item.status === "done" && (
                  <span className="text-notator-green">✓</span>
                )}
                {item.status === "error" && (
                  <span className="text-notator-red">✗</span>
                )}
                {item.status === "uploading" && (
                  <span className="text-notator-accent">{item.progress}%</span>
                )}
                {item.status === "pending" && (
                  <span className="text-notator-text-dim">queued</span>
                )}
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-notator-bg">
              <div
                className={`h-full rounded-full transition-all duration-300 ease-out ${
                  item.status === "done"
                    ? "bg-notator-green"
                    : item.status === "error"
                      ? "bg-notator-red"
                      : "bg-notator-accent"
                }`}
                style={{
                  width: `${item.status === "done" ? 100 : item.progress}%`,
                }}
              />
            </div>

            {item.error && (
              <p className="mt-0.5 text-[9px] text-notator-red">{item.error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
