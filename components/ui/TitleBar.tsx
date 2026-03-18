"use client";

import { useState } from "react";

/**
 * Custom title bar for the Electron app.
 * Renders nothing in the web browser — only shows inside Electron.
 *
 * On macOS, the native traffic lights are used (via titleBarStyle: hiddenInset),
 * so we only render a drag region and centered title.
 * On Windows/Linux, we also render custom close/minimize/maximize buttons.
 */
export function TitleBar() {
  // Use lazy initial state so we read electronAPI exactly once, no effect needed
  const [electronState] = useState(() => {
    if (typeof window === "undefined") return { isElectron: false, platform: "" };
    const api = window.electronAPI;
    return {
      isElectron: !!api?.isElectron,
      platform: api?.platform || "",
    };
  });

  if (!electronState.isElectron) return null;

  const isMac = electronState.platform === "darwin";

  return (
    <div
      className="sticky top-0 z-50 flex h-9 items-center justify-between border-b border-notator-border bg-notator-panel font-mono text-[11px] text-notator-text-muted select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      id="electron-title-bar"
    >
      {/* Left spacer: on macOS, leave room for traffic lights */}
      <div className={isMac ? "w-20 shrink-0" : "w-3 shrink-0"} />

      {/* Centered title */}
      <div className="flex-1 text-center tracking-widest text-notator-text-dim">
        Notator
      </div>

      {/* Window controls — only on Windows/Linux */}
      {!isMac && (
        <div
          className="flex h-full items-stretch"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Minimize */}
          <button
            className="flex w-11 items-center justify-center transition-colors hover:bg-white/10"
            onClick={() => window.electronAPI?.minimizeWindow()}
            aria-label="Minimize"
            id="titlebar-minimize"
          >
            <svg width="10" height="1" viewBox="0 0 10 1">
              <rect width="10" height="1" fill="currentColor" />
            </svg>
          </button>

          {/* Maximize / Restore */}
          <button
            className="flex w-11 items-center justify-center transition-colors hover:bg-white/10"
            onClick={() => window.electronAPI?.maximizeWindow()}
            aria-label="Maximize"
            id="titlebar-maximize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect
                x="0.5"
                y="0.5"
                width="9"
                height="9"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          </button>

          {/* Close */}
          <button
            className="flex w-11 items-center justify-center transition-colors hover:bg-red-600"
            onClick={() => window.electronAPI?.closeWindow()}
            aria-label="Close"
            id="titlebar-close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line
                x1="1"
                y1="1"
                x2="9"
                y2="9"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <line
                x1="9"
                y1="1"
                x2="1"
                y2="9"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Right spacer on macOS */}
      {isMac && <div className="w-3 shrink-0" />}
    </div>
  );
}
