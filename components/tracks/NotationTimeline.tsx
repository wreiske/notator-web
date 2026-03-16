"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import type { Track } from "@/lib/son-parser/types";

/** Resolved note with start, end, and duration in ticks */
interface ResolvedNote {
  trackIndex: number;
  note: number;
  velocity: number;
  startTick: number;
  endTick: number;
  channel: number;
}

/** Track color palette — matches the Notator blue theme */
const TRACK_COLORS = [
  "#4488ff", // blue primary
  "#44cc88", // green
  "#ff5566", // red
  "#ffbb44", // amber
  "#44ddff", // cyan
  "#aa66ff", // purple
  "#ff8844", // orange
  "#88cc44", // lime
  "#ff44aa", // pink
  "#44aaff", // light blue
  "#cccc44", // yellow
  "#ff6644", // coral
  "#44ffcc", // teal
  "#8888ff", // periwinkle
  "#ff88cc", // rose
  "#66cccc", // sage
];

interface NotationTimelineProps {
  tracks: Track[];
  ticksPerMeasure: number;
  ticksPerBeat: number;
  totalTicks: number;
  currentTick: number;
  selectedTrackIndex: number;
  isPlaying: boolean;
  onSeek?: (tick: number) => void;
}

/** Piano key labels for the left gutter */
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
function noteName(n: number): string {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}
function isBlackKey(n: number): boolean {
  return [1, 3, 6, 8, 10].includes(n % 12);
}

