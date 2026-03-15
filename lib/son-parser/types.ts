/**
 * Notator SL .SON file data types — Complete Round-Trip
 *
 * These types represent the FULL structure of a Notator SL .SON file,
 * preserving ALL data (including non-MIDI events) for byte-exact
 * round-trip serialization.
 *
 * Event types confirmed via Ghidra decompilation of NOTATOR.PRG 3.21
 * (FUN_000149dc — main event dispatcher, 666 lines of decompiled C).
 */

// ═══════════════════════════════════════════════════════════════════════
// TOP-LEVEL FILE STRUCTURE
// ═══════════════════════════════════════════════════════════════════════

/** Complete .SON file - preserves everything for round-trip */
export interface SonFile {
  /**
   * Raw header bytes (0x0000 – 0x5AC7).
   * Preserved byte-exact for write-back. Any header edits should
   * mutate this buffer directly via the helper methods.
   */
  rawHeader: Uint8Array;

  /** Parsed header fields (read from rawHeader for convenience) */
  header: SonHeader;

  /**
   * All track slots, including empty ones.
   * Ordered by appearance in the file. 16 slots per pattern.
   */
  trackSlots: TrackSlot[];

  /** Boundary marker info for each slot (type + position) */
  boundaries: BoundaryInfo[];

  /**
   * Pre-boundary padding between 0x5AC8 and the first boundary marker.
   * Usually filled with zeros. Preserved for byte-exact round-trip.
   */
  preBoundaryPadding: Uint8Array;

  /** Convenience: derived SongData for playback/UI */
  songData: SongData;
}

/**
 * Extended header config parsed from 0x0008–0x0021.
 * These fields control quantize, loop, click, and metronome behaviour.
 */
export interface HeaderConfig {
  /** Quantize grid resolution (uint16 @ 0x0008) */
  quantizeValue: number;
  /** Loop mode flag (bit 0 @ 0x000A) */
  loopEnabled: boolean;
  /** Auto-quantize flag (bit 1 @ 0x000A) */
  autoQuantize: boolean;
  /** Raw flag byte @ 0x000A for any un-decoded bits */
  flagsByte: number;
  /** Click track on/off (byte @ 0x000B, nonzero = on) */
  clickTrack: boolean;
  /** Metronome prescale (byte @ 0x000C) */
  metronomePrescale: number;
  /** Precount bars (byte @ 0x000D) */
  precountBars: number;
  /** Active track bitmask — 16 bits, one per track (uint16 @ 0x000E) */
  activeTrackMask: number;
  /** Notation display mode (byte @ 0x0010) */
  displayMode: number;
  /** Full raw bytes for round-trip (26 bytes: 0x0008–0x0021) */
  rawExtended: Uint8Array;
}

/**
 * Track-to-group mapping parsed from 0x0330–0x036F.
 * 16 bytes at 0x0330 assign each track to a numbered group.
 */
export interface TrackGroupMapping {
  /** 16-element array: groups[trackIndex] = group number */
  groups: number[];
  /** Full raw 64-byte region for round-trip */
  rawGroupData: Uint8Array;
}

/** Parsed header fields from the raw header */
export interface SonHeader {
  /** Bytes at 0x0000-0x0001 (typically 0x3B9E in files) */
  magic: number;
  /** Tempo in BPM (offset 0x0006, default 120) */
  tempo: number;
  /** Ticks per measure (offset 0x0022, 768 = 4/4, 576 = 3/4) */
  ticksPerMeasure: number;
  /** Ticks per beat (derived: ticksPerMeasure / 4) */
  ticksPerBeat: number;
  /** Instrument names from header (16 × 9 bytes at 0x0064) */
  instrumentNames: string[];
  /** MIDI channel configuration */
  channelConfig: ChannelConfig;
  /** Extended header config (0x0008–0x0021) */
  headerConfig: HeaderConfig;
  /** Track group mapping (0x0330–0x036F) */
  trackGroups: TrackGroupMapping;
}

/** Boundary marker metadata */
export interface BoundaryInfo {
  /** Type A = 7FFFFFFF, Type B = 000FFFFF */
  type: "A" | "B";
  /** Absolute offset in the file where this boundary starts */
  fileOffset: number;
}

