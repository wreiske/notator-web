"use client";

import { useCallback } from "react";
import { ticksToPosition } from "@/lib/son-parser/types";

interface TransportControlsPanelProps {
  /** Current playback tick */
  currentTick: number;
  /** Ticks per measure (e.g. 768 for 4/4) */
  ticksPerMeasure: number;
  /** Ticks per beat (e.g. 192) */
  ticksPerBeat: number;
  /** Total ticks in the current pattern/entry */
  totalTicks: number;
  /** Left locator position in ticks */
  leftLocator: number;
  /** Right locator position in ticks */
  rightLocator: number;
  /** Whether cycle (loop between locators) is active */
  cycleEnabled: boolean;
  /** Whether autodrop is enabled */
  autodropEnabled: boolean;
  /** Current playback state */
  playbackState: "stopped" | "playing" | "paused";
  /** Selected track index (for EDIT button) */
  selectedTrackIndex: number;
  // Callbacks
  onSetLeftLocator: (tick: number) => void;
  onSetRightLocator: (tick: number) => void;
  onToggleCycle: () => void;
  onToggleAutodrop: () => void;
  onSeek: (tick: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onEdit: (trackIndex: number) => void;
}

/** Format a tick position as BAR.BEAT.TICK (matching original Notator 4-digit display) */
function formatLocator(
  tick: number,
  ticksPerMeasure: number = 768,
  ticksPerBeat: number = 192,
): string {
  const pos = ticksToPosition(tick, ticksPerMeasure, ticksPerBeat);
  return `${pos.bar + 1}.${pos.beat + 1}.${pos.tick}`;
}

export function TransportControlsPanel({
  currentTick,
  ticksPerMeasure,
  ticksPerBeat,
  totalTicks,
  leftLocator,
  rightLocator,
  cycleEnabled,
  autodropEnabled,
  playbackState,
  selectedTrackIndex,
  onSetLeftLocator,
  onSetRightLocator,
  onToggleCycle,
  onToggleAutodrop,
  onSeek,
  onPlay,
  onPause,
  onStop,
  onEdit,
}: TransportControlsPanelProps) {
  // Navigation: step back 1 beat
  const handleStepBack = useCallback(() => {
    const newTick = Math.max(0, currentTick - ticksPerBeat);
    onSeek(newTick);
  }, [currentTick, ticksPerBeat, onSeek]);

  // Navigation: step forward 1 beat
  const handleStepForward = useCallback(() => {
    const newTick = Math.min(totalTicks, currentTick + ticksPerBeat);
    onSeek(newTick);
  }, [currentTick, ticksPerBeat, totalTicks, onSeek]);

  // Navigation: fast back 1 bar
  const handleFastBack = useCallback(() => {
    const newTick = Math.max(0, currentTick - ticksPerMeasure);
    onSeek(newTick);
  }, [currentTick, ticksPerMeasure, onSeek]);

  // Navigation: fast forward 1 bar
  const handleFastForward = useCallback(() => {
    const newTick = Math.min(totalTicks, currentTick + ticksPerMeasure);
    onSeek(newTick);
  }, [currentTick, ticksPerMeasure, totalTicks, onSeek]);

  return (
    <div className="border-t border-notator-border font-mono text-[10px] select-none">
      {/* ── LEFT LOCATOR ── */}
      <div className="border-b border-notator-border/30">
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-[9px] uppercase tracking-widest text-notator-text-dim">
            Left Locator
          </span>
          <button
            onClick={() => onSetLeftLocator(currentTick)}
            className="text-[8px] text-notator-accent hover:text-notator-accent-hover"
            title="Set left locator to current position"
            id="set-left-locator"
          >
            SET
          </button>
        </div>
        <div className="px-3 pb-1.5">
          <div className="rounded border border-notator-border-bright bg-notator-surface-active px-2 py-1 text-center">
            <span className="text-sm font-bold tabular-nums tracking-wider text-notator-text">
              {formatLocator(leftLocator, ticksPerMeasure, ticksPerBeat)}
            </span>
          </div>
        </div>
      </div>

      {/* ── RIGHT LOCATOR ── */}
      <div className="border-b border-notator-border/30">
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-[9px] uppercase tracking-widest text-notator-text-dim">
            Right Locator
          </span>
          <button
            onClick={() => onSetRightLocator(currentTick)}
            className="text-[8px] text-notator-accent hover:text-notator-accent-hover"
            title="Set right locator to current position"
            id="set-right-locator"
          >
            SET
          </button>
        </div>
        <div className="px-3 pb-1.5">
          <div className="rounded border border-notator-border bg-notator-bg px-2 py-1 text-center">
            <span className="text-sm font-bold tabular-nums tracking-wider text-notator-text-muted">
              {formatLocator(rightLocator, ticksPerMeasure, ticksPerBeat)}
            </span>
          </div>
        </div>
      </div>

      {/* ── AUTODROP / CYCLE ── */}
      <div className="flex border-b border-notator-border/30">
        <button
          onClick={onToggleAutodrop}
          className={`notator-btn flex-1 border-r border-notator-border/30 px-2 py-1.5 text-[9px] ${
            autodropEnabled
              ? "bg-notator-accent/20 text-notator-accent border-notator-accent"
              : "text-notator-text-dim border-transparent hover:text-notator-text"
          }`}
          title="Auto-drop: automatically punch in/out at locator positions"
          id="toggle-autodrop"
        >
          AUTODROP
        </button>
        <button
          onClick={onToggleCycle}
          className={`notator-btn flex-1 px-2 py-1.5 text-[9px] ${
            cycleEnabled
              ? "bg-notator-accent/20 text-notator-accent border-notator-accent"
              : "text-notator-text-dim border-transparent hover:text-notator-text"
          }`}
          title="Cycle: loop playback between left and right locators"
          id="toggle-cycle"
        >
          CYCLE
        </button>
      </div>

      {/* ── DROP / UNDO ── */}
      <div className="flex border-b border-notator-border/30">
        <button
          disabled
          className="notator-btn flex-1 border-r border-notator-border/30 px-2 py-2 text-[10px] text-notator-text-dim/40 border-transparent cursor-not-allowed"
          title="Drop: commit recorded take (coming soon)"
          id="btn-drop"
        >
          DROP
        </button>
        <button
          disabled
          className="notator-btn flex-1 px-2 py-2 text-[10px] text-notator-text-dim/40 border-transparent cursor-not-allowed"
          title="Undo: revert last drop (coming soon)"
          id="btn-undo"
        >
          UNDO
        </button>
      </div>

      {/* ── PUNCH / RECORD ── */}
      <div className="flex border-b border-notator-border/30">
        <button
          disabled
          className="notator-btn flex-1 border-r border-notator-border/30 px-2 py-2 text-[10px] text-notator-text-dim/40 border-transparent cursor-not-allowed"
          title="Punch in/out recording (coming soon)"
          id="btn-punch"
        >
          PUNCH
        </button>
        <button
          disabled
          className="notator-btn flex-1 px-2 py-2 text-[10px] text-notator-btn-record/40 border-transparent cursor-not-allowed"
          title="Record MIDI input (coming soon)"
          id="btn-record"
        >
          RECORD
        </button>
      </div>

      {/* ── NAVIGATION ── */}
      <div className="border-b border-notator-border/30 px-3 py-1.5">
        <div className="grid grid-cols-4 gap-1">
          <button
            onClick={handleFastBack}
            className="notator-btn rounded border-notator-border bg-notator-bg px-1 py-1.5 text-[10px] text-notator-text-muted hover:border-notator-accent hover:text-notator-accent"
            title="Fast back (1 bar)"
            id="nav-fast-back"
          >
            ◀◀
          </button>
          <button
            onClick={handleStepBack}
            className="notator-btn rounded border-notator-border bg-notator-bg px-1 py-1.5 text-[10px] text-notator-text-muted hover:border-notator-accent hover:text-notator-accent"
            title="Step back (1 beat)"
            id="nav-step-back"
          >
            |◀
          </button>
          <button
            onClick={handleStepForward}
            className="notator-btn rounded border-notator-border bg-notator-bg px-1 py-1.5 text-[10px] text-notator-text-muted hover:border-notator-accent hover:text-notator-accent"
            title="Step forward (1 beat)"
            id="nav-step-forward"
          >
            ▶|
          </button>
          <button
            onClick={handleFastForward}
            className="notator-btn rounded border-notator-border bg-notator-bg px-1 py-1.5 text-[10px] text-notator-text-muted hover:border-notator-accent hover:text-notator-accent"
            title="Fast forward (1 bar)"
            id="nav-fast-forward"
          >
            ▶▶
          </button>
        </div>
      </div>

      {/* ── EDIT ── */}
      <div className="border-b border-notator-border/30 px-3 py-1.5">
        <button
          onClick={() => onEdit(selectedTrackIndex)}
          className="notator-btn w-full rounded border-notator-border bg-notator-bg px-2 py-1.5 text-[10px] text-notator-text-muted hover:border-notator-accent hover:text-notator-accent"
          title="Open piano roll editor for selected track"
          id="btn-edit-track"
        >
          EDIT
        </button>
      </div>

      {/* ── TRANSPORT: STOP / START / CONT ── */}
      <div className="px-3 py-2">
        <div className="grid grid-cols-3 gap-1">
          {/* STOP */}
          <button
            onClick={onStop}
            className={`notator-btn rounded px-1 py-2 text-[10px] ${
              playbackState === "stopped"
                ? "border-notator-red bg-notator-red/20 text-notator-red"
                : "border-notator-border text-notator-text-muted hover:border-notator-red hover:text-notator-red"
            }`}
            id="panel-transport-stop"
          >
            STOP
          </button>

          {/* START */}
          <button
            onClick={onPlay}
            className={`notator-btn rounded px-1 py-2 text-[10px] ${
              playbackState === "playing"
                ? "border-notator-green bg-notator-green/20 text-notator-green"
                : "border-notator-border text-notator-text-muted hover:border-notator-green hover:text-notator-green"
            }`}
            id="panel-transport-start"
          >
            START
          </button>

          {/* CONT */}
          <button
            onClick={playbackState === "playing" ? onPause : onPlay}
            className={`notator-btn rounded px-1 py-2 text-[10px] ${
              playbackState === "paused"
                ? "border-notator-accent bg-notator-accent/20 text-notator-accent"
                : "border-notator-border text-notator-text-muted hover:border-notator-accent hover:text-notator-accent"
            }`}
            id="panel-transport-cont"
          >
            CONT
          </button>
        </div>
      </div>
    </div>
  );
}
