"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type {
  Track,
  TrackEvent,
  NoteOnEvent,
  NoteOffEvent,
} from "@/lib/son-parser/types";

// ═══════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════

/** A resolved note with start/end for display and editing */
interface EditorNote {
  id: number;
  note: number; // MIDI note 0-127
  velocity: number; // 1-127
  startTick: number;
  endTick: number;
}

type Tool = "pointer" | "draw" | "erase";

interface SnapOption {
  label: string;
  divisor: number; // fraction of a beat (1 = beat, 2 = 1/8, 4 = 1/16, etc.)
}

const SNAP_OPTIONS: SnapOption[] = [
  { label: "1/1", divisor: 0.25 },
  { label: "1/2", divisor: 0.5 },
  { label: "1/4", divisor: 1 },
  { label: "1/8", divisor: 2 },
  { label: "1/16", divisor: 4 },
  { label: "1/32", divisor: 8 },
];

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

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

/** Resolve note_on/note_off pairs into EditorNote[] */
function resolveNotes(events: TrackEvent[], totalTicks: number): EditorNote[] {
  const notes: EditorNote[] = [];
  const pending = new Map<number, { velocity: number; tick: number }>();
  let nextId = 1;

  for (const event of events) {
    if (event.type === "note_on") {
      pending.set(event.note, { velocity: event.velocity, tick: event.tick });
    } else if (event.type === "note_off") {
      const start = pending.get(event.note);
      if (start) {
        notes.push({
          id: nextId++,
          note: event.note,
          velocity: start.velocity,
          startTick: start.tick,
          endTick: event.tick,
        });
        pending.delete(event.note);
      }
    }
  }
  // Close unclosed notes
  for (const [noteNum, start] of pending) {
    notes.push({
      id: nextId++,
      note: noteNum,
      velocity: start.velocity,
      startTick: start.tick,
      endTick: totalTicks,
    });
  }
  return notes;
}

/** Convert EditorNote[] back to TrackEvent[] (sorted by tick) */
function notesToEvents(notes: EditorNote[]): TrackEvent[] {
  const events: TrackEvent[] = [];
  const raw = new Uint8Array(6); // placeholder raw

  for (const n of notes) {
    events.push({
      type: "note_on",
      tick: n.startTick,
      note: n.note,
      velocity: n.velocity,
      raw: new Uint8Array(raw),
    } as NoteOnEvent);
    events.push({
      type: "note_off",
      tick: n.endTick,
      note: n.note,
      raw: new Uint8Array(raw),
    } as NoteOffEvent);
  }

  // Keep non-note events from original track
  events.sort((a, b) => a.tick - b.tick || (a.type === "note_on" ? -1 : 1));
  return events;
}

// ═══════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════

