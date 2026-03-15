"use client";

import { useEffect, useRef, useCallback } from "react";

interface TrackContextMenuProps {
  x: number;
  y: number;
  trackIndex: number;
  trackName: string;
  isMuted: boolean;
  isSoloed: boolean;
  patterns: { index: number; name: string }[];
  activePatternIndex: number;
  hasClipboard: boolean;
  onEdit: () => void;
  onExportMidi: () => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveToPattern: (patternIndex: number) => void;
  onClose: () => void;
}

export function TrackContextMenu({
  x,
  y,
  trackIndex,
  trackName,
  isMuted,
  isSoloed,
  patterns,
  activePatternIndex,
  hasClipboard,
  onEdit,
  onExportMidi,
  onToggleMute,
  onToggleSolo,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onDuplicate,
  onMoveToPattern,
  onClose,
}: TrackContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on Escape or click outside
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    const timer = submenuTimerRef.current;
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
      if (timer) clearTimeout(timer);
    };
  }, [onClose]);

  // Clamp menu position to viewport
  const adjustedPos = useCallback(() => {
    const menuW = 220;
    const menuH = 320;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    return {
      left: Math.min(x, vw - menuW - 8),
      top: Math.min(y, vh - menuH - 8),
    };
  }, [x, y]);

  const pos = adjustedPos();

  // Other patterns for "Move to Pattern" submenu
  const otherPatterns = patterns.filter((p) => p.index !== activePatternIndex);

  return (
    <div
      ref={menuRef}
      className="notator-context-menu"
      style={{ left: pos.left, top: pos.top }}
      id="track-context-menu"
    >
      {/* Header */}
      <div className="notator-context-menu-header">
        <span className="truncate">
          Track {trackIndex + 1}: {trackName || "---"}
        </span>
      </div>

      {/* Edit Track */}
      <button
        className="notator-menu-item"
        onClick={() => { onEdit(); onClose(); }}
        id="ctx-edit"
      >
        <span className="mr-2 text-notator-accent">✎</span>
        Edit Track…
      </button>

      {/* Export MIDI */}
      <button
        className="notator-menu-item"
        onClick={() => { onExportMidi(); onClose(); }}
        id="ctx-export-midi"
      >
        <span className="mr-2 text-notator-text-dim">↓</span>
        Export Track as MIDI
      </button>

      <div className="notator-menu-separator" />

      {/* Mute / Solo */}
      <button
        className="notator-menu-item"
        onClick={() => { onToggleMute(); onClose(); }}
        id="ctx-mute"
      >
        <span className={`mr-2 ${isMuted ? "text-notator-red" : "text-notator-text-dim"}`}>
          M
        </span>
        {isMuted ? "Unmute Track" : "Mute Track"}
      </button>
      <button
        className="notator-menu-item"
        onClick={() => { onToggleSolo(); onClose(); }}
        id="ctx-solo"
      >
        <span className={`mr-2 ${isSoloed ? "text-notator-amber" : "text-notator-text-dim"}`}>
          S
        </span>
        {isSoloed ? "Unsolo Track" : "Solo Track"}
      </button>

      <div className="notator-menu-separator" />

      {/* Copy / Paste */}
      <button
        className="notator-menu-item"
        onClick={() => { onCopy(); onClose(); }}
        id="ctx-copy"
      >
        <span className="mr-2 text-notator-text-dim">⎘</span>
        Copy Track
      </button>
      <button
        className="notator-menu-item"
        onClick={() => { onCut(); onClose(); }}
        id="ctx-cut"
      >
        <span className="mr-2 text-notator-text-dim">✂</span>
        Cut Track
      </button>
      <button
        className={`notator-menu-item ${!hasClipboard ? "notator-menu-item-disabled" : ""}`}
        onClick={() => { if (hasClipboard) { onPaste(); onClose(); } }}
        id="ctx-paste"
      >
        <span className="mr-2 text-notator-text-dim">⎗</span>
        Paste Track
      </button>

      <div className="notator-menu-separator" />

      {/* Delete */}
      <button
        className="notator-menu-item"
        onClick={() => { onDelete(); onClose(); }}
        id="ctx-delete"
      >
        <span className="mr-2 text-notator-red">✕</span>
        <span className="text-notator-red">Delete Track</span>
      </button>

      {/* Duplicate */}
      <button
        className="notator-menu-item"
        onClick={() => { onDuplicate(); onClose(); }}
        id="ctx-duplicate"
      >
        <span className="mr-2 text-notator-text-dim">⊕</span>
        Duplicate Track
      </button>

      {/* Move to Pattern — with submenu */}
      {otherPatterns.length > 0 && (
        <div className="notator-submenu-container" id="ctx-move-to-pattern">
          <div className="notator-menu-item notator-submenu-trigger">
            <span className="mr-2 text-notator-text-dim">→</span>
            Move to Pattern
            <span className="ml-auto pl-3 text-notator-text-dim">▸</span>
          </div>
          <div className="notator-submenu">
            {otherPatterns.map((pat) => (
              <button
                key={pat.index}
                className="notator-menu-item"
                onClick={() => { onMoveToPattern(pat.index); onClose(); }}
                id={`ctx-move-pattern-${pat.index}`}
              >
                <span className="mr-2 text-notator-text-dim">{pat.index + 1}</span>
                {pat.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
