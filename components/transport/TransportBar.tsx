"use client";

import { useState, useMemo } from "react";
import type { PlaybackState } from "@/lib/playback/engine";
import { ticksToPosition } from "@/lib/son-parser/types";
import { MenuBar, type MenuDefinition } from "@/components/ui/MenuBar";
import { AboutDialog } from "@/components/ui/AboutDialog";

interface TransportBarProps {
  state: PlaybackState;
  currentTick: number;
  totalTicks: number;
  tempo: number;
  songName: string;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onTempoChange: (bpm: number) => void;
  /** Trigger native file picker for .SON loading */
  onLoadFileClick?: () => void;
  /** Load a demo .SON by path and name */
  onDemoLoad?: (path: string, name: string) => void;
}

/** Demo .SON files for the File menu */
const DEMO_FILES = [
  { name: "EXAMPLE.SON", path: "/demos/EXAMPLE.SON" },
  { name: "DRUMMAP.SON", path: "/demos/DRUMMAP.SON" },
  { name: "POLYPHON.SON", path: "/demos/POLYPHON.SON" },
  { name: "N_TUPLET.SON", path: "/demos/N_TUPLET.SON" },
];

/** Format a position as BAR:BEAT:TICK with padding */
function formatPosition(tick: number): string {
  const pos = ticksToPosition(tick);
  const bar = String(pos.bar + 1).padStart(3, "0");
  const beat = String(pos.beat + 1);
  const tk = String(pos.tick).padStart(3, "0");
  return `${bar}:${beat}:${tk}`;
}

