/**
 * .SON File Parser — Complete Round-Trip Implementation
 *
 * Parses Notator SL .SON files into a SonFile structure that preserves
 * ALL data for byte-exact round-trip serialization. Every event type
 * is parsed, including non-MIDI events (notation, bar markers, track
 * setup, SysEx chains).
 *
 * Event type map confirmed via Ghidra decompilation of NOTATOR.PRG 3.21
 * (FUN_000149dc — main event dispatcher, switch on status & 0xF0):
 *
 *   0x00 = Meta/system    0x30 = Bar/pattern    0x40 = Track setup
 *   0x60 = Track config   0x70 = Notation       0x80 = Note off
 *   0x90 = Note on        0xA0 = Aftertouch     0xB0 = Control change
 *   0xC0 = Program change 0xD0 = Channel press   0xE0 = Pitch wheel
 *   0xF0 = SysEx
 *
 * SysEx continuation: byte[5] & 0x80 in each 6-byte record chains
 * multiple records into a single logical SysEx message.
 */

import type {
  SonFile,
  SonHeader,
  SongData,
  Track,
  TrackEvent,
  SonEvent,
  TrackSlot,
  TrackConfig,
  HeaderConfig,
  TrackGroupMapping,
  BoundaryInfo,
  Pattern,
  ArrangementEntry,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════

/** Offset where musical track data begins */
const TRACK_DATA_OFFSET = 0x5ac8;

/** Header field offsets */
const TEMPO_OFFSET = 0x0006;
const TICKS_PER_MEASURE_OFFSET = 0x0022;
const INSTRUMENT_NAMES_OFFSET = 0x0064;
const INSTRUMENT_NAME_LENGTH = 9;
const MAX_INSTRUMENTS = 16;
const CHANNEL_MAP_OFFSET = 0x0330;
const PROGRAM_MAP_OFFSET = 0x0340;
const VOLUME_MAP_OFFSET = 0x0350;
const PAN_MAP_OFFSET = 0x0360;

/** Track pointer table — maps pattern×track to file offsets */
const TRACK_POINTER_TABLE_OFFSET = 0x0502;
/** 4 bytes per entry: uint16 BE pointer + uint16 BE metadata */
const TRACK_POINTER_ENTRY_SIZE = 4;
/** Pointer value indicating an empty/unused track slot */
const EMPTY_TRACK_POINTER = 0x1d40;

/** Extended header region */
const EXTENDED_HEADER_OFFSET = 0x0008;
const EXTENDED_HEADER_SIZE = 26; // 0x0008–0x0021

/** Track group mapping region */
const TRACK_GROUP_OFFSET = 0x0330;
const TRACK_GROUP_SIZE = 64; // 0x0330–0x036F (only first 16 bytes used for mapping)

/** Pattern name table: 16 names × 8 bytes at this offset */
const PATTERN_NAME_TABLE_OFFSET = 0x21be;
const MAX_PATTERN_NAMES = 16;
const PATTERN_NAME_SIZE = 8;

/** Default pattern names that should be treated as unnamed */
const DEFAULT_PATTERN_NAMES = ["Pattern:", "Name"];

/** Boundary markers */
const BOUNDARY_A = [0x7f, 0xff, 0xff, 0xff] as const;
const BOUNDARY_B = [0x00, 0x0f, 0xff, 0xff] as const;

/** Track structure sizes */
const TRACK_HEADER_SIZE = 24;
const TRACK_NAME_SIZE = 8;
const TRACK_CONFIG_SIZE = 14;
const TRACK_PREAMBLE = TRACK_HEADER_SIZE + TRACK_NAME_SIZE + TRACK_CONFIG_SIZE; // 46 bytes
const EVENT_SIZE = 6;
const TRACKS_PER_PATTERN = 16;

// ═══════════════════════════════════════════════════════════════════════
// MAIN PARSE FUNCTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse a .SON file into a complete SonFile structure.
 * Preserves ALL data for round-trip serialization.
 */
export function parseSonFile(buffer: ArrayBuffer): SonFile {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (data.length < TRACK_DATA_OFFSET) {
    throw new Error(
      `File too small (${data.length} bytes, need at least ${TRACK_DATA_OFFSET})`,
    );
  }

  // ─── Preserve raw header ────────────────────────────────────────
  const rawHeader = new Uint8Array(data.slice(0, TRACK_DATA_OFFSET));

  // ─── Parse header fields ────────────────────────────────────────
  const header = parseHeader(data, view);

  // ─── Split file on track boundaries ─────────────────────────────
  // Scan from after the pointer table — in large SON files (>64KB),
  // track data boundaries can exist inside the header region.
  const BOUNDARY_SCAN_START =
    TRACK_POINTER_TABLE_OFFSET +
    24 * TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE; // 0x0B02
  const { chunks, boundaries, preBoundaryPadding } = splitOnBoundariesWithInfo(
    data,
    BOUNDARY_SCAN_START,
  );

  // ─── Parse ALL track slots ─────────────────────────────────────
  const trackSlots: TrackSlot[] = chunks.map((chunk) => parseTrackSlot(chunk));

  // ─── Build file-offset → TrackSlot map ─────────────────────────
  // Each boundary's data starts at boundaryPos + 4. The pointer table
  // references dataStart + 2, so we index by that adjusted offset.
  const slotByOffset = new Map<number, TrackSlot>();
  for (let i = 0; i < boundaries.length && i < trackSlots.length; i++) {
    const dataStart = boundaries[i].fileOffset + 4;
    // Pointer table values = dataStart + 2
    slotByOffset.set(dataStart + 2, trackSlots[i]);
  }

  // ─── Parse pattern name table ──────────────────────────────────
  // The name table at 0x21be stores 16 × 8-byte pattern names.
  // Entry[0] should be a default like "Pattern:" — if not, the offset
  // contains track event data for this file, so skip the table.
  const patternNames: string[] = [];
  const nameTableValid = (() => {
    const off = PATTERN_NAME_TABLE_OFFSET;
    if (off + PATTERN_NAME_SIZE > data.length) return false;
    // Check that all 8 bytes of entry[0] are printable ASCII or null
    for (let j = 0; j < PATTERN_NAME_SIZE; j++) {
      const b = data[off + j];
      if (b === 0) break;
      if (b < 0x20 || b >= 0x7f) return false;
    }
    // Read entry[0] and verify it matches a known default
    let firstEntry = "";
    for (let j = 0; j < PATTERN_NAME_SIZE; j++) {
      const b = data[off + j];
      if (b === 0) break;
      firstEntry += String.fromCharCode(b);
    }
    firstEntry = firstEntry.trim();
    return DEFAULT_PATTERN_NAMES.some(
      (d) => firstEntry === d || firstEntry.startsWith(d.replace(/:$/, "")),
    );
  })();

  if (nameTableValid) {
    for (let i = 0; i < MAX_PATTERN_NAMES; i++) {
      const nameOffset = PATTERN_NAME_TABLE_OFFSET + i * PATTERN_NAME_SIZE;
      if (nameOffset + PATTERN_NAME_SIZE > data.length) break;
      let name = "";
      for (let j = 0; j < PATTERN_NAME_SIZE; j++) {
        const b = data[nameOffset + j];
        if (b === 0) break;
        if (b >= 0x20 && b < 0x7f) name += String.fromCharCode(b);
      }
      patternNames.push(name.trim());
    }
  }

  // ─── Build playback-oriented SongData ───────────────────────────
  const songData = buildSongData(
    header,
    trackSlots,
    data,
    view,
    slotByOffset,
    patternNames,
  );

  const sonFile: SonFile = {
    rawHeader,
    header,
    trackSlots,
    boundaries,
    preBoundaryPadding,
    patternNames,
    songData,
  };

  // Logging
  const totalEvents = trackSlots.reduce((sum, s) => sum + s.events.length, 0);
  const playableSlots = trackSlots.filter((s) => s.hasPlayableEvents).length;
  console.log(
    `[Parser] SonFile: ${trackSlots.length} track slots, ` +
      `${playableSlots} with MIDI events, ${totalEvents} total events, ` +
      `${songData.patterns.length} patterns, ${header.tempo} BPM`,
  );

  return sonFile;
}

// ═══════════════════════════════════════════════════════════════════════
// HEADER PARSING
// ═══════════════════════════════════════════════════════════════════════

function parseHeader(data: Uint8Array, view: DataView): SonHeader {
  const magic = view.getUint16(0, false);
  const tempo = view.getUint16(TEMPO_OFFSET, false) || 120;
  const ticksPerMeasure =
    view.getUint16(TICKS_PER_MEASURE_OFFSET, false) || 768;
  const ticksPerBeat = ticksPerMeasure / 4;

  const instrumentNames: string[] = [];
  for (let i = 0; i < MAX_INSTRUMENTS; i++) {
    const offset = INSTRUMENT_NAMES_OFFSET + i * INSTRUMENT_NAME_LENGTH;
    if (offset + INSTRUMENT_NAME_LENGTH > data.length) break;
    instrumentNames.push(
      decodeAscii(data.slice(offset, offset + INSTRUMENT_NAME_LENGTH)),
    );
  }

  const channelConfig = {
    channels: Array.from(
      data.slice(CHANNEL_MAP_OFFSET, CHANNEL_MAP_OFFSET + MAX_INSTRUMENTS),
    ),
    programs: Array.from(
      data.slice(PROGRAM_MAP_OFFSET, PROGRAM_MAP_OFFSET + MAX_INSTRUMENTS),
    ),
    volumes: Array.from(
      data.slice(VOLUME_MAP_OFFSET, VOLUME_MAP_OFFSET + MAX_INSTRUMENTS),
    ),
    pans: Array.from(
      data.slice(PAN_MAP_OFFSET, PAN_MAP_OFFSET + MAX_INSTRUMENTS),
    ),
  };

  // ─── Extended header config (0x0008–0x0021) ──────────────────────
  const flagsByte = data[0x000a] ?? 0;
  const headerConfig: HeaderConfig = {
    quantizeValue: view.getUint16(EXTENDED_HEADER_OFFSET, false),
    loopEnabled: (flagsByte & 0x01) !== 0,
    autoQuantize: (flagsByte & 0x02) !== 0,
    flagsByte,
    clickTrack: (data[0x000b] ?? 0) !== 0,
    metronomePrescale: data[0x000c] ?? 0,
    precountBars: data[0x000d] ?? 0,
    activeTrackMask: view.getUint16(0x000e, false),
    displayMode: data[0x0010] ?? 0,
    rawExtended: new Uint8Array(
      data.slice(
        EXTENDED_HEADER_OFFSET,
        EXTENDED_HEADER_OFFSET + EXTENDED_HEADER_SIZE,
      ),
    ),
  };

  // ─── Track group mapping (0x0330–0x036F) ─────────────────────────
  const trackGroups: TrackGroupMapping = {
    groups: Array.from(
      data.slice(TRACK_GROUP_OFFSET, TRACK_GROUP_OFFSET + MAX_INSTRUMENTS),
    ),
    rawGroupData: new Uint8Array(
      data.slice(TRACK_GROUP_OFFSET, TRACK_GROUP_OFFSET + TRACK_GROUP_SIZE),
    ),
  };

  return {
    magic,
    tempo,
    ticksPerMeasure,
    ticksPerBeat,
    instrumentNames,
    channelConfig,
    headerConfig,
    trackGroups,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// TRACK SLOT PARSING
// ═══════════════════════════════════════════════════════════════════════

function parseTrackSlot(chunk: Uint8Array): TrackSlot {
  // If chunk is too small for a preamble, create an empty slot
  if (chunk.length < TRACK_PREAMBLE) {
    return {
      rawHeader: chunk.slice(0, Math.min(TRACK_HEADER_SIZE, chunk.length)),
      name: "",
      rawName: new Uint8Array(TRACK_NAME_SIZE),
      rawConfig: new Uint8Array(TRACK_CONFIG_SIZE),
      config: defaultTrackConfig(),
      events: [],
      hasPlayableEvents: false,
    };
  }

  const rawHeader = chunk.slice(0, TRACK_HEADER_SIZE);
  const rawName = chunk.slice(
    TRACK_HEADER_SIZE,
    TRACK_HEADER_SIZE + TRACK_NAME_SIZE,
  );
  const rawConfig = chunk.slice(
    TRACK_HEADER_SIZE + TRACK_NAME_SIZE,
    TRACK_PREAMBLE,
  );
  const eventData = chunk.slice(TRACK_PREAMBLE);

  const name = decodeAscii(rawName);
  const config = parseTrackConfig(rawConfig);
  const events = parseAllEvents(eventData);

  const hasPlayableEvents = events.some(
    (e) =>
      e.type === "note_on" ||
      e.type === "note_off" ||
      e.type === "control_change" ||
      e.type === "program_change" ||
      e.type === "pitch_wheel" ||
      e.type === "sysex",
  );

  return {
    rawHeader,
    name,
    rawName,
    rawConfig,
    config,
    events,
    hasPlayableEvents,
  };
}

/**
 * Parse the 14-byte track config block.
 * Field layout confirmed via Ghidra decompilation of FUN_0001464c.
 */
function parseTrackConfig(raw: Uint8Array): TrackConfig {
  const filterByte = raw.length > 1 ? raw[1] : 0;
  const channelByte = raw.length > 3 ? raw[3] : 0;
  const portByte = raw.length > 5 ? raw[5] : 0;

  return {
    filters: {
      noteFilter: (filterByte & 0x02) !== 0,
      aftertouchFilter: (filterByte & 0x04) !== 0,
      ccFilter: (filterByte & 0x08) !== 0,
      programFilter: (filterByte & 0x10) !== 0,
      channelPressureFilter: (filterByte & 0x20) !== 0,
      pitchWheelFilter: (filterByte & 0x40) !== 0,
      sysexFilter: (filterByte & 0x80) !== 0,
    },
    midiChannel: channelByte & 0x1f,
    midiPort: portByte & 0x0f,
    noteRangeLow: raw.length > 9 ? raw[9] : 0,
    noteRangeHigh: raw.length > 10 ? raw[10] : 0,
  };
}

function defaultTrackConfig(): TrackConfig {
  return {
    filters: {
      noteFilter: false,
      aftertouchFilter: false,
      ccFilter: false,
      programFilter: false,
      channelPressureFilter: false,
      pitchWheelFilter: false,
      sysexFilter: false,
    },
    midiChannel: 0,
    midiPort: 0,
    noteRangeLow: 0,
    noteRangeHigh: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// EVENT PARSING — ALL 14 STATUS TYPES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse ALL 6-byte event records, including non-MIDI events.
 * Handles SysEx continuation chains (byte[5] & 0x80).
 */
function parseAllEvents(data: Uint8Array): SonEvent[] {
  const events: SonEvent[] = [];
  const numRecords = Math.floor(data.length / EVENT_SIZE);
  let i = 0;

  while (i < numRecords) {
    const offset = i * EVENT_SIZE;
    const raw = new Uint8Array(data.slice(offset, offset + EVENT_SIZE));
    const note = raw[0];
    const status = raw[1];
    const posHi = raw[2];
    const posLo = raw[3];
    const vel = raw[4];
    const arg = raw[5];
    const tick = posHi * 256 + posLo;
    const statusHi = status & 0xf0;

    switch (statusHi) {
      // ── Note On (0x90) ────────────────────────────────────────────
      case 0x90: {
        const adjustedVel = vel - 0x80;
        if (adjustedVel <= 0) {
          events.push({ type: "note_off", tick, note, raw });
        } else {
          events.push({
            type: "note_on",
            tick,
            note,
            velocity: Math.min(127, Math.max(1, adjustedVel)),
            raw,
          });
        }
        break;
      }

      // ── Note Off (0x80) ───────────────────────────────────────────
      case 0x80: {
        events.push({ type: "note_off", tick, note, raw });
        break;
      }

      // ── Aftertouch (0xA0) ─────────────────────────────────────────
      case 0xa0: {
        events.push({
          type: "aftertouch",
          tick,
          note,
          pressure: vel & 0x7f,
          raw,
        });
        break;
      }

      // ── Control Change (0xB0) ─────────────────────────────────────
      case 0xb0: {
        events.push({
          type: "control_change",
          tick,
          controller: note,
          value: vel,
          raw,
        });
        break;
      }

      // ── Program Change (0xC0) ─────────────────────────────────────
      case 0xc0: {
        events.push({
          type: "program_change",
          tick,
          program: note & 0x7f,
          raw,
        });
        break;
      }

      // ── Channel Pressure (0xD0) ───────────────────────────────────
      case 0xd0: {
        events.push({
          type: "channel_pressure",
          tick,
          pressure: note & 0x7f,
          raw,
        });
        break;
      }

      // ── Pitch Wheel (0xE0) ────────────────────────────────────────
      case 0xe0: {
        events.push({
          type: "pitch_wheel",
          tick,
          value: Math.round((vel - 0x80) * (8192 / 128)),
          raw,
        });
        break;
      }

      // ── Meta/System (0x00) ────────────────────────────────────────
      case 0x00: {
        events.push({
          type: "meta",
          tick,
          subType: arg & 0x0f,
          raw,
        });
        break;
      }

      // ── Bar Marker (0x30) ─────────────────────────────────────────
      case 0x30: {
        events.push({ type: "bar_marker", tick, raw });
        break;
      }

      // ── Track Setup (0x40) ────────────────────────────────────────
      case 0x40: {
        events.push({
          type: "track_setup",
          tick,
          subType: arg & 0x0f,
          raw,
        });
        break;
      }

      // ── Track Config (0x60) ───────────────────────────────────────
      case 0x60: {
        events.push({
          type: "track_config",
          tick,
          subType: arg & 0x0f,
          raw,
        });
        break;
      }

      // ── Notation (0x70) ───────────────────────────────────────────
      case 0x70: {
        events.push({
          type: "notation",
          tick,
          subType: note,
          raw,
        });
        break;
      }

      // ── SysEx (0xF0) ─────────────────────────────────────────────
      case 0xf0: {
        // Collect continuation chain
        const rawRecords: Uint8Array[] = [raw];
        const sysexBytes: number[] = [0xf0];

        // Collect data from first record
        sysexBytes.push(note & 0x7f);
        if (vel !== 0) sysexBytes.push(vel & 0x7f);

        // Follow continuation chain: byte[5] & 0x80
        let ci = i;
        while (
          ci < numRecords - 1 &&
          (data[ci * EVENT_SIZE + 5] & 0x80) !== 0
        ) {
          ci++;
          const cOffset = ci * EVENT_SIZE;
          const cRaw = new Uint8Array(
            data.slice(cOffset, cOffset + EVENT_SIZE),
          );
          rawRecords.push(cRaw);

          // Extract data bytes from continuation records
          for (let b = 0; b < 5; b++) {
            if (cRaw[b] !== 0) {
              sysexBytes.push(cRaw[b] & 0x7f);
            }
          }
        }

        // Terminate SysEx if not already
        if (sysexBytes[sysexBytes.length - 1] !== 0xf7) {
          sysexBytes.push(0xf7);
        }

        events.push({
          type: "sysex",
          tick,
          rawRecords,
          data: new Uint8Array(sysexBytes),
        });

        // Skip past continuation records
        i = ci;
        break;
      }

      // ── Unknown (0x10, 0x20, 0x50 — should be rare) ──────────────
      default: {
        events.push({ type: "raw", tick, status, raw });
        break;
      }
    }

    i++;
  }

  return events;
}

// ═══════════════════════════════════════════════════════════════════════
// BOUNDARY SPLITTING
// ═══════════════════════════════════════════════════════════════════════

function splitOnBoundariesWithInfo(
  data: Uint8Array,
  startOffset: number,
): {
  chunks: Uint8Array[];
  boundaries: BoundaryInfo[];
  preBoundaryPadding: Uint8Array;
} {
  const region = data.slice(startOffset);
  const chunks: Uint8Array[] = [];
  const boundaries: BoundaryInfo[] = [];

  // Find all boundary positions
  const positions: { pos: number; type: "A" | "B" }[] = [];
  for (let i = 0; i <= region.length - 4; i++) {
    if (matchesBoundaryA(region, i)) {
      positions.push({ pos: i, type: "A" });
    } else if (matchesBoundaryB(region, i)) {
      positions.push({ pos: i, type: "B" });
    }
  }

  // Capture data before the first boundary (pre-boundary padding)
  const firstBoundaryPos =
    positions.length > 0 ? positions[0].pos : region.length;
  const preBoundaryPadding = new Uint8Array(region.slice(0, firstBoundaryPos));

  for (let i = 0; i < positions.length; i++) {
    const { pos, type } = positions[i];
    boundaries.push({ type, fileOffset: startOffset + pos });

    const start = pos + 4;
    const end = i + 1 < positions.length ? positions[i + 1].pos : region.length;
    if (end > start) {
      chunks.push(region.slice(start, end));
    } else {
      chunks.push(new Uint8Array(0));
    }
  }

  return { chunks, boundaries, preBoundaryPadding };
}

function matchesBoundaryA(data: Uint8Array, pos: number): boolean {
  return (
    data[pos] === BOUNDARY_A[0] &&
    data[pos + 1] === BOUNDARY_A[1] &&
    data[pos + 2] === BOUNDARY_A[2] &&
    data[pos + 3] === BOUNDARY_A[3]
  );
}

function matchesBoundaryB(data: Uint8Array, pos: number): boolean {
  return (
    data[pos] === BOUNDARY_B[0] &&
    data[pos + 1] === BOUNDARY_B[1] &&
    data[pos + 2] === BOUNDARY_B[2] &&
    data[pos + 3] === BOUNDARY_B[3]
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SONG DATA BUILDER (for playback/UI backward compat)
// ═══════════════════════════════════════════════════════════════════════

function buildSongData(
  header: SonHeader,
  trackSlots: TrackSlot[],
  data: Uint8Array,
  view: DataView,
  slotByOffset: Map<number, TrackSlot>,
  patternNames: string[],
): SongData {
  // ─── Read the track pointer table from the header ──────────────
  // The table at 0x0502 maps each pattern×track to a file offset.
  // Each entry is 4 bytes: uint16 BE ptr_low + uint16 BE next_ptr_high.
  // The full pointer for entry[t] = (entry[t-1].nextHigh << 16) | entry[t].ptrLow.
  // This allows 32-bit addressing for files >64KB.
  // Pointer low word 0x1d40 with high word 0 = empty track slot.
  const maxTablePatterns = Math.floor(
    (TRACK_DATA_OFFSET - TRACK_POINTER_TABLE_OFFSET) /
      (TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE),
  );

  /** Read the full 32-bit track pointer for pattern p, track t.
   * Each 4-byte entry: uint16 BE ptr_low (bytes 0-1), uint16 BE next_high (bytes 2-3).
   * The high word for entry[N] comes from entry[N-1]'s bytes 2-3.
   * The initial high word (for p=0,t=0) is at offset 0x0500, just before the table.
   */
  function readTrackPointer(p: number, t: number): number {
    const entryOffset =
      TRACK_POINTER_TABLE_OFFSET +
      p * TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE +
      t * TRACK_POINTER_ENTRY_SIZE;
    if (entryOffset + 4 > data.length) return 0;

    const ptrLow = view.getUint16(entryOffset, false);

    // High word comes from the previous entry's bytes 2-3
    let ptrHigh = 0;
    if (t > 0) {
      const prevOffset = entryOffset - TRACK_POINTER_ENTRY_SIZE;
      ptrHigh = view.getUint16(prevOffset + 2, false);
    } else if (p > 0) {
      // For t=0, take from last entry of previous pattern row
      const prevRowLastOffset =
        TRACK_POINTER_TABLE_OFFSET +
        (p - 1) * TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE +
        (TRACKS_PER_PATTERN - 1) * TRACK_POINTER_ENTRY_SIZE;
      if (prevRowLastOffset + 4 <= data.length) {
        ptrHigh = view.getUint16(prevRowLastOffset + 2, false);
      }
    } else {
      // For the very first entry (p=0, t=0): initial high word at 0x0500
      const initHighOffset = TRACK_POINTER_TABLE_OFFSET - 2;
      if (initHighOffset >= 0 && initHighOffset + 2 <= data.length) {
        ptrHigh = view.getUint16(initHighOffset, false);
      }
    }

    return (ptrHigh << 16) | ptrLow;
  }

  /** Check if a pointer value represents an empty track */
  function isEmptyPointer(ptr: number): boolean {
    return ptr === EMPTY_TRACK_POINTER || ptr === 0;
  }

  // Find last pattern with any non-empty entry
  let numPatterns = 0;
  for (let p = 0; p < maxTablePatterns; p++) {
    let hasEntry = false;
    for (let t = 0; t < TRACKS_PER_PATTERN; t++) {
      const ptr = readTrackPointer(p, t);
      if (!isEmptyPointer(ptr)) {
        hasEntry = true;
        break;
      }
    }
    if (hasEntry) numPatterns = p + 1;
  }

  // If no pointer table entries found, fall back to sequential grouping
  if (numPatterns === 0) {
    numPatterns = Math.ceil(trackSlots.length / TRACKS_PER_PATTERN);
  }

  // ─── Helper: convert a TrackSlot into a playable Track ─────────
  function slotToTrack(slot: TrackSlot, trackIndex: number): Track | null {
    if (!slot.hasPlayableEvents) return null;

    const midiEvents = slot.events.filter(
      (e): e is TrackEvent =>
        e.type === "note_on" ||
        e.type === "note_off" ||
        e.type === "aftertouch" ||
        e.type === "control_change" ||
        e.type === "program_change" ||
        e.type === "channel_pressure" ||
        e.type === "pitch_wheel" ||
        e.type === "sysex",
    );

    if (midiEvents.length === 0) return null;

    // Resolve channel: byte 5 of the track header is the 1-based MIDI channel
    // (the preamble has 2 extra leading bytes from boundary markers)
    // e.g., 9 = channel 10 (A9 in Notator display), 1 = channel 1 (A1)
    let channel = trackIndex;
    const headerChByte = slot.rawHeader.length > 5 ? slot.rawHeader[5] : 0;
    if (headerChByte > 0 && headerChByte <= 16) {
      channel = headerChByte - 1; // Convert 1-based to 0-based
    } else if (slot.config.midiChannel > 0) {
      channel = slot.config.midiChannel - 1;
    } else {
      const headerChannel = header.channelConfig.channels[trackIndex];
      if (headerChannel !== undefined && headerChannel <= 15) {
        channel = headerChannel;
      }
    }

    const isDrums =
      channel === 9 || /drum|percuss/i.test(slot.name) || trackIndex === 9;

    return {
      name: slot.name,
      channel: isDrums ? 9 : channel,
      trackIndex,
      header: slot.rawHeader,
      config: slot.rawConfig,
      trackConfig: slot.config,
      events: midiEvents,
    };
  }

  // ─── Build patterns using the pointer table ────────────────────
  const patterns: Pattern[] = [];
  const hasPointerTable = slotByOffset.size > 0;

  for (let p = 0; p < numPatterns; p++) {
    const patternTracks: Track[] = [];
    const patternSlots: (TrackSlot | null)[] = [];

    for (let t = 0; t < TRACKS_PER_PATTERN; t++) {
      let slot: TrackSlot | null = null;

      if (hasPointerTable) {
        const ptr = readTrackPointer(p, t);
        if (!isEmptyPointer(ptr)) {
          slot = slotByOffset.get(ptr) ?? null;
        }
      } else {
        // Fallback: sequential grouping (legacy behaviour)
        const slotIdx = p * TRACKS_PER_PATTERN + t;
        slot = slotIdx < trackSlots.length ? trackSlots[slotIdx] : null;
      }

      patternSlots.push(slot);

      if (slot) {
        const track = slotToTrack(slot, t);
        if (track) {
          patternTracks.push(track);
        } else {
          // Slot exists but has no playable MIDI events — empty track
          patternTracks.push({
            name: slot.name || "",
            channel: t,
            trackIndex: t,
            header: slot.rawHeader,
            config: slot.rawConfig,
            trackConfig: slot.config,
            events: [],
          });
        }
      } else {
        // No slot at all — empty placeholder
        patternTracks.push({
          name: "",
          channel: t,
          trackIndex: t,
          header: new Uint8Array(0),
          events: [],
        });
      }
    }

    // Use pattern name from name table if available and non-default
    const tableNameIdx = p + 1; // 1-based: entry[0] is default, entry[1]=pat1
    const tableName =
      tableNameIdx < patternNames.length
        ? patternNames[tableNameIdx]
        : undefined;
    const isDefaultName =
      !tableName ||
      DEFAULT_PATTERN_NAMES.some((d) =>
        tableName.startsWith(d.replace(/:$/, "")),
      );

    let patternName: string;
    if (!isDefaultName && tableName) {
      patternName = tableName;
    } else {
      // Fall back to first named track
      patternName = `Pattern ${p + 1}`;
      for (const slot of patternSlots) {
        if (
          slot &&
          slot.name &&
          slot.name.trim() &&
          slot.name.trim() !== "Name"
        ) {
          patternName = slot.name.trim();
          break;
        }
      }
    }

    const totalTicks = patternTracks.reduce((max, track) => {
      const last = track.events[track.events.length - 1];
      return last ? Math.max(max, last.tick) : max;
    }, 0);

    // Only add patterns that have at least one track with events
    const hasAnyEvents = patternTracks.some((t) => t.events.length > 0);
    if (hasAnyEvents) {
      patterns.push({
        index: p,
        name: patternName,
        tracks: patternTracks,
        totalTicks,
      });
    }
  }

  // Parse arrangement (pass patterns so we can reference their names)
  const arrangement = parseArrangement(
    data,
    view,
    patterns,
    header.ticksPerMeasure,
  );

  const activePatternIndex = 0;
  const activePattern = patterns[activePatternIndex];
  const activeTracks = activePattern?.tracks ?? [];
  const totalTicks = activePattern?.totalTicks ?? 0;

  console.log(
    `[Parser] ${patterns.length} patterns, ` +
      `active pattern has ${activeTracks.length} tracks, ` +
      `${totalTicks} ticks, ${arrangement.length} arrangement entries`,
  );

  for (const t of activeTracks) {
    const noteOns = t.events.filter((e) => e.type === "note_on").length;
    const noteOffs = t.events.filter((e) => e.type === "note_off").length;
    console.log(
      `  [Parser] Track "${t.name}" ch=${t.channel}: ${noteOns} note_on, ${noteOffs} note_off`,
    );
  }

  return {
    tracks: activeTracks,
    patterns,
    activePatternIndex,
    arrangement,
    ticksPerBeat: header.ticksPerBeat,
    ticksPerMeasure: header.ticksPerMeasure,
    totalTicks,
    instrumentNames: header.instrumentNames,
    tempo: header.tempo,
    channelConfig: header.channelConfig,
    headerConfig: header.headerConfig,
    trackGroups: header.trackGroups,
  };
}

/**
 * Parse the arrangement table.
 *
 * The arrangement is stored as 24-byte entries starting at offset 0x20BE.
 * Each entry:
 *   byte  0     : pattern index (1-based, 0 = stop marker)
 *   bytes 1-11  : configuration (tick position, flags)
 *   bytes 12-19 : name (8 chars, high-bit stripped on alternating bytes)
 *   bytes 20-23 : post-name config (bytes 22-23 = 0x80 0xD2 signature)
 *
 * The table ends when a sentinel entry is reached (pat=0 with name "stop",
 * or pat=127 with byte1=0xFF, or the 0x80 0xD2 signature is absent and
 * the name is empty).
 */
const ARRANGE_TABLE_OFFSET = 0x20be;
const ARRANGE_ENTRY_SIZE = 24;
const ARRANGE_SIG_0 = 0x80;
const ARRANGE_SIG_1 = 0xd2;

function parseArrangement(
  data: Uint8Array,
  view: DataView,
  patterns: Pattern[],
  ticksPerMeasure: number,
): ArrangementEntry[] {
  const entries: ArrangementEntry[] = [];

  // ── Detect whether the 24-byte arrangement table exists ──────
  const hasTable = (() => {
    const off = ARRANGE_TABLE_OFFSET;
    if (off + ARRANGE_ENTRY_SIZE * 3 > data.length) return false;
    // Check that at least 3 consecutive entries have the 0x80 0xD2 signature
    for (let e = 0; e < 3; e++) {
      const eOff = off + e * ARRANGE_ENTRY_SIZE;
      if (
        data[eOff + 22] !== ARRANGE_SIG_0 ||
        data[eOff + 23] !== ARRANGE_SIG_1
      )
        return false;
    }
    return true;
  })();

  if (hasTable) {
    // ── Read 24-byte arrangement entries ──────────────────────
    // Tick position = (pageBit * 0x10000) + uint16BE(bytes 2-3)
    // where pageBit = byte1 & 0x01 (handles 16-bit overflow for long songs)
    //
    // Auto-detect ticks-per-bar from tick deltas (GCD of all non-zero
    // consecutive deltas). The parser's ticksPerMeasure may use a
    // different time signature unit than the arrangement bars.
    const tickPositions: number[] = [];
    for (let e = 0; e < 64; e++) {
      const off = ARRANGE_TABLE_OFFSET + e * ARRANGE_ENTRY_SIZE;
      if (off + ARRANGE_ENTRY_SIZE > data.length) break;
      const ac = data[off];
      if (ac === 127 || ac === 0) break;
      const b1 = data[off + 1];
      const tp16 = view.getUint16(off + 2, false);
      tickPositions.push((b1 & 0x01) * 0x10000 + tp16);
    }
    let TICKS_PER_BAR = ticksPerMeasure > 0 ? ticksPerMeasure : 768;
    if (tickPositions.length >= 2) {
      // The minimum non-zero delta between consecutive entries = 1 bar
      let minDelta = Infinity;
      for (let i = 1; i < tickPositions.length; i++) {
        const d = tickPositions[i] - tickPositions[i - 1];
        if (d > 0 && d < minDelta) minDelta = d;
      }
      if (minDelta < Infinity && minDelta >= 48) TICKS_PER_BAR = minDelta;
    }
    let baseTick = -1;

    for (let e = 0; e < 64; e++) {
      const off = ARRANGE_TABLE_OFFSET + e * ARRANGE_ENTRY_SIZE;
      if (off + ARRANGE_ENTRY_SIZE > data.length) break;

      const aCol = data[off]; // byte 0 = a column (1-based pattern index)
      const byte1 = data[off + 1];
      const tickPos16 = view.getUint16(off + 2, false);
      const pageBit = byte1 & 0x01;
      const tickPos = pageBit * 0x10000 + tickPos16;

      // Read arrangement name: bytes 12-20 (9 chars, high-bit stripped)
      // Byte 20 is the 9th name character (e.g., "chorus 1" has "1" at byte 20)
      let name = "";
      for (let j = 12; j <= 20; j++) {
        const b = data[off + j] & 0x7f;
        if (b >= 32 && b < 127) name += String.fromCharCode(b);
      }
      name = name.trim();

      // End conditions
      if (aCol === 127) break; // sentinel
      if (aCol === 0 && (name === "stop" || name === "")) break;

      if (baseTick < 0) baseTick = tickPos;
      const bar = Math.floor((tickPos - baseTick) / TICKS_PER_BAR) + 1;

      // Use arrangement name; fall back to pattern name
      const pattern = patterns.find((p) => p.index === aCol - 1);
      const displayName =
        name &&
        !DEFAULT_PATTERN_NAMES.some((d) => name.startsWith(d.replace(/:$/, "")))
          ? name
          : (pattern?.name ?? `Pattern ${aCol}`);

      // b/c/d columns — currently not decoded (byte 21+ are post-name config)

      entries.push({
        patternIndex: aCol - 1, // Convert to 0-based
        bar,
        length: 1, // Will be recomputed below
        name: displayName,
        columns: { a: aCol, b: 0, c: 0, d: 0 },
      });
    }

    // Compute bar lengths from consecutive entry positions
    for (let i = 0; i < entries.length - 1; i++) {
      entries[i].length = entries[i + 1].bar - entries[i].bar;
    }
    // Last entry gets a default length of 1
    if (entries.length > 0) {
      entries[entries.length - 1].length = Math.max(
        1,
        entries.length > 1 ? entries[entries.length - 2].length : 4,
      );
    }
  }

  if (entries.length === 0) {
    // ── Fallback: one entry per pattern in order ───────────────
    let bar = 1;
    for (const pat of patterns) {
      if (pat.tracks.length === 0) continue;
      const barLength = Math.max(
        1,
        Math.ceil(pat.totalTicks / ticksPerMeasure),
      );
      entries.push({
        patternIndex: pat.index,
        bar,
        length: barLength,
        name: pat.name,
        columns: { a: pat.index + 1, b: 0, c: 0, d: 0 },
      });
      bar += barLength;
    }
  }

  console.log(
    `[Parser] Arrangement: ${entries.length} entries, ` +
      `${entries.length > 0 ? entries[entries.length - 1].bar + entries[entries.length - 1].length - 1 : 0} total bars`,
  );

  return entries;
}

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════

function decodeAscii(bytes: Uint8Array): string {
  let name = "";
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) break;
    name +=
      bytes[i] >= 32 && bytes[i] < 127 ? String.fromCharCode(bytes[i]) : " ";
  }
  return name.trim();
}

// ═══════════════════════════════════════════════════════════════════════
// RE-EXPORTS for backward compatibility
// ═══════════════════════════════════════════════════════════════════════

export type { SonFile, SongData, Track, TrackEvent, SonEvent };
