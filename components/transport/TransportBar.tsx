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
  ticksPerMeasure: number;
  loopEnabled: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onTempoChange: (bpm: number) => void;
  onToggleLoop: () => void;
  /** Trigger native file picker for .SON loading */
  onLoadFileClick?: () => void;
  /** Load a demo .SON by path and name */
  onDemoLoad?: (path: string, name: string) => void;
  /** Export current song as Standard MIDI File */
  onExportMidi?: () => void;
  /** MIDI state */
  midiThruEnabled?: boolean;
  midiOutputName?: string | null;
  onToggleMidiThru?: () => void;
  onMidiPanic?: () => void;
  onOpenMidiSettings?: () => void;
}

/** Demo .SON files for the File menu */
const DEMO_FILES = [
  { name: "ALEXA'S.SON", path: "/demos/ALEXA'S.SON" },
  { name: "AUTOLOAD.SON", path: "/demos/AUTOLOAD.SON" },
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
  ticksPerMeasure,
  loopEnabled,
  onPlay,
  onPause,
  onStop,
  onTempoChange,
  onToggleLoop,
  onLoadFileClick,
  onDemoLoad,
  onExportMidi,
  midiThruEnabled,
  midiOutputName,
  onToggleMidiThru,
  onMidiPanic,
  onOpenMidiSettings,
}: TransportBarProps) {
  const [aboutOpen, setAboutOpen] = useState(false);

  // Derive time signature from ticks per measure
  const beatsPerBar = Math.round(ticksPerMeasure / 192);
  const timeSigDisplay = ticksPerMeasure > 0 ? `${beatsPerBar}/4` : "4/4";

  const menus: MenuDefinition[] = useMemo(
    () => [
      {
        label: "Desk",
        items: [
          {
            label: "About Notator Online…",
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
          {
            label: "Export as MIDI…",
            onClick: onExportMidi,
            disabled: !onExportMidi,
            suffix: "⌘E",
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
          {
            label: midiThruEnabled ? "✓ MIDI Thru" : "MIDI Thru",
            onClick: onToggleMidiThru,
          },
          { label: "MIDI Sync", disabled: true },
          { label: "", separator: true },
          {
            label: "All Notes Off",
            onClick: onMidiPanic,
          },
          { label: "", separator: true },
          {
            label: "MIDI Settings…",
            onClick: onOpenMidiSettings,
          },
        ],
      },
      {
        label: "Flags",
        items: [
          {
            label: loopEnabled ? "✓ Loop" : "Loop",
            onClick: onToggleLoop,
          },
          { label: "Auto-Advance", disabled: true },
        ],
      },
      {
        label: "Options",
        items: [
          {
            label: !midiOutputName ? "✓ GM Synth" : "GM Synth",
            onClick: onOpenMidiSettings,
          },
          {
            label: midiOutputName ? `✓ ${midiOutputName}` : "Web MIDI Output…",
            onClick: onOpenMidiSettings,
          },
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
            label: "About Notator Online…",
            onClick: () => setAboutOpen(true),
          },
        ],
      },
    ],
    [
      onLoadFileClick,
      onDemoLoad,
      onExportMidi,
      loopEnabled,
      onToggleLoop,
      midiThruEnabled,
      midiOutputName,
      onToggleMidiThru,
      onMidiPanic,
      onOpenMidiSettings,
    ],
  );

  return (
    <div className="sticky top-0 z-40 select-none border-b-2 border-notator-border-bright bg-notator-panel font-mono text-notator-text">
      {/* About dialog */}
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      {/* Top: menu bar + branding */}
      <div className="flex items-center justify-between border-b border-notator-border px-1 py-0 text-[11px]">
        <div className="min-w-0 overflow-visible">
          <MenuBar menus={menus} />
        </div>
        <div className="hidden items-center gap-2 pr-2 sm:flex">
          <span className="tracking-[0.3em] text-notator-text-muted">
            N O T A T O R
          </span>
          <span className="text-notator-accent">3.21</span>
          <span className="text-notator-text-dim">web</span>
        </div>
      </div>

      {/* Main transport row — stacks on mobile */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        {/* Song & status info */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Song name */}
          <div className="flex items-center rounded border border-notator-border bg-notator-bg px-2 py-0.5">
            <span className="mr-1 text-[10px] text-notator-text-dim">♪</span>
            <span className="max-w-[80px] truncate text-xs font-bold text-notator-text sm:max-w-[120px]">
              {songName || "---"}
            </span>
          </div>

          {/* Sync — hidden on mobile */}
          <div className="hidden rounded border border-notator-border bg-notator-bg px-2 py-0.5 text-[10px] text-notator-text-dim sm:block">
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
            className="w-10 bg-transparent text-center text-sm font-bold text-notator-accent outline-none sm:w-14 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            id="tempo-input"
          />
        </div>

        {/* Time signature */}
        <div className="rounded border border-notator-border bg-notator-bg px-2 py-0.5 text-[10px]">
          <span className="text-notator-text-dim">SIG</span>{" "}
          <span className="font-bold text-notator-text">{timeSigDisplay}</span>
        </div>

        {/* Spacer */}
        <div className="hidden flex-1 sm:block" />

        {/* Position display */}
        <div className="flex items-center gap-1 sm:gap-3">
          {/* Current position */}
          <div className="flex items-center gap-1 rounded border border-notator-border-bright bg-notator-surface-active px-2 py-0.5 sm:px-3 sm:py-1">
            <span className="text-sm font-bold tabular-nums tracking-wider text-notator-text sm:text-lg">
              {formatPosition(currentTick)}
            </span>
          </div>

          {/* Divider */}
          <span className="hidden text-notator-text-dim sm:inline">/</span>

          {/* Total — hidden on mobile */}
          <div className="hidden items-center rounded border border-notator-border bg-notator-bg px-2 py-1 sm:flex">
            <span className="text-xs tabular-nums text-notator-text-muted">
              {formatPosition(totalTicks)}
            </span>
          </div>

          {/* BAR display — hidden on mobile */}
          <div className="hidden items-center gap-1 rounded border border-notator-border bg-notator-bg px-2 py-0.5 text-[10px] sm:flex">
            <span className="text-notator-text-dim">BAR</span>
            <span className="font-bold tabular-nums text-notator-accent">
              {String(Math.floor(currentTick / 768) + 1).padStart(3, " ")}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom: Transport buttons */}
      <div className="flex items-center justify-between border-t border-notator-border px-3 py-1.5">
        {/* Left: MIDI status — simplified on mobile */}
        <div className="flex items-center gap-2 text-[10px]">
          <span
            className={`hidden cursor-pointer rounded border px-2 py-0.5 sm:inline ${
              midiThruEnabled
                ? "border-notator-accent bg-notator-accent/10 text-notator-accent"
                : "border-notator-border bg-notator-bg text-notator-text-dim"
            }`}
            onClick={onToggleMidiThru}
            title="Toggle MIDI Thru"
          >
            MIDI THRU
          </span>
          {midiOutputName && (
            <span
              className="hidden cursor-pointer rounded border border-notator-border bg-notator-bg px-2 py-0.5 text-notator-text-dim hover:text-notator-text sm:inline"
              onClick={onOpenMidiSettings}
              title="MIDI Output device"
            >
              OUT: {midiOutputName}
            </span>
          )}
          <div className="flex items-center gap-1">
            <div
              className={`h-1.5 w-1.5 rounded-full ${
                state === "playing"
                  ? "animate-pulse bg-notator-green"
                  : "bg-notator-text-dim"
              }`}
            />
            <span className="text-notator-text-dim uppercase">{state}</span>
          </div>
        </div>

        {/* Right: Transport buttons — bigger touch targets on mobile */}
        <div className="flex items-center gap-1.5">
          {/* STOP */}
          <button
            onClick={onStop}
            className={`notator-btn min-h-[44px] rounded px-4 py-2 text-[11px] sm:min-h-0 sm:py-1 ${
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
            className={`notator-btn min-h-[44px] rounded px-4 py-2 text-[11px] sm:min-h-0 sm:py-1 ${
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
            className={`notator-btn min-h-[44px] rounded px-4 py-2 text-[11px] sm:min-h-0 sm:py-1 ${
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