export function TransportBar({
  state,
  currentTick,
  totalTicks,
  tempo,
  songName,
  onPlay,
  onPause,
  onStop,
  onTempoChange,
  onLoadFileClick,
  onDemoLoad,
}: TransportBarProps) {
  const [aboutOpen, setAboutOpen] = useState(false);

  const menus: MenuDefinition[] = useMemo(
    () => [
      {
        label: "Desk",
        items: [
          {
            label: "About Notator Web…",
            onClick: () => setAboutOpen(true),
          },
        ],
      },
      {
        label: "File",
        items: [
          {
            label: "Load .SON File…",
            onClick: onLoadFileClick,
          },
          { label: "", separator: true },
          ...DEMO_FILES.map((demo) => ({
            label: `Demo: ${demo.name}`,
            onClick: () => onDemoLoad?.(demo.path, demo.name),
          })),
        ],
      },
      {
        label: "Functions",
        items: [
          { label: "Copy Pattern", disabled: true },
          { label: "Clear Pattern", disabled: true },
        ],
      },
      {
        label: "Quantize",
        items: [
          { label: "1/4 Note", disabled: true },
          { label: "1/8 Note", disabled: true },
          { label: "1/16 Note", disabled: true },
          { label: "1/32 Note", disabled: true },
        ],
      },
      {
        label: "MIDI",
        className: "!text-notator-text-muted font-bold",
        items: [
          { label: "MIDI Thru", disabled: true },
          { label: "MIDI Sync", disabled: true },
          { label: "", separator: true },
          { label: "All Notes Off", disabled: true },
        ],
      },
      {
        label: "Flags",
        items: [
          { label: "Loop", disabled: true },
          { label: "Auto-Advance", disabled: true },
        ],
      },
      {
        label: "Options",
        items: [
          { label: "GM Synth", disabled: true },
          { label: "Web MIDI Output", disabled: true },
        ],
      },
      {
        label: "Help",
        items: [
          {
            label: "GitHub Repository ↗",
            href: "https://github.com/wreiske/notator-web",
          },
          {
            label: "About .SON Format ↗",
            href: "https://github.com/wreiske/notator-web#-son-file-format",
          },
          { label: "", separator: true },
          {
            label: "About Notator Web…",
            onClick: () => setAboutOpen(true),
          },
        ],
      },
    ],
    [onLoadFileClick, onDemoLoad]
  );

  return (
    <div className="select-none border-b-2 border-notator-border-bright bg-notator-panel font-mono text-notator-text">
      {/* About dialog */}
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      {/* Top: menu bar + branding */}
      <div className="flex items-center justify-between border-b border-notator-border px-1 py-0 text-[11px]">
        <MenuBar menus={menus} />
        <div className="flex items-center gap-2 pr-2">
          <span className="tracking-[0.3em] text-notator-text-muted">
            N O T A T O R
          </span>
          <span className="text-notator-accent">3.21</span>
          <span className="text-notator-text-dim">web</span>
        </div>
      </div>

      {/* Main transport row */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        {/* Song & status info */}
        <div className="flex items-center gap-3">
          {/* Song name */}
          <div className="flex items-center rounded border border-notator-border bg-notator-bg px-2 py-0.5">
            <span className="text-[10px] text-notator-text-dim mr-1">♪</span>
            <span className="text-xs font-bold text-notator-text truncate max-w-[120px]">
              {songName || "---"}
            </span>
          </div>

          {/* Sync */}
          <div className="rounded border border-notator-border bg-notator-bg px-2 py-0.5 text-[10px] text-notator-text-dim">
            intern
          </div>
        </div>

        {/* Tempo */}
        <div className="flex items-center gap-1 rounded border border-notator-border bg-notator-bg px-2 py-0.5">
          <span className="text-[10px] text-notator-text-dim">TEMPO</span>
          <input
            type="number"
            value={tempo}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 20 && v <= 300) onTempoChange(v);
            }}
            className="w-14 bg-transparent text-center text-sm font-bold text-notator-accent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            id="tempo-input"
          />
        </div>

        {/* Time signature */}
        <div className="rounded border border-notator-border bg-notator-bg px-2 py-0.5 text-[10px]">
          <span className="text-notator-text-dim">SIG</span>{" "}
          <span className="font-bold text-notator-text">4/4</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Position display */}
        <div className="flex items-center gap-3">
          {/* Current position */}
          <div className="flex items-center gap-1 rounded border border-notator-border-bright bg-notator-surface-active px-3 py-1">
            <span className="text-lg font-bold tabular-nums tracking-wider text-notator-text">
              {formatPosition(currentTick)}
            </span>
          </div>

          {/* Divider */}
          <span className="text-notator-text-dim">/</span>

          {/* Total */}
          <div className="flex items-center rounded border border-notator-border bg-notator-bg px-2 py-1">
            <span className="text-xs tabular-nums text-notator-text-muted">
              {formatPosition(totalTicks)}
            </span>
          </div>

          {/* BAR display */}
          <div className="flex items-center gap-1 rounded border border-notator-border bg-notator-bg px-2 py-0.5 text-[10px]">
            <span className="text-notator-text-dim">BAR</span>
            <span className="font-bold text-notator-accent tabular-nums">
              {String(Math.floor(currentTick / 768) + 1).padStart(3, " ")}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom: Transport buttons */}
      <div className="flex items-center justify-between border-t border-notator-border px-3 py-1.5">
        {/* Left: MIDI status */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="rounded border border-notator-border bg-notator-bg px-2 py-0.5 text-notator-text-dim">
            MIDI THRU
          </span>
          <div className="flex items-center gap-1">
            <div
              className={`h-1.5 w-1.5 rounded-full ${
                state === "playing"
                  ? "bg-notator-green animate-pulse"
                  : "bg-notator-text-dim"
              }`}
            />
            <span className="text-notator-text-dim uppercase">
              {state}
            </span>
          </div>
        </div>

        {/* Right: Transport buttons */}
        <div className="flex items-center gap-1.5">
          {/* STOP */}
          <button
            onClick={onStop}
            className={`notator-btn rounded px-4 py-1 text-[11px] ${
              state === "stopped"
                ? "border-notator-red bg-notator-red/20 text-notator-red"
                : "border-notator-border text-notator-text-muted hover:border-notator-red hover:text-notator-red"
            }`}
            id="transport-stop"
          >
            STOP
          </button>

          {/* START - acts as play from beginning or resume */}
          <button
            onClick={onPlay}
            className={`notator-btn rounded px-4 py-1 text-[11px] ${
              state === "playing"
                ? "border-notator-green bg-notator-green/20 text-notator-green"
                : "border-notator-border text-notator-text-muted hover:border-notator-green hover:text-notator-green"
            }`}
            id="transport-start"
          >
            START
          </button>

          {/* CONT - continue/pause */}
          <button
            onClick={state === "playing" ? onPause : onPlay}
            className={`notator-btn rounded px-4 py-1 text-[11px] ${
              state === "paused"
                ? "border-notator-accent bg-notator-accent/20 text-notator-accent"
                : "border-notator-border text-notator-text-muted hover:border-notator-accent hover:text-notator-accent"
            }`}
            id="transport-cont"
          >
            CONT
          </button>
        </div>
      </div>
    </div>
  );
}