/** A track slot (may be empty — preserves structure for round-trip) */
export interface TrackSlot {
  /** Raw 24-byte track header */
  rawHeader: Uint8Array;
  /** Track name (8 bytes, ASCII, space-padded) */
  name: string;
  /** Raw 8-byte name field (for round-trip) */
  rawName: Uint8Array;
  /** Raw 14-byte track config */
  rawConfig: Uint8Array;
  /** Parsed track config */
  config: TrackConfig;
  /** ALL events — both MIDI and non-MIDI */
  events: SonEvent[];
  /** Whether this slot has any playable MIDI events */
  hasPlayableEvents: boolean;
}

/** Parsed track config (14 bytes, from Ghidra RE of FUN_0001464c) */
export interface TrackConfig {
  /** Event filter flags (byte +1) */
  filters: {
    /** Skip note events if set */
    noteFilter: boolean;
    /** Skip aftertouch if set */
    aftertouchFilter: boolean;
    /** Skip control changes if set */
    ccFilter: boolean;
    /** Skip program changes if set */
    programFilter: boolean;
    /** Skip channel pressure if set */
    channelPressureFilter: boolean;
    /** Skip pitch wheel if set */
    pitchWheelFilter: boolean;
    /** Skip SysEx if set */
    sysexFilter: boolean;
  };
  /** MIDI channel (byte +3 & 0x1F, 5 bits) — 0 = use slot index */
  midiChannel: number;
  /** MIDI port (byte +5, lo nibble) */
  midiPort: number;
  /** Note range low (byte +9, 0 = no filter) */
  noteRangeLow: number;
  /** Note range high (byte +10, 0 = no filter) */
  noteRangeHigh: number;
}

// ═══════════════════════════════════════════════════════════════════════
// PLAYBACK-ORIENTED TYPES (backward compat)
// ═══════════════════════════════════════════════════════════════════════

/** Top-level song data for playback/UI (derived from SonFile) */
export interface SongData {
  tracks: Track[];
  patterns: Pattern[];
  activePatternIndex: number;
  arrangement: ArrangementEntry[];
  ticksPerBeat: number;
  ticksPerMeasure: number;
  totalTicks: number;
  instrumentNames: string[];
  tempo: number;
  channelConfig: ChannelConfig;
  /** Extended header config (quantize, loop, click, etc.) */
  headerConfig: HeaderConfig;
  /** Track-to-group mapping */
  trackGroups: TrackGroupMapping;
}

export interface ArrangementEntry {
  /** 0-based pattern index this entry references */
  patternIndex: number;
  /** Starting bar number (1-based, for display) */
  bar: number;
  /** Length of this entry in bars */
  length: number;
  /** Display name (pattern name or "Pattern N") */
  name: string;
}

export interface Pattern {
  index: number;
  name: string;
  tracks: Track[];
  totalTicks: number;
}

export interface ChannelConfig {
  channels: number[];
  programs: number[];
  volumes: number[];
  pans: number[];
}

/** A playable track (derived from TrackSlot for playback) */
export interface Track {
  name: string;
  channel: number;
  header: Uint8Array;
  config?: Uint8Array;
  /** Parsed track config (filters, port, note range) */
  trackConfig?: TrackConfig;
  events: TrackEvent[];
}

// ═══════════════════════════════════════════════════════════════════════
// EVENT TYPES — ALL 14 status categories
// ═══════════════════════════════════════════════════════════════════════

/**
 * Complete event union — ALL event types from the .SON format.
 * Non-MIDI events are preserved for round-trip write-back.
 */
export type SonEvent =
  // MIDI events (for playback)
  | NoteOnEvent
  | NoteOffEvent
  | AftertouchEvent
  | ControlChangeEvent
  | ProgramChangeEvent
  | ChannelPressureEvent
  | PitchWheelEvent
  // Non-MIDI events (preserved for round-trip)
  | MetaEvent
  | BarMarkerEvent
  | TrackSetupEvent
  | TrackConfigEvent
  | NotationEvent
  | SysExEvent
  // Fallback
  | RawEvent;

/** Subset of SonEvent that are relevant for MIDI playback */
export type TrackEvent =
  | NoteOnEvent
  | NoteOffEvent
  | AftertouchEvent
  | ControlChangeEvent
  | ProgramChangeEvent
  | ChannelPressureEvent
  | PitchWheelEvent
  | SysExEvent;