export function NotationTimeline({
  tracks,
  ticksPerMeasure,
  ticksPerBeat,
  totalTicks,
  currentTick,
  selectedTrackIndex,
  isPlaying,
  onSeek,
}: NotationTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showAllTracks, setShowAllTracks] = useState(true);

  // ─── Resolve note_on/note_off pairs into ResolvedNote[] ──────────
  const { resolvedNotes, minNote, maxNote, minTick, maxTick } = useMemo(() => {
    const notes: ResolvedNote[] = [];
    let mn = 127;
    let mx = 0;
    let mt = Infinity;
    let xt = 0;

    const tracksToProcess = showAllTracks
      ? tracks
      : [tracks[selectedTrackIndex]].filter(Boolean);

    const trackStartIndex = showAllTracks ? 0 : selectedTrackIndex;

    tracksToProcess.forEach((track, i) => {
      const realIndex = showAllTracks ? i : trackStartIndex;
      const pending = new Map<number, { velocity: number; tick: number }>();

      for (const event of track.events) {
        if (event.type === "note_on") {
          pending.set(event.note, {
            velocity: event.velocity,
            tick: event.tick,
          });
        } else if (event.type === "note_off") {
          const start = pending.get(event.note);
          if (start) {
            notes.push({
              trackIndex: realIndex,
              note: event.note,
              velocity: start.velocity,
              startTick: start.tick,
              endTick: event.tick,
              channel: track.channel,
            });
            if (event.note < mn) mn = event.note;
            if (event.note > mx) mx = event.note;
            if (start.tick < mt) mt = start.tick;
            if (event.tick > xt) xt = event.tick;
            pending.delete(event.note);
          }
        }
      }

      // Close any unclosed notes at the end of the pattern
      for (const [noteNum, start] of pending) {
        notes.push({
          trackIndex: realIndex,
          note: noteNum,
          velocity: start.velocity,
          startTick: start.tick,
          endTick: totalTicks,
          channel: track.channel,
        });
        if (noteNum < mn) mn = noteNum;
        if (noteNum > mx) mx = noteNum;
        if (start.tick < mt) mt = start.tick;
        if (totalTicks > xt) xt = totalTicks;
      }
    });

    // Add a 2-note margin on each side for readability
    return {
      resolvedNotes: notes,
      minNote: Math.max(0, mn - 2),
      maxNote: Math.min(127, mx + 2),
      minTick: mt === Infinity ? 0 : mt,
      maxTick: xt,
    };
  }, [tracks, selectedTrackIndex, showAllTracks, totalTicks]);

  // ─── Canvas dimensions ───────────────────────────────────────────
  const GUTTER_WIDTH = 44; // Left note labels
  const NOTE_HEIGHT = 10; // Pixel height per MIDI note row
  const PIXELS_PER_BEAT = 24; // Horizontal scale

  // Snap the display start to one measure before the first note
  const displayStartTick = Math.max(
    0,
    Math.floor(minTick / ticksPerMeasure) * ticksPerMeasure - ticksPerMeasure,
  );
  // Display ends one measure after the last note (or totalTicks)
  const displayEndTick = Math.min(
    totalTicks,
    Math.ceil(maxTick / ticksPerMeasure) * ticksPerMeasure + ticksPerMeasure,
  );
  const displayTicks = displayEndTick - displayStartTick;

  const noteRange = maxNote - minNote + 1;
  const canvasHeight = Math.max(120, noteRange * NOTE_HEIGHT + 2);
  const displayBeats = displayTicks / ticksPerBeat;
  const canvasWidth = Math.max(
    600,
    GUTTER_WIDTH + displayBeats * PIXELS_PER_BEAT + 20,
  );

  /** Convert a tick position to an X pixel coordinate */
  const tickToX = useCallback(
    (tick: number) =>
      GUTTER_WIDTH +
      ((tick - displayStartTick) / ticksPerBeat) * PIXELS_PER_BEAT,
    [displayStartTick, ticksPerBeat],
  );

  /** Convert an X pixel coordinate back to a tick */
  const xToTick = useCallback(
    (x: number) =>
      displayStartTick + ((x - GUTTER_WIDTH) / PIXELS_PER_BEAT) * ticksPerBeat,
    [displayStartTick, ticksPerBeat],
  );

  // ── Click-to-seek on the canvas ──────────────────────────────────
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onSeek) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const x = (e.clientX - rect.left) * scaleX;
      if (x < GUTTER_WIDTH) return;

      const tick = xToTick(x);
      // Snap to the nearest beat
      const snappedTick = Math.round(tick / ticksPerBeat) * ticksPerBeat;
      const clampedTick = Math.max(0, Math.min(snappedTick, totalTicks));
      onSeek(clampedTick);
    },
    [onSeek, canvasWidth, xToTick, ticksPerBeat, totalTicks],
  );

  // Auto-scroll during playback
  useEffect(() => {
    if (!isPlaying || !containerRef.current) return;
    const cursorX = tickToX(currentTick);
    const container = containerRef.current;
    const viewWidth = container.clientWidth;
    const targetScroll = cursorX - viewWidth / 3;
    if (Math.abs(container.scrollLeft - targetScroll) > viewWidth / 4) {
      container.scrollLeft = Math.max(0, targetScroll);
    }
  }, [currentTick, isPlaying, tickToX]);

  // ─── Draw the canvas ────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = "#080828";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // ─── Piano key gutter (left side) ─────────────────────────────
    for (let n = maxNote; n >= minNote; n--) {
      const y = (maxNote - n) * NOTE_HEIGHT;
      const black = isBlackKey(n);
      ctx.fillStyle = black ? "#0a0a30" : "#0e1647";
      ctx.fillRect(0, y, GUTTER_WIDTH - 1, NOTE_HEIGHT);

      // Note label
      if (n % 12 === 0 || n === minNote || n === maxNote) {
        ctx.fillStyle = "#6678aa";
        ctx.font = "8px 'IBM Plex Mono', monospace";
        ctx.fillText(noteName(n), 2, y + NOTE_HEIGHT - 2);
      }

      // Horizontal grid line
      ctx.strokeStyle = n % 12 === 0 ? "#2a3f9944" : "#2a3f9922";
      ctx.beginPath();
      ctx.moveTo(GUTTER_WIDTH, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }

    // Gutter separator
    ctx.strokeStyle = "#4466cc";
    ctx.beginPath();
    ctx.moveTo(GUTTER_WIDTH - 1, 0);
    ctx.lineTo(GUTTER_WIDTH - 1, canvasHeight);
    ctx.stroke();

    // ─── Beat / bar grid lines ──────────────────────────────────
    const beatsPerMeasure = ticksPerMeasure / ticksPerBeat;
    // Start at the first full measure at or after displayStartTick
    const firstMeasure = Math.floor(displayStartTick / ticksPerMeasure);
    const lastMeasure = Math.ceil(displayEndTick / ticksPerMeasure);

    for (let m = firstMeasure; m <= lastMeasure; m++) {
      for (let b = 0; b < beatsPerMeasure; b++) {
        const absTick = m * ticksPerMeasure + b * ticksPerBeat;
        if (absTick < displayStartTick || absTick > displayEndTick) continue;
        const x = tickToX(absTick);
        if (x > canvasWidth) break;

        ctx.strokeStyle = b === 0 ? "#4466cc88" : "#2a3f9933";
        ctx.lineWidth = b === 0 ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();

        // Bar numbers at beat 0
        if (b === 0) {
          ctx.fillStyle = "#6678aa";
          ctx.font = "8px 'IBM Plex Mono', monospace";
          ctx.fillText(String(m + 1), x + 2, 8);
        }
      }
    }
    ctx.lineWidth = 1;

    // ─── Note rectangles ──────────────────────────────────────────
    for (const rn of resolvedNotes) {
      const y = (maxNote - rn.note) * NOTE_HEIGHT + 1;
      const x = tickToX(rn.startTick);
      const w = Math.max(
        2,
        ((rn.endTick - rn.startTick) / ticksPerBeat) * PIXELS_PER_BEAT,
      );

      const color = TRACK_COLORS[rn.trackIndex % TRACK_COLORS.length];
      const alpha =
        !showAllTracks || rn.trackIndex === selectedTrackIndex ? "cc" : "55";

      ctx.fillStyle = color + alpha;
      ctx.fillRect(x, y, w, NOTE_HEIGHT - 2);

      // Subtle border on top/bottom
      ctx.strokeStyle = color + "88";
      ctx.strokeRect(x, y, w, NOTE_HEIGHT - 2);
    }

    // ─── Playback cursor ──────────────────────────────────────────
    if (currentTick > 0) {
      const cursorX = tickToX(currentTick);
      if (cursorX >= GUTTER_WIDTH && cursorX <= canvasWidth) {
        ctx.strokeStyle = "#ff5566";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cursorX, 0);
        ctx.lineTo(cursorX, canvasHeight);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
  }, [
    resolvedNotes,
    minNote,
    maxNote,
    canvasWidth,
    canvasHeight,
    ticksPerMeasure,
    ticksPerBeat,
    currentTick,
    showAllTracks,
    selectedTrackIndex,
    displayStartTick,
    displayEndTick,
    tickToX,
  ]);

  // Redraw on changes
  useEffect(() => {
    draw();
  }, [draw]);

  // Compute display bar range for the toolbar
  const displayStartBar = Math.floor(displayStartTick / ticksPerMeasure) + 1;

  if (resolvedNotes.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-[11px] text-notator-text-dim">
        No notes in this pattern
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-notator-border bg-notator-surface px-3 py-1 text-[10px]">
        <span className="font-bold uppercase tracking-widest text-notator-text-dim">
          Score
        </span>
        <button
          onClick={() => setShowAllTracks((v) => !v)}
          className={`rounded px-2 py-0.5 text-[9px] font-bold ${
            showAllTracks
              ? "bg-notator-accent/20 text-notator-accent"
              : "bg-notator-bg/50 text-notator-text-dim"
          }`}
          id="timeline-toggle-all"
        >
          {showAllTracks ? "ALL TRACKS" : `TRACK ${selectedTrackIndex + 1}`}
        </button>
        <span className="text-notator-text-dim">
          {resolvedNotes.length} notes
        </span>
        <span className="text-notator-text-dim">·</span>
        <span className="text-notator-text-dim">
          {noteName(minNote)}–{noteName(maxNote)}
        </span>
        {displayStartBar > 1 && (
          <>
            <span className="text-notator-text-dim">·</span>
            <span className="text-notator-text-dim">
              from bar {displayStartBar}
            </span>
          </>
        )}
        {/* Track color legend (when showing all) */}
        {showAllTracks && (
          <div className="ml-auto flex gap-1">
            {tracks.slice(0, 8).map((t, i) => (
              <span
                key={i}
                className="flex items-center gap-0.5 text-[8px]"
                style={{ color: TRACK_COLORS[i % TRACK_COLORS.length] }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-sm"
                  style={{
                    backgroundColor: TRACK_COLORS[i % TRACK_COLORS.length],
                  }}
                />
                {t.name || i + 1}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Scrollable canvas */}
      <div
        ref={containerRef}
        className="overflow-x-auto overflow-y-hidden"
        style={{ maxHeight: `${Math.min(canvasHeight, 240)}px` }}
      >
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          style={{ cursor: onSeek ? "pointer" : "default" }}
        />
      </div>
    </div>
  );
}