interface PianoRollEditorProps {
  track: Track;
  trackIndex: number;
  ticksPerBeat: number;
  ticksPerMeasure: number;
  totalTicks: number;
  currentTick: number;
  isPlaying: boolean;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  onSave: (trackIndex: number, events: TrackEvent[]) => void;
  onClose: () => void;
  onPreviewNote?: (note: number, velocity: number) => void;
  onSeek?: (tick: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onToggleLoop?: () => void;
  onSetLoopRegion?: (start: number, end: number) => void;
  isSoloed?: boolean;
  onToggleSolo?: () => void;
}

export function PianoRollEditor({
  track,
  trackIndex,
  ticksPerBeat,
  ticksPerMeasure,
  totalTicks,
  currentTick,
  isPlaying,
  loopEnabled,
  loopStart,
  loopEnd,
  onSave,
  onClose,
  onPreviewNote,
  onSeek,
  onPlay,
  onPause,
  onStop,
  onToggleLoop,
  onSetLoopRegion,
  isSoloed,
  onToggleSolo,
}: PianoRollEditorProps) {
  // ─── State ────────────────────────────────────────────────────────
  const [notes, setNotes] = useState<EditorNote[]>(() =>
    resolveNotes(track.events, totalTicks),
  );
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [tool, setTool] = useState<Tool>("pointer");
  const [snapIndex, setSnapIndex] = useState(3); // default 1/8
  const [isDirty, setIsDirty] = useState(false);

  // ─── Undo / Redo history ──────────────────────────────────────────
  type HistoryEntry = { notes: EditorNote[]; label: string; timestamp: number };
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const MAX_HISTORY = 50;

  // Snapshot current notes before a mutation
  const pushHistory = useCallback(
    (label: string) => {
      setUndoStack((prev) => {
        const entry: HistoryEntry = {
          notes: notes.map((n) => ({ ...n })),
          label,
          timestamp: Date.now(),
        };
        const next = [...prev, entry];
        if (next.length > MAX_HISTORY) next.shift();
        return next;
      });
      setRedoStack([]); // clear redo on new action
    },
    [notes],
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = [...undoStack];
    const entry = prev.pop()!;
    setUndoStack(prev);
    // Push current state to redo
    setRedoStack((r) => [
      ...r,
      {
        notes: notes.map((n) => ({ ...n })),
        label: entry.label,
        timestamp: Date.now(),
      },
    ]);
    setNotes(entry.notes);
    setIsDirty(true);
  }, [undoStack, notes]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const prev = [...redoStack];
    const entry = prev.pop()!;
    setRedoStack(prev);
    // Push current state to undo
    setUndoStack((u) => [
      ...u,
      {
        notes: notes.map((n) => ({ ...n })),
        label: entry.label,
        timestamp: Date.now(),
      },
    ]);
    setNotes(entry.notes);
    setIsDirty(true);
  }, [redoStack, notes]);

  // Drag state
  const [dragState, setDragState] = useState<{
    type: "move" | "resize";
    noteId: number;
    startMouseX: number;
    startMouseY: number;
    origNote: EditorNote;
    origSelectedNotes: Map<number, EditorNote>;
  } | null>(null);

  // Marquee selection state
  const [marquee, setMarquee] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  // Velocity drawing state
  const [velDraw, setVelDraw] = useState<{
    active: boolean;
    mouseY: number; // canvas-local Y for guide line
    mouseX: number; // canvas-local X for tooltip positioning
  }>({ active: false, mouseY: -1, mouseX: -1 });

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const velocityCanvasRef = useRef<HTMLCanvasElement>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
  const hScrollRef = useRef<HTMLDivElement>(null);
  const lastPreviewNoteRef = useRef<number>(-1);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Performance: overlay canvases for cursor (avoids full redraw) ──
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const velOverlayRef = useRef<HTMLCanvasElement>(null);
  const rulerOverlayRef = useRef<HTMLCanvasElement>(null);
  const cursorRafRef = useRef(0);
  const currentTickRef = useRef(currentTick);
  currentTickRef.current = currentTick;

  // ─── Layout constants ─────────────────────────────────────────────
  const GUTTER_WIDTH = 52;
  const NOTE_HEIGHT = 14;
  const PIXELS_PER_BEAT = 40;
  const VELOCITY_HEIGHT = 100;
  const RULER_HEIGHT = 28;
  const TOTAL_NOTES = 128;
  const snapTicks = ticksPerBeat / SNAP_OPTIONS[snapIndex].divisor;

  // Canvas dimensions
  const totalMeasures = Math.ceil(totalTicks / ticksPerMeasure) + 2;
  const canvasWidth =
    GUTTER_WIDTH +
    totalMeasures * (ticksPerMeasure / ticksPerBeat) * PIXELS_PER_BEAT;
  const canvasHeight = TOTAL_NOTES * NOTE_HEIGHT;

  // ─── Note range for auto-scroll ───────────────────────────────────
  const { minNote, maxNote } = useMemo(() => {
    if (notes.length === 0) return { minNote: 48, maxNote: 84 };
    let mn = 127,
      mx = 0;
    for (const n of notes) {
      if (n.note < mn) mn = n.note;
      if (n.note > mx) mx = n.note;
    }
    return { minNote: mn, maxNote: mx };
  }, [notes]);

  // Selected note for inspector
  const selectedNote = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    const id = selectedIds.values().next().value;
    return notes.find((n) => n.id === id) ?? null;
  }, [notes, selectedIds]);

  // ─── Coordinate helpers ───────────────────────────────────────────
  const tickToX = useCallback(
    (tick: number) => GUTTER_WIDTH + (tick / ticksPerBeat) * PIXELS_PER_BEAT,
    [ticksPerBeat],
  );
  const xToTick = useCallback(
    (x: number) => ((x - GUTTER_WIDTH) / PIXELS_PER_BEAT) * ticksPerBeat,
    [ticksPerBeat],
  );
  const noteToY = useCallback((note: number) => (127 - note) * NOTE_HEIGHT, []);
  const yToNote = useCallback(
    (y: number) => 127 - Math.floor(y / NOTE_HEIGHT),
    [],
  );
  const snapToGrid = useCallback(
    (tick: number) => Math.round(tick / snapTicks) * snapTicks,
    [snapTicks],
  );

  // ─── Next ID ──────────────────────────────────────────────────────
  const nextIdRef = useRef(
    notes.length > 0 ? Math.max(...notes.map((n) => n.id)) + 1 : 1,
  );

  // ─── Canvas drawing ───────────────────────────────────────────────
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

    // Background
    ctx.fillStyle = "#080828";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // ─── Piano key gutter ─────────────────────────────────────────
    for (let n = 127; n >= 0; n--) {
      const y = noteToY(n);
      const black = isBlackKey(n);
      ctx.fillStyle = black ? "#0a0a30" : "#0e1647";
      ctx.fillRect(0, y, GUTTER_WIDTH - 1, NOTE_HEIGHT);

      // Note labels at every C and selected octave boundaries
      if (n % 12 === 0) {
        ctx.fillStyle = "#8899cc";
        ctx.font = "bold 9px 'IBM Plex Mono', monospace";
        ctx.fillText(noteName(n), 4, y + NOTE_HEIGHT - 3);
      }

      // Row background (alternating)
      if (black) {
        ctx.fillStyle = "rgba(0,0,0,0.15)";
        ctx.fillRect(GUTTER_WIDTH, y, canvasWidth - GUTTER_WIDTH, NOTE_HEIGHT);
      }

      // Horizontal grid lines
      ctx.strokeStyle = n % 12 === 0 ? "#2a3f9955" : "#2a3f9920";
      ctx.beginPath();
      ctx.moveTo(GUTTER_WIDTH, y + NOTE_HEIGHT);
      ctx.lineTo(canvasWidth, y + NOTE_HEIGHT);
      ctx.stroke();
    }

    // Gutter separator
    ctx.strokeStyle = "#4466cc";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(GUTTER_WIDTH - 0.5, 0);
    ctx.lineTo(GUTTER_WIDTH - 0.5, canvasHeight);
    ctx.stroke();

    // ─── Beat/bar grid ────────────────────────────────────────────
    const beatsPerMeasure = ticksPerMeasure / ticksPerBeat;
    const totalBeats = totalMeasures * beatsPerMeasure;

    for (let b = 0; b <= totalBeats; b++) {
      const tick = b * ticksPerBeat;
      const x = tickToX(tick);
      if (x > canvasWidth) break;

      const isBar = b % beatsPerMeasure === 0;
      ctx.strokeStyle = isBar ? "#4466cc66" : "#2a3f9933";
      ctx.lineWidth = isBar ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();

      // Bar numbers
      if (isBar) {
        ctx.fillStyle = "#6678aa";
        ctx.font = "9px 'IBM Plex Mono', monospace";
        ctx.fillText(String(b / beatsPerMeasure + 1), x + 3, 12);
      }
    }
    ctx.lineWidth = 1;

    // ─── Sub-beat grid (snap lines) ───────────────────────────────
    if (SNAP_OPTIONS[snapIndex].divisor > 1) {
      const subBeats = SNAP_OPTIONS[snapIndex].divisor;
      for (let b = 0; b <= totalBeats; b++) {
        for (let s = 1; s < subBeats; s++) {
          const tick = b * ticksPerBeat + (s * ticksPerBeat) / subBeats;
          const x = tickToX(tick);
          if (x > canvasWidth) break;
          ctx.strokeStyle = "#2a3f9918";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvasHeight);
          ctx.stroke();
        }
      }
      ctx.lineWidth = 1;
    }

    // ─── Note rectangles ──────────────────────────────────────────
    // NOTE: Active note highlights and cursor are drawn on the overlay canvas
    // via rAF (see drawCursorOverlay). They are NOT drawn here.

    // Second pass: draw note bodies
    for (const n of notes) {
      const y = noteToY(n.note) + 1;
      const x = tickToX(n.startTick);
      const w = Math.max(
        3,
        ((n.endTick - n.startTick) / ticksPerBeat) * PIXELS_PER_BEAT,
      );
      const isSelected = selectedIds.has(n.id);

      // Color based on velocity
      const velRatio = n.velocity / 127;
      const r = Math.round(60 + velRatio * 195);
      const g = Math.round(40 + velRatio * 60);
      const b_val = Math.round(40 + velRatio * 60);

      if (isSelected) {
        ctx.fillStyle = "#ffbb44dd";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
      } else {
        ctx.fillStyle = `rgba(${r},${g},${b_val},0.85)`;
        ctx.strokeStyle = `rgba(${r + 40},${g + 40},${b_val + 40},0.6)`;
        ctx.lineWidth = 1;
      }

      // Note body
      const radius = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, NOTE_HEIGHT - 2, radius);
      ctx.fill();
      ctx.stroke();

      // Note name inside (if wide enough)
      if (w > 28) {
        ctx.fillStyle = isSelected ? "#000" : "#fff";
        ctx.font = "bold 8px 'IBM Plex Mono', monospace";
        ctx.fillText(noteName(n.note), x + 3, y + NOTE_HEIGHT - 5);
      }

      // Resize handle (right edge)
      ctx.fillStyle = isSelected ? "#fff8" : "#fff3";
      ctx.fillRect(x + w - 4, y + 2, 3, NOTE_HEIGHT - 6);

      ctx.lineWidth = 1;
    }

    // Marquee selection rectangle overlay
    if (marquee) {
      const mx = Math.min(marquee.startX, marquee.endX);
      const my = Math.min(marquee.startY, marquee.endY);
      const mw = Math.abs(marquee.endX - marquee.startX);
      const mh = Math.abs(marquee.endY - marquee.startY);

      ctx.fillStyle = "rgba(100, 150, 255, 0.12)";
      ctx.fillRect(mx, my, mw, mh);

      ctx.strokeStyle = "rgba(100, 150, 255, 0.6)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.setLineDash([]);
    }

    // NOTE: Playback cursor is drawn on the overlay canvas via rAF.
  }, [
    notes,
    selectedIds,
    canvasWidth,
    canvasHeight,
    ticksPerMeasure,
    ticksPerBeat,
    totalMeasures,
    snapIndex,
    tickToX,
    noteToY,
    marquee,
  ]);

  // ─── Velocity lane drawing ────────────────────────────────────────
  const drawVelocity = useCallback(() => {
    const canvas = velocityCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = VELOCITY_HEIGHT * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${VELOCITY_HEIGHT}px`;
    ctx.scale(dpr, dpr);

    const PAD = 4; // top/bottom padding inside velocity lane
    const drawH = VELOCITY_HEIGHT - PAD * 2; // usable drawing height

    ctx.fillStyle = "#050520";
    ctx.fillRect(0, 0, canvasWidth, VELOCITY_HEIGHT);

    // Label
    ctx.fillStyle = "#6678aa";
    ctx.font = "8px 'IBM Plex Mono', monospace";
    ctx.fillText("VEL", 4, 10);

    // Separator
    ctx.strokeStyle = "#4466cc";
    ctx.beginPath();
    ctx.moveTo(GUTTER_WIDTH - 0.5, 0);
    ctx.lineTo(GUTTER_WIDTH - 0.5, VELOCITY_HEIGHT);
    ctx.stroke();

    // Horizontal guide lines at 32, 64, 96, 127
    const guideLevels = [32, 64, 96, 127];
    for (const level of guideLevels) {
      const gy = VELOCITY_HEIGHT - PAD - (level / 127) * drawH;
      ctx.strokeStyle = "#2a3f9930";
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(GUTTER_WIDTH, gy);
      ctx.lineTo(canvasWidth, gy);
      ctx.stroke();
      ctx.setLineDash([]);
      // Guide label in gutter
      ctx.fillStyle = "#4466aa55";
      ctx.font = "7px 'IBM Plex Mono', monospace";
      ctx.fillText(String(level), 4, gy + 3);
    }
    ctx.lineWidth = 1;

    // Velocity bars
    const BAR_W = 6;
    for (const n of notes) {
      const x = tickToX(n.startTick);
      const barH = (n.velocity / 127) * drawH;
      const isSelected = selectedIds.has(n.id);

      // Velocity color gradient: low=blue, mid=green, high=orange/red
      let barColor: string;
      if (isSelected) {
        barColor = "#ffbb44dd";
      } else {
        const v = n.velocity / 127;
        if (v < 0.4) barColor = `rgba(68, 136, 255, ${0.6 + v})`;
        else if (v < 0.75) barColor = `rgba(68, 200, 136, ${0.5 + v * 0.5})`;
        else
          barColor = `rgba(255, ${Math.round(180 - v * 80)}, 68, ${0.7 + v * 0.3})`;
      }

      ctx.fillStyle = barColor;
      ctx.fillRect(x - BAR_W / 2, VELOCITY_HEIGHT - PAD - barH, BAR_W, barH);

      // Velocity value label on top of bar (if selected)
      if (isSelected) {
        ctx.fillStyle = "#ffdd88";
        ctx.font = "bold 7px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(n.velocity), x, VELOCITY_HEIGHT - PAD - barH - 3);
        ctx.textAlign = "left";
      }
    }

    // Velocity draw guide line (horizontal line at mouse Y)
    if (velDraw.mouseY >= 0) {
      const gy = velDraw.mouseY;
      ctx.strokeStyle = "#ffbb4488";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(GUTTER_WIDTH, gy);
      ctx.lineTo(canvasWidth, gy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Compute velocity from Y for tooltip
      const velFromY = Math.round(
        Math.max(
          0,
          Math.min(127, ((VELOCITY_HEIGHT - PAD - gy) / drawH) * 127),
        ),
      );
      // Tooltip near mouse
      ctx.fillStyle = "#0c0c3dee";
      ctx.fillRect(velDraw.mouseX + 10, gy - 10, 32, 16);
      ctx.strokeStyle = "#ffbb44";
      ctx.lineWidth = 1;
      ctx.strokeRect(velDraw.mouseX + 10, gy - 10, 32, 16);
      ctx.fillStyle = "#ffbb44";
      ctx.font = "bold 9px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(velFromY), velDraw.mouseX + 26, gy + 2);
      ctx.textAlign = "left";
      ctx.lineWidth = 1;
    }

    // NOTE: Playback cursor in velocity lane drawn on overlay via rAF.
  }, [notes, selectedIds, canvasWidth, tickToX, velDraw]);

  // ─── Note preview ─────────────────────────────────────────────────
  const previewNote = useCallback(
    (notePitch: number, velocity: number = 100) => {
      if (!onPreviewNote) return;
      // Avoid re-triggering the same note repeatedly during drag
      if (notePitch === lastPreviewNoteRef.current) return;
      lastPreviewNoteRef.current = notePitch;

      onPreviewNote(notePitch, velocity);

      // Auto-release after 200ms
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewTimerRef.current = setTimeout(() => {
        lastPreviewNoteRef.current = -1;
      }, 200);
    },
    [onPreviewNote],
  );

  // ─── Ruler drawing ────────────────────────────────────────────────
  const drawRuler = useCallback(() => {
    const canvas = rulerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = RULER_HEIGHT * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${RULER_HEIGHT}px`;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = "#0a0a35";
    ctx.fillRect(0, 0, canvasWidth, RULER_HEIGHT);

    // Gutter area
    ctx.fillStyle = "#060624";
    ctx.fillRect(0, 0, GUTTER_WIDTH, RULER_HEIGHT);

    // Loop region highlight
    if (loopEnabled && loopStart >= 0 && loopEnd > loopStart) {
      const x1 = tickToX(loopStart);
      const x2 = tickToX(loopEnd);
      ctx.fillStyle = "rgba(68, 204, 136, 0.15)";
      ctx.fillRect(x1, 0, x2 - x1, RULER_HEIGHT);

      // Loop markers
      ctx.fillStyle = "#44cc88";
      ctx.fillRect(x1 - 1, 0, 3, RULER_HEIGHT);
      ctx.fillRect(x2 - 1, 0, 3, RULER_HEIGHT);

      // Loop flags
      ctx.font = "bold 8px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "#44cc88";
      ctx.fillText("L", x1 + 4, 10);
      ctx.fillText("R", x2 - 10, 10);
    }

    // Beat/bar ticks
    const beatsPerMeasure = ticksPerMeasure / ticksPerBeat;
    const totalBeats = totalMeasures * beatsPerMeasure;

    for (let b = 0; b <= totalBeats; b++) {
      const tick = b * ticksPerBeat;
      const x = tickToX(tick);
      if (x > canvasWidth) break;

      const isBar = b % beatsPerMeasure === 0;
      ctx.strokeStyle = isBar ? "#4466cc88" : "#2a3f9944";
      ctx.lineWidth = isBar ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, isBar ? 0 : RULER_HEIGHT - 6);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.stroke();

      if (isBar) {
        ctx.fillStyle = "#8899cc";
        ctx.font = "bold 9px 'IBM Plex Mono', monospace";
        ctx.fillText(String(b / beatsPerMeasure + 1), x + 3, RULER_HEIGHT - 6);
      }
    }
    ctx.lineWidth = 1;

    // NOTE: Playback cursor in ruler drawn on overlay via rAF.
  }, [
    canvasWidth,
    ticksPerMeasure,
    ticksPerBeat,
    totalMeasures,
    loopEnabled,
    loopStart,
    loopEnd,
    tickToX,
  ]);

  // Redraw on changes
  useEffect(() => {
    draw();
  }, [draw]);
  useEffect(() => {
    drawVelocity();
  }, [drawVelocity]);
  useEffect(() => {
    drawRuler();
  }, [drawRuler]);

  // ── Performance: lightweight cursor overlay via rAF ──────────────
  // Draws ONLY the playback cursor line and active note highlights
  // on transparent overlay canvases. Runs at display refresh rate
  // without causing React re-renders or expensive full canvas redraws.
  useEffect(() => {
    let running = true;

    const drawOverlays = () => {
      if (!running) return;
      const tick = currentTickRef.current;

      // ── Main grid overlay (cursor + active note glow) ──
      const overlay = overlayCanvasRef.current;
      if (overlay) {
        const ctx = overlay.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          if (overlay.width !== canvasWidth * dpr) {
            overlay.width = canvasWidth * dpr;
            overlay.height = canvasHeight * dpr;
            overlay.style.width = `${canvasWidth}px`;
            overlay.style.height = `${canvasHeight}px`;
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, canvasWidth, canvasHeight);

          if (tick > 0) {
            // Active note row highlights
            if (isPlaying) {
              for (const n of notes) {
                if (tick >= n.startTick && tick < n.endTick) {
                  const y = noteToY(n.note);
                  ctx.fillStyle = "rgba(0, 220, 255, 0.06)";
                  ctx.fillRect(
                    GUTTER_WIDTH,
                    y,
                    canvasWidth - GUTTER_WIDTH,
                    NOTE_HEIGHT,
                  );
                }
              }

              // Active note glow overlay
              for (const n of notes) {
                if (tick >= n.startTick && tick < n.endTick) {
                  const y = noteToY(n.note) + 1;
                  const x = tickToX(n.startTick);
                  const w = Math.max(
                    3,
                    ((n.endTick - n.startTick) / ticksPerBeat) *
                      PIXELS_PER_BEAT,
                  );
                  const velRatio = n.velocity / 127;

                  ctx.shadowColor = "rgba(0, 220, 255, 0.8)";
                  ctx.shadowBlur = 12;
                  ctx.fillStyle = `rgba(0, 230, 255, ${0.85 + velRatio * 0.15})`;
                  ctx.strokeStyle = "#ffffff";
                  ctx.lineWidth = 1.5;
                  ctx.beginPath();
                  ctx.roundRect(x, y, w, NOTE_HEIGHT - 2, 2);
                  ctx.fill();
                  ctx.stroke();
                  ctx.shadowColor = "transparent";
                  ctx.shadowBlur = 0;
                }
              }
            }

            // Cursor line
            const cx = tickToX(tick);
            if (cx >= GUTTER_WIDTH && cx <= canvasWidth) {
              ctx.strokeStyle = "#ff556688";
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(cx, 0);
              ctx.lineTo(cx, canvasHeight);
              ctx.stroke();
            }
          }
        }
      }

      // ── Velocity overlay (cursor line only) ──
      const velOv = velOverlayRef.current;
      if (velOv) {
        const ctx = velOv.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          if (velOv.width !== canvasWidth * dpr) {
            velOv.width = canvasWidth * dpr;
            velOv.height = VELOCITY_HEIGHT * dpr;
            velOv.style.width = `${canvasWidth}px`;
            velOv.style.height = `${VELOCITY_HEIGHT}px`;
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, canvasWidth, VELOCITY_HEIGHT);
          if (tick > 0) {
            const cx = tickToX(tick);
            if (cx >= GUTTER_WIDTH && cx <= canvasWidth) {
              ctx.strokeStyle = "#ff556688";
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(cx, 0);
              ctx.lineTo(cx, VELOCITY_HEIGHT);
              ctx.stroke();
            }
          }
        }
      }

      // ── Ruler overlay (cursor + head triangle) ──
      const rulerOv = rulerOverlayRef.current;
      if (rulerOv) {
        const ctx = rulerOv.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          if (rulerOv.width !== canvasWidth * dpr) {
            rulerOv.width = canvasWidth * dpr;
            rulerOv.height = RULER_HEIGHT * dpr;
            rulerOv.style.width = `${canvasWidth}px`;
            rulerOv.style.height = `${RULER_HEIGHT}px`;
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, canvasWidth, RULER_HEIGHT);
          if (tick > 0) {
            const cx = tickToX(tick);
            if (cx >= GUTTER_WIDTH && cx <= canvasWidth) {
              ctx.strokeStyle = "#ff5566";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(cx, 0);
              ctx.lineTo(cx, RULER_HEIGHT);
              ctx.stroke();

              // Triangle cursor head
              ctx.fillStyle = "#ff5566";
              ctx.beginPath();
              ctx.moveTo(cx - 4, 0);
              ctx.lineTo(cx + 4, 0);
              ctx.lineTo(cx, 6);
              ctx.closePath();
              ctx.fill();
            }
          }
        }
      }

      cursorRafRef.current = requestAnimationFrame(drawOverlays);
    };

    cursorRafRef.current = requestAnimationFrame(drawOverlays);
    return () => {
      running = false;
      cancelAnimationFrame(cursorRafRef.current);
    };
  }, [
    notes,
    canvasWidth,
    canvasHeight,
    tickToX,
    noteToY,
    isPlaying,
    ticksPerBeat,
  ]);

  // Auto-scroll to note range on mount
  useEffect(() => {
    if (containerRef.current && notes.length > 0) {
      const centerNote = Math.floor((minNote + maxNote) / 2);
      const targetY =
        noteToY(centerNote) - containerRef.current.clientHeight / 2;
      containerRef.current.scrollTop = Math.max(0, targetY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-follow playback cursor during playback
  useEffect(() => {
    if (!isPlaying || currentTick <= 0) return;
    const scrollContainer = hScrollRef.current;
    if (!scrollContainer) return;

    const cx = tickToX(currentTick);
    const viewLeft = scrollContainer.scrollLeft;
    const viewRight = viewLeft + scrollContainer.clientWidth;
    const margin = scrollContainer.clientWidth * 0.15;

    // If cursor is near or past the right edge, scroll to keep it in view
    if (cx > viewRight - margin || cx < viewLeft + GUTTER_WIDTH) {
      scrollContainer.scrollLeft = cx - scrollContainer.clientWidth * 0.3;
    }
  }, [isPlaying, currentTick, tickToX]);

  // ─── Mouse interactions ───────────────────────────────────────────
  const getCanvasCoords = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    [canvasWidth, canvasHeight],
  );

  const hitTestNote = useCallback(
    (
      x: number,
      y: number,
    ): { note: EditorNote | null; isResizeHandle: boolean } => {
      // Check in reverse order (top-most drawn last)
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        const ny = noteToY(n.note) + 1;
        const nx = tickToX(n.startTick);
        const nw = Math.max(
          3,
          ((n.endTick - n.startTick) / ticksPerBeat) * PIXELS_PER_BEAT,
        );

        if (x >= nx && x <= nx + nw && y >= ny && y <= ny + NOTE_HEIGHT - 2) {
          const isResize = x >= nx + nw - 6;
          return { note: n, isResizeHandle: isResize };
        }
      }
      return { note: null, isResizeHandle: false };
    },
    [notes, noteToY, tickToX, ticksPerBeat],
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // left click only
      const { x, y } = getCanvasCoords(e);
      if (x < GUTTER_WIDTH) return; // Clicked on piano keys

      if (tool === "pointer") {
        const { note: hitNote, isResizeHandle } = hitTestNote(x, y);

        if (hitNote) {
          // Select
          if (e.shiftKey) {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(hitNote.id)) next.delete(hitNote.id);
              else next.add(hitNote.id);
              return next;
            });
          } else if (!selectedIds.has(hitNote.id)) {
            setSelectedIds(new Set([hitNote.id]));
          }

          // Preview the note
          previewNote(hitNote.note, hitNote.velocity);

          // Start drag
          const origSelected = new Map<number, EditorNote>();
          const idsToMove = selectedIds.has(hitNote.id)
            ? selectedIds
            : new Set([hitNote.id]);
          for (const id of idsToMove) {
            const n = notes.find((nn) => nn.id === id);
            if (n) origSelected.set(id, { ...n });
          }
          if (!selectedIds.has(hitNote.id)) {
            origSelected.set(hitNote.id, { ...hitNote });
          }

          // Push undo before drag
          pushHistory(isResizeHandle ? "Resize note" : "Move note");

          setDragState({
            type: isResizeHandle ? "resize" : "move",
            noteId: hitNote.id,
            startMouseX: x,
            startMouseY: y,
            origNote: { ...hitNote },
            origSelectedNotes: origSelected,
          });
        } else {
          // Click on empty space — start marquee selection
          if (!e.shiftKey) setSelectedIds(new Set());
          setMarquee({
            startX: x,
            startY: y,
            endX: x,
            endY: y,
          });
        }
      } else if (tool === "draw") {
        const notePitch = yToNote(y);
        const tickRaw = xToTick(x);
        const tick = snapToGrid(tickRaw);

        if (notePitch >= 0 && notePitch <= 127 && tick >= 0) {
          pushHistory("Draw note");
          const newNote: EditorNote = {
            id: nextIdRef.current++,
            note: notePitch,
            velocity: 100,
            startTick: tick,
            endTick: tick + snapTicks,
          };
          setNotes((prev) => [...prev, newNote]);
          setSelectedIds(new Set([newNote.id]));
          setIsDirty(true);
          previewNote(notePitch, 100);
        }
      } else if (tool === "erase") {
        const { note: hitNote } = hitTestNote(x, y);
        if (hitNote) {
          pushHistory("Erase note");
          setNotes((prev) => prev.filter((n) => n.id !== hitNote.id));
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(hitNote.id);
            return next;
          });
          setIsDirty(true);
        }
      }
    },
    [
      tool,
      getCanvasCoords,
      hitTestNote,
      selectedIds,
      notes,
      yToNote,
      xToTick,
      snapToGrid,
      snapTicks,
      previewNote,
      pushHistory,
    ],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCanvasCoords(e);

      // Marquee drag
      if (marquee) {
        setMarquee((prev) => (prev ? { ...prev, endX: x, endY: y } : null));

        // Live-select notes within the rectangle
        const mx1 = Math.min(marquee.startX, x);
        const mx2 = Math.max(marquee.startX, x);
        const my1 = Math.min(marquee.startY, y);
        const my2 = Math.max(marquee.startY, y);

        const newSelection = new Set<number>();
        for (const n of notes) {
          const nx = tickToX(n.startTick);
          const nw = Math.max(
            3,
            ((n.endTick - n.startTick) / ticksPerBeat) * PIXELS_PER_BEAT,
          );
          const ny = noteToY(n.note);
          const nh = NOTE_HEIGHT - 2;

          // Check rectangle intersection
          if (nx + nw > mx1 && nx < mx2 && ny + nh > my1 && ny < my2) {
            newSelection.add(n.id);
          }
        }
        setSelectedIds(newSelection);
        return;
      }

      if (!dragState) return;
      const dx = x - dragState.startMouseX;
      const dy = y - dragState.startMouseY;

      // For move: compute semitone shift once and preview chord if pitch changed
      if (dragState.type === "move") {
        const semitoneShift = -Math.round(dy / NOTE_HEIGHT);
        // Check if pitch actually changed from current notes
        const anchorOrig = dragState.origNote;
        const newAnchorPitch = Math.max(
          0,
          Math.min(127, anchorOrig.note + semitoneShift),
        );
        const currentAnchorNote = notes.find((n) => n.id === dragState.noteId);
        const pitchChanged =
          currentAnchorNote && newAnchorPitch !== currentAnchorNote.note;

        if (pitchChanged && onPreviewNote) {
          // Preview ALL selected notes at their new pitches as a chord
          lastPreviewNoteRef.current = -1; // reset dedup to allow chord
          for (const [id, orig] of dragState.origSelectedNotes) {
            const newPitch = Math.max(
              0,
              Math.min(127, orig.note + semitoneShift),
            );
            const vel = notes.find((n) => n.id === id)?.velocity ?? 100;
            onPreviewNote(newPitch, vel);
          }
          if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
          previewTimerRef.current = setTimeout(() => {
            lastPreviewNoteRef.current = -1;
          }, 200);
        }
      }

      setNotes((prev) =>
        prev.map((n) => {
          const orig = dragState.origSelectedNotes.get(n.id);
          if (!orig) return n;

          if (dragState.type === "move") {
            const newTick = snapToGrid(
              orig.startTick + (dx / PIXELS_PER_BEAT) * ticksPerBeat,
            );
            const duration = orig.endTick - orig.startTick;
            const semitoneShift = -Math.round(dy / NOTE_HEIGHT);
            const newNotePitch = Math.max(
              0,
              Math.min(127, orig.note + semitoneShift),
            );
            return {
              ...n,
              startTick: Math.max(0, newTick),
              endTick: Math.max(newTick + snapTicks, newTick + duration),
              note: newNotePitch,
            };
          } else {
            // Resize
            const newEnd = snapToGrid(
              orig.endTick + (dx / PIXELS_PER_BEAT) * ticksPerBeat,
            );
            return {
              ...n,
              endTick: Math.max(n.startTick + snapTicks, newEnd),
            };
          }
        }),
      );
      setIsDirty(true);
    },
    [
      dragState,
      getCanvasCoords,
      snapToGrid,
      ticksPerBeat,
      snapTicks,
      onPreviewNote,
      marquee,
      notes,
      tickToX,
      noteToY,
    ],
  );

  const handleCanvasMouseUp = useCallback(() => {
    setDragState(null);
    setMarquee(null);
    lastPreviewNoteRef.current = -1;
  }, []);

  // ─── Velocity lane mouse handlers ─────────────────────────────────
  const getVelCanvasCoords = useCallback(
    (e: React.MouseEvent) => {
      const canvas = velocityCanvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const scaleY = VELOCITY_HEIGHT / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    [canvasWidth],
  );

  const velYToVelocity = useCallback((y: number) => {
    const PAD = 4;
    const drawH = VELOCITY_HEIGHT - PAD * 2;
    return Math.round(
      Math.max(1, Math.min(127, ((VELOCITY_HEIGHT - PAD - y) / drawH) * 127)),
    );
  }, []);

  const applyVelocityAtX = useCallback(
    (x: number, vel: number) => {
      // Find selected notes near this X and set their velocity
      const SNAP_RADIUS = 20; // pixels
      setNotes((prev) =>
        prev.map((n) => {
          if (!selectedIds.has(n.id)) return n;
          const nx = tickToX(n.startTick);
          if (Math.abs(nx - x) <= SNAP_RADIUS) {
            return { ...n, velocity: vel };
          }
          return n;
        }),
      );
      setIsDirty(true);
    },
    [selectedIds, tickToX],
  );

  const handleVelMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const { x, y } = getVelCanvasCoords(e);
      if (x < GUTTER_WIDTH) return;
      if (selectedIds.size === 0) return;

      pushHistory("Edit velocity");
      const vel = velYToVelocity(y);
      setVelDraw({ active: true, mouseY: y, mouseX: x });
      applyVelocityAtX(x, vel);
    },
    [
      getVelCanvasCoords,
      selectedIds,
      pushHistory,
      velYToVelocity,
      applyVelocityAtX,
    ],
  );

  const handleVelMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getVelCanvasCoords(e);
      if (x < GUTTER_WIDTH) {
        setVelDraw((prev) => ({ ...prev, mouseY: -1, mouseX: -1 }));
        return;
      }

      if (velDraw.active) {
        const vel = velYToVelocity(y);
        setVelDraw({ active: true, mouseY: y, mouseX: x });
        applyVelocityAtX(x, vel);
      } else {
        // Just hovering — show guide line
        setVelDraw((prev) => ({ ...prev, mouseY: y, mouseX: x }));
      }
    },
    [getVelCanvasCoords, velDraw.active, velYToVelocity, applyVelocityAtX],
  );

  const handleVelMouseUp = useCallback(() => {
    setVelDraw({ active: false, mouseY: -1, mouseX: -1 });
  }, []);

  const handleVelMouseLeave = useCallback(() => {
    setVelDraw({ active: false, mouseY: -1, mouseX: -1 });
  }, []);

  // ─── Velocity preset tools ────────────────────────────────────────
  const handleVelocityRampUp = useCallback(() => {
    if (selectedIds.size === 0) return;
    pushHistory("Velocity ramp up");
    const sorted = notes
      .filter((n) => selectedIds.has(n.id))
      .sort((a, b) => a.startTick - b.startTick);
    const count = sorted.length;
    const idToVel = new Map<number, number>();
    sorted.forEach((n, i) => {
      idToVel.set(
        n.id,
        count === 1 ? 127 : Math.round(1 + (126 * i) / (count - 1)),
      );
    });
    setNotes((prev) =>
      prev.map((n) =>
        idToVel.has(n.id) ? { ...n, velocity: idToVel.get(n.id)! } : n,
      ),
    );
    setIsDirty(true);
  }, [selectedIds, notes, pushHistory]);

  const handleVelocityRampDown = useCallback(() => {
    if (selectedIds.size === 0) return;
    pushHistory("Velocity ramp down");
    const sorted = notes
      .filter((n) => selectedIds.has(n.id))
      .sort((a, b) => a.startTick - b.startTick);
    const count = sorted.length;
    const idToVel = new Map<number, number>();
    sorted.forEach((n, i) => {
      idToVel.set(
        n.id,
        count === 1 ? 127 : Math.round(127 - (126 * i) / (count - 1)),
      );
    });
    setNotes((prev) =>
      prev.map((n) =>
        idToVel.has(n.id) ? { ...n, velocity: idToVel.get(n.id)! } : n,
      ),
    );
    setIsDirty(true);
  }, [selectedIds, notes, pushHistory]);

  const handleVelocityHumanize = useCallback(() => {
    if (selectedIds.size === 0) return;
    pushHistory("Humanize velocity");
    setNotes((prev) =>
      prev.map((n) => {
        if (!selectedIds.has(n.id)) return n;
        const jitter = Math.round((Math.random() - 0.5) * 30); // ±15
        return {
          ...n,
          velocity: Math.max(1, Math.min(127, n.velocity + jitter)),
        };
      }),
    );
    setIsDirty(true);
  }, [selectedIds, pushHistory]);

  const handleVelocityFix = useCallback(
    (vel: number) => {
      if (selectedIds.size === 0) return;
      pushHistory(`Set velocity ${vel}`);
      setNotes((prev) =>
        prev.map((n) => (selectedIds.has(n.id) ? { ...n, velocity: vel } : n)),
      );
      setIsDirty(true);
    },
    [selectedIds, pushHistory],
  );

  // ─── Ruler mouse handler ──────────────────────────────────────────
  const handleRulerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = rulerCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const x = (e.clientX - rect.left) * scaleX;
      if (x < GUTTER_WIDTH) return;

      const tick = xToTick(x);
      const snappedTick = snapToGrid(Math.max(0, tick));

      if (e.shiftKey && loopEnabled) {
        // Shift+click on ruler = set loop end
        if (snappedTick > loopStart) {
          onSetLoopRegion?.(loopStart, snappedTick);
        }
      } else if (e.altKey || e.metaKey) {
        // Alt/Cmd+click = set loop start, shift determines end
        onSetLoopRegion?.(
          snappedTick,
          loopEnd > snappedTick ? loopEnd : snappedTick + ticksPerMeasure,
        );
      } else {
        // Normal click = seek
        onSeek?.(snappedTick);
      }
    },
    [
      canvasWidth,
      xToTick,
      snapToGrid,
      onSeek,
      onSetLoopRegion,
      loopEnabled,
      loopStart,
      loopEnd,
      ticksPerMeasure,
    ],
  );

  // ─── Keyboard shortcuts ───────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space = play/pause (always, regardless of selection)
      // Undo: ⌘Z
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      // Redo: ⌘⇧Z
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }

      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (isPlaying) onPause?.();
        else onPlay?.();
        return;
      }

      // Toggle loop (L key)
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        onToggleLoop?.();
        return;
      }

      // Toggle solo (S key, but not with cmd/ctrl for save)
      if ((e.key === "s" || e.key === "S") && !(e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onToggleSolo?.();
        return;
      }

      if (selectedIds.size === 0) {
        if (e.key === "Escape") onClose();
        return;
      }

      const shift = e.shiftKey;
      let handled = true;

      switch (e.key) {
        case "ArrowUp":
          pushHistory(shift ? "Transpose +1 oct" : "Transpose +1 semi");
          setNotes((prev) =>
            prev.map((n) =>
              selectedIds.has(n.id)
                ? { ...n, note: Math.min(127, n.note + (shift ? 12 : 1)) }
                : n,
            ),
          );
          setIsDirty(true);
          break;
        case "ArrowDown":
          pushHistory(shift ? "Transpose -1 oct" : "Transpose -1 semi");
          setNotes((prev) =>
            prev.map((n) =>
              selectedIds.has(n.id)
                ? { ...n, note: Math.max(0, n.note - (shift ? 12 : 1)) }
                : n,
            ),
          );
          setIsDirty(true);
          break;
        case "ArrowLeft":
          pushHistory("Nudge left");
          setNotes((prev) =>
            prev.map((n) =>
              selectedIds.has(n.id)
                ? {
                    ...n,
                    startTick: Math.max(0, n.startTick - snapTicks),
                    endTick: Math.max(snapTicks, n.endTick - snapTicks),
                  }
                : n,
            ),
          );
          setIsDirty(true);
          break;
        case "ArrowRight":
          pushHistory("Nudge right");
          setNotes((prev) =>
            prev.map((n) =>
              selectedIds.has(n.id)
                ? {
                    ...n,
                    startTick: n.startTick + snapTicks,
                    endTick: n.endTick + snapTicks,
                  }
                : n,
            ),
          );
          setIsDirty(true);
          break;
        case "Delete":
        case "Backspace":
          pushHistory(
            `Delete ${selectedIds.size} note${selectedIds.size > 1 ? "s" : ""}`,
          );
          setNotes((prev) => prev.filter((n) => !selectedIds.has(n.id)));
          setSelectedIds(new Set());
          setIsDirty(true);
          break;
        case "Escape":
          if (selectedIds.size > 0) {
            setSelectedIds(new Set());
          } else {
            onClose();
          }
          break;
        case "a":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setSelectedIds(new Set(notes.map((n) => n.id)));
          } else {
            handled = false;
          }
          break;
        default:
          handled = false;
      }

      if (handled) e.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedIds,
    notes,
    snapTicks,
    onClose,
    isPlaying,
    onPlay,
    onPause,
    undo,
    redo,
    pushHistory,
    onToggleLoop,
    onToggleSolo,
  ]);

  // ─── Toolbar actions ──────────────────────────────────────────────
  const handleSave = useCallback(() => {
    // Keep non-note events from original track
    const nonNoteEvents = track.events.filter(
      (e) => e.type !== "note_on" && e.type !== "note_off",
    );
    const noteEvents = notesToEvents(notes);
    const allEvents = [...nonNoteEvents, ...noteEvents].sort(
      (a, b) => a.tick - b.tick,
    );
    onSave(trackIndex, allEvents);
  }, [notes, track, trackIndex, onSave]);

  const handleTranspose = useCallback(
    (semitones: number) => {
      if (selectedIds.size === 0) return;
      pushHistory(`Transpose ${semitones > 0 ? "+" : ""}${semitones}`);
      setNotes((prev) =>
        prev.map((n) =>
          selectedIds.has(n.id)
            ? { ...n, note: Math.max(0, Math.min(127, n.note + semitones)) }
            : n,
        ),
      );
      setIsDirty(true);
    },
    [selectedIds, pushHistory],
  );

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(notes.map((n) => n.id)));
  }, [notes]);

  const handleDeleteSelected = useCallback(() => {
    pushHistory(
      `Delete ${selectedIds.size} note${selectedIds.size > 1 ? "s" : ""}`,
    );
    setNotes((prev) => prev.filter((n) => !selectedIds.has(n.id)));
    setSelectedIds(new Set());
    setIsDirty(true);
  }, [selectedIds, pushHistory]);

  // Format position display
  const formatPosition = useCallback(
    (tick: number) => {
      const bar = Math.floor(tick / ticksPerMeasure) + 1;
      const remaining = tick % ticksPerMeasure;
      const beat = Math.floor(remaining / ticksPerBeat) + 1;
      const sub = remaining % ticksPerBeat;
      return `${bar}.${beat}.${sub}`;
    },
    [ticksPerMeasure, ticksPerBeat],
  );

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="notator-piano-roll-overlay" id="piano-roll-editor">
      {/* ─── TOOLBAR ──────────────────────────────────────────────── */}
      <div className="notator-piano-roll-toolbar">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-notator-text-dim">
            Edit
          </span>
          <span className="text-[12px] font-bold text-notator-text">
            Track {trackIndex + 1}: {track.name || "---"}
          </span>
          <span className="text-[10px] text-notator-text-dim">
            {notes.length} notes
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Transport controls */}
          <div className="flex gap-1">
            <button
              onClick={onStop}
              className="notator-piano-roll-tool-btn"
              title="Stop"
              id="pr-stop"
            >
              ■
            </button>
            <button
              onClick={isPlaying ? onPause : onPlay}
              className={`notator-piano-roll-tool-btn ${isPlaying ? "notator-piano-roll-tool-active" : ""}`}
              title={isPlaying ? "Pause" : "Play"}
              id="pr-play"
            >
              {isPlaying ? "‖" : "▶"}
            </button>
          </div>

          <span className="text-[9px] text-notator-text-dim ml-1">
            {formatPosition(currentTick)}
          </span>

          {/* Divider */}
          <span className="text-notator-border">|</span>

          {/* Loop toggle */}
          <button
            onClick={onToggleLoop}
            className={`notator-piano-roll-tool-btn ${
              loopEnabled ? "notator-piano-roll-tool-active" : ""
            }`}
            title="Toggle Loop (L)"
            id="pr-loop"
          >
            ↻
          </button>

          {/* Solo toggle */}
          <button
            onClick={onToggleSolo}
            className={`notator-piano-roll-tool-btn ${
              isSoloed ? "notator-piano-roll-tool-active" : ""
            }`}
            title="Solo this track (S)"
            id="pr-solo"
            style={
              isSoloed
                ? {
                    borderColor: "#ffbb44",
                    color: "#ffbb44",
                    background: "rgba(255,187,68,0.15)",
                  }
                : undefined
            }
          >
            S
          </button>

          {/* Snap selector */}
          <span className="text-[9px] text-notator-text-dim">SNAP</span>
          <select
            value={snapIndex}
            onChange={(e) => setSnapIndex(Number(e.target.value))}
            className="notator-piano-roll-select"
            id="snap-select"
          >
            {SNAP_OPTIONS.map((opt, i) => (
              <option key={i} value={i}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Tool buttons */}
          <div className="flex gap-1 ml-1">
            {(["pointer", "draw", "erase"] as Tool[]).map((t) => (
              <button
                key={t}
                onClick={() => setTool(t)}
                className={`notator-piano-roll-tool-btn ${
                  tool === t ? "notator-piano-roll-tool-active" : ""
                }`}
                id={`tool-${t}`}
                title={t.charAt(0).toUpperCase() + t.slice(1)}
              >
                {t === "pointer" ? "↖" : t === "draw" ? "✎" : "✕"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="notator-btn rounded px-3 py-1 text-[10px] border-notator-border text-notator-text-dim hover:text-notator-text"
            id="piano-roll-cancel"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className={`notator-btn rounded px-3 py-1 text-[10px] ${
              isDirty
                ? "border-notator-green bg-notator-green/20 text-notator-green"
                : "border-notator-border text-notator-text-dim"
            }`}
            id="piano-roll-save"
          >
            Save
          </button>
        </div>
      </div>

      {/* ─── BODY ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─── SIDEBAR ──────────────────────────────────────────── */}
        <div className="notator-piano-roll-sidebar">
          {/* Note Inspector */}
          <div className="px-3 py-2 border-b border-notator-border">
            <div className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim mb-2">
              Inspector
            </div>
            {selectedNote ? (
              <div className="space-y-1.5 text-[10px]">
                {[
                  { label: "NOTE", value: noteName(selectedNote.note) },
                  { label: "VELOCITY", value: String(selectedNote.velocity) },
                  {
                    label: "POSITION",
                    value: formatPosition(selectedNote.startTick),
                  },
                  {
                    label: "LENGTH",
                    value: formatPosition(
                      selectedNote.endTick - selectedNote.startTick,
                    ),
                  },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-notator-text-dim">{label}</span>
                    <span className="font-bold tabular-nums text-notator-text">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-notator-text-dim">
                {selectedIds.size > 1
                  ? `${selectedIds.size} notes selected`
                  : "No note selected"}
              </div>
            )}
          </div>

          {/* Transpose */}
          <div className="px-3 py-2 border-b border-notator-border">
            <div className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim mb-2">
              Transpose
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => handleTranspose(-1)}
                className="notator-btn rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
                disabled={selectedIds.size === 0}
              >
                -1 semi
              </button>
              <button
                onClick={() => handleTranspose(1)}
                className="notator-btn rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
                disabled={selectedIds.size === 0}
              >
                +1 semi
              </button>
              <button
                onClick={() => handleTranspose(-12)}
                className="notator-btn rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
                disabled={selectedIds.size === 0}
              >
                -1 oct
              </button>
              <button
                onClick={() => handleTranspose(12)}
                className="notator-btn rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
                disabled={selectedIds.size === 0}
              >
                +1 oct
              </button>
            </div>
          </div>

          {/* Velocity Tools */}
          <div className="px-3 py-2 border-b border-notator-border">
            <div className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim mb-2">
              Velocity
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={handleVelocityRampUp}
                className="notator-btn rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
                disabled={selectedIds.size === 0}
                title="Crescendo: linearly ramp velocity from 1 → 127"
                id="vel-ramp-up"
              >
                ↗ Ramp Up
              </button>
              <button
                onClick={handleVelocityRampDown}
                className="notator-btn rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
                disabled={selectedIds.size === 0}
                title="Diminuendo: linearly ramp velocity from 127 → 1"
                id="vel-ramp-down"
              >
                ↘ Ramp Down
              </button>
              <button
                onClick={handleVelocityHumanize}
                className="notator-btn rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
                disabled={selectedIds.size === 0}
                title="Add ±15 random jitter to velocities"
                id="vel-humanize"
              >
                🎲 Humanize
              </button>
              <button
                onClick={() => handleVelocityFix(127)}
                className="notator-btn rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
                disabled={selectedIds.size === 0}
                title="Set all selected to velocity 127"
                id="vel-fix-127"
              >
                Fix 127
              </button>
              <button
                onClick={() => handleVelocityFix(100)}
                className="notator-btn rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
                disabled={selectedIds.size === 0}
                title="Set all selected to velocity 100"
                id="vel-fix-100"
              >
                Fix 100
              </button>
              <button
                onClick={() => handleVelocityFix(64)}
                className="notator-btn rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
                disabled={selectedIds.size === 0}
                title="Set all selected to velocity 64"
                id="vel-fix-64"
              >
                Fix 64
              </button>
            </div>
            <div className="text-[8px] text-notator-text-dim mt-1.5 opacity-60">
              Draw velocity in the lane below ↓
            </div>
          </div>

          {/* Loop Region (sidebar control) */}
          <div className="px-3 py-2 border-b border-notator-border">
            <div className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim mb-2">
              Loop Region
            </div>
            {loopEnabled && loopStart >= 0 && loopEnd > loopStart ? (
              <div className="space-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-notator-text-dim">START</span>
                  <span className="font-bold tabular-nums text-notator-green">
                    {formatPosition(loopStart)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-notator-text-dim">END</span>
                  <span className="font-bold tabular-nums text-notator-green">
                    {formatPosition(loopEnd)}
                  </span>
                </div>
                <button
                  onClick={() => onSetLoopRegion?.(-1, -1)}
                  className="notator-btn w-full rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text mt-1"
                >
                  Clear Loop Region
                </button>
              </div>
            ) : (
              <div className="text-[10px] text-notator-text-dim">
                {loopEnabled
                  ? "⌥ Click ruler = set start\n⇧ Click = set end"
                  : "Enable loop first"}
              </div>
            )}
          </div>

          {/* Selection */}
          <div className="px-3 py-2 border-b border-notator-border">
            <div className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim mb-2">
              Selection
            </div>
            <div className="space-y-1">
              <button
                onClick={handleSelectAll}
                className="notator-btn w-full rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
              >
                Select All ({notes.length})
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="notator-btn w-full rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text"
                disabled={selectedIds.size === 0}
              >
                Deselect
              </button>
              <button
                onClick={handleDeleteSelected}
                className="notator-btn w-full rounded px-2 py-1 text-[9px] border-notator-red text-notator-red hover:bg-notator-red/20"
                disabled={selectedIds.size === 0}
              >
                Delete ({selectedIds.size})
              </button>
            </div>
          </div>

          {/* History Log */}
          <div className="px-3 py-2 border-b border-notator-border">
            <div className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim mb-2">
              History
            </div>
            <div className="flex gap-1 mb-2">
              <button
                onClick={undo}
                disabled={undoStack.length === 0}
                className="notator-btn flex-1 rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text disabled:opacity-30"
              >
                ↩ Undo ({undoStack.length})
              </button>
              <button
                onClick={redo}
                disabled={redoStack.length === 0}
                className="notator-btn flex-1 rounded px-2 py-1 text-[9px] border-notator-border text-notator-text-dim hover:text-notator-text disabled:opacity-30"
              >
                ↪ Redo ({redoStack.length})
              </button>
            </div>
            <div className="max-h-24 overflow-y-auto space-y-0.5">
              {undoStack.length === 0 && redoStack.length === 0 ? (
                <div className="text-[9px] text-notator-text-dim">
                  No actions yet
                </div>
              ) : (
                <>
                  {[...undoStack]
                    .reverse()
                    .slice(0, 8)
                    .map((entry, i) => (
                      <div
                        key={`u-${i}`}
                        className={`text-[8px] px-1 py-0.5 rounded ${
                          i === 0
                            ? "bg-notator-green/10 text-notator-green"
                            : "text-notator-text-dim"
                        }`}
                      >
                        {i === 0 ? "▸ " : "  "}
                        {entry.label}
                      </div>
                    ))}
                  {redoStack.length > 0 && (
                    <div className="text-[8px] px-1 text-notator-text-dim opacity-50 border-t border-notator-border pt-0.5 mt-0.5">
                      {[...redoStack].reverse().map((entry, i) => (
                        <div key={`r-${i}`} className="line-through">
                          {entry.label}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Keyboard Shortcuts */}
          <div className="px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim mb-2">
              Shortcuts
            </div>
            <div className="space-y-0.5 text-[8px] text-notator-text-dim">
              <div>⌘Z undo</div>
              <div>⌘⇧Z redo</div>
              <div>Space play/pause</div>
              <div>L toggle loop</div>
              <div>S toggle solo</div>
              <div>↑↓ ±1 semitone</div>
              <div>⇧↑↓ ±1 octave</div>
              <div>←→ move in time</div>
              <div>⌫ delete</div>
              <div>⌘A select all</div>
              <div>Esc close/deselect</div>
              <div>⌥ Click ruler = loop start</div>
              <div>⇧ Click ruler = loop end</div>
            </div>
          </div>
        </div>

        {/* ─── CANVAS AREA ──────────────────────────────────────── */}
        <div
          ref={hScrollRef}
          className="flex flex-1 flex-col overflow-x-auto overflow-y-hidden"
        >
          {/* Inner wrapper — sets the full scrollable width for all 3 areas */}
          <div
            style={{
              width: canvasWidth,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              flex: 1,
            }}
          >
            {/* Ruler / scrubber */}
            <div
              className="flex-shrink-0 relative"
              style={{ height: RULER_HEIGHT }}
            >
              <canvas
                ref={rulerCanvasRef}
                onMouseDown={handleRulerMouseDown}
                style={{ cursor: "pointer" }}
              />
              <canvas
                ref={rulerOverlayRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  pointerEvents: "none",
                }}
              />
            </div>

            {/* Main grid */}
            <div
              ref={containerRef}
              className="flex-1 overflow-y-auto overflow-x-hidden relative"
              style={{
                cursor:
                  tool === "draw"
                    ? "crosshair"
                    : tool === "erase"
                      ? "not-allowed"
                      : "default",
              }}
            >
              <canvas
                ref={canvasRef}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
              />
              <canvas
                ref={overlayCanvasRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  pointerEvents: "none",
                }}
              />
            </div>

            {/* Velocity lane */}
            <div
              className="border-t border-notator-border flex-shrink-0 relative"
              style={{
                height: VELOCITY_HEIGHT,
                cursor: selectedIds.size > 0 ? "crosshair" : "default",
              }}
            >
              <canvas
                ref={velocityCanvasRef}
                onMouseDown={handleVelMouseDown}
                onMouseMove={handleVelMouseMove}
                onMouseUp={handleVelMouseUp}
                onMouseLeave={handleVelMouseLeave}
              />
              <canvas
                ref={velOverlayRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