// ─── MIDI Events ──────────────────────────────────────────────────────

export interface NoteOnEvent {
  type: "note_on";
  tick: number;
  note: number;
  velocity: number;
  /** Raw 6-byte record (for round-trip) */
  raw: Uint8Array;
}

export interface NoteOffEvent {
  type: "note_off";
  tick: number;
  note: number;
  raw: Uint8Array;
}

export interface AftertouchEvent {
  type: "aftertouch";
  tick: number;
  note: number;
  pressure: number;
  raw: Uint8Array;
}

export interface ControlChangeEvent {
  type: "control_change";
  tick: number;
  controller: number;
  value: number;
  raw: Uint8Array;
}

export interface ProgramChangeEvent {
  type: "program_change";
  tick: number;
  program: number;
  raw: Uint8Array;
}

export interface ChannelPressureEvent {
  type: "channel_pressure";
  tick: number;
  pressure: number;
  raw: Uint8Array;
}

export interface PitchWheelEvent {
  type: "pitch_wheel";
  tick: number;
  value: number;
  raw: Uint8Array;
}

// ─── Non-MIDI Events (for round-trip preservation) ────────────────────

/** Status 0x00 — Meta/system event (end-of-track, tempo meta) */
export interface MetaEvent {
  type: "meta";
  tick: number;
  /** Sub-type from byte[5] & 0xF (1 = special, 0xF = pattern end) */
  subType: number;
  raw: Uint8Array;
}

/** Status 0x30 — Bar/pattern marker */
export interface BarMarkerEvent {
  type: "bar_marker";
  tick: number;
  /** Raw data contains bar number, loop points, pattern info */
  raw: Uint8Array;
}

/** Status 0x40 — Track setup / initialization */
export interface TrackSetupEvent {
  type: "track_setup";
  tick: number;
  /** Sub-type from byte[5] & 0xF */
  subType: number;
  raw: Uint8Array;
}

/** Status 0x60 — Track config change */
export interface TrackConfigEvent {
  type: "track_config";
  tick: number;
  /** Sub-type (port index) from byte[5] & 0xF */
  subType: number;
  raw: Uint8Array;
}

/** Status 0x70 — Notation/score display data */
export interface NotationEvent {
  type: "notation";
  tick: number;
  /**
   * Notation sub-type (byte[0] value):
   *   1 = Tempo change (with embedded BPM at bytes 10-11)
   *   2 = Time signature related
   *   3 = Beam flag set
   *   4 = Beam flag clear
   *   5-10 = Display layers (offsets 0x133C-0x183C per sub-type)
   */
  subType: number;
  raw: Uint8Array;
}

/**
 * Status 0xF0 — System Exclusive data.
 *
 * SysEx messages can span multiple 6-byte records via the
 * continuation bit at byte[6] & 0x80. When processing, each
 * chained record contributes data bytes to the SysEx stream.
 */
export interface SysExEvent {
  type: "sysex";
  tick: number;
  /**
   * ALL raw 6-byte records that constitute this SysEx chain.
   * First record has status 0xF0. Subsequent records are linked
   * via the continuation bit (byte[6] & 0x80 of the PREVIOUS record).
   */
  rawRecords: Uint8Array[];
  /**
   * Reconstructed SysEx data bytes (for sending to MIDI output).
   * Starts with 0xF0, ends with 0xF7 (if properly terminated).
   */
  data: Uint8Array;
}

/** Fallback for any unrecognized event (should never happen with complete parser) */
export interface RawEvent {
  type: "raw";
  tick: number;
  status: number;
  raw: Uint8Array;
}

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════

export interface SongPosition {
  bar: number;
  beat: number;
  tick: number;
  totalTicks: number;
}

export function ticksToPosition(
  totalTicks: number,
  ticksPerMeasure: number = 768,
  ticksPerBeat: number = 192,
): SongPosition {
  const bar = Math.floor(totalTicks / ticksPerMeasure);
  const remaining = totalTicks % ticksPerMeasure;
  const beat = Math.floor(remaining / ticksPerBeat);
  const tick = remaining % ticksPerBeat;
  return { bar, beat, tick, totalTicks };
}
