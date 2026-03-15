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
  BoundaryInfo,
  Pattern,
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

/** Arrangement region */
const ARRANGE_OFFSET = 0x0370;
const ARRANGE_SIZE = 0x190;

/** Boundary markers */
const BOUNDARY_A = [0x7f, 0xff, 0xff, 0xff] as const;
const BOUNDARY_B = [0x00, 0x0f, 0xff, 0xff] as const;

/** Track structure sizes */
const TRACK_HEADER_SIZE = 24;
const TRACK_NAME_SIZE = 8;
const TRACK_CONFIG_SIZE = 14;
const TRACK_PREAMBLE =
  TRACK_HEADER_SIZE + TRACK_NAME_SIZE + TRACK_CONFIG_SIZE; // 46 bytes
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
      `File too small (${data.length} bytes, need at least ${TRACK_DATA_OFFSET})`
    );
  }

  // ─── Preserve raw header ────────────────────────────────────────
  const rawHeader = new Uint8Array(data.slice(0, TRACK_DATA_OFFSET));

  // ─── Parse header fields ────────────────────────────────────────
  const header = parseHeader(data, view);

  // ─── Split track region on boundaries ───────────────────────────
  const { chunks, boundaries, preBoundaryPadding } =
    splitOnBoundariesWithInfo(data, TRACK_DATA_OFFSET);

  // ─── Parse ALL track slots ─────────────────────────────────────
  const trackSlots: TrackSlot[] = chunks.map((chunk) =>
    parseTrackSlot(chunk)
  );

  // ─── Build playback-oriented SongData ───────────────────────────
  const songData = buildSongData(header, trackSlots, data, view);

  const sonFile: SonFile = {
    rawHeader,
    header,
    trackSlots,
    boundaries,
    preBoundaryPadding,
    songData,
  };

  // Logging
  const totalEvents = trackSlots.reduce((sum, s) => sum + s.events.length, 0);
  const playableSlots = trackSlots.filter((s) => s.hasPlayableEvents).length;
  console.log(
    `[Parser] SonFile: ${trackSlots.length} track slots, ` +
      `${playableSlots} with MIDI events, ${totalEvents} total events, ` +
      `${songData.patterns.length} patterns, ${header.tempo} BPM`
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
      decodeAscii(data.slice(offset, offset + INSTRUMENT_NAME_LENGTH))
    );
  }

  const channelConfig = {
    channels: Array.from(
      data.slice(CHANNEL_MAP_OFFSET, CHANNEL_MAP_OFFSET + MAX_INSTRUMENTS)
    ),
    programs: Array.from(
      data.slice(PROGRAM_MAP_OFFSET, PROGRAM_MAP_OFFSET + MAX_INSTRUMENTS)
    ),
    volumes: Array.from(
      data.slice(VOLUME_MAP_OFFSET, VOLUME_MAP_OFFSET + MAX_INSTRUMENTS)
    ),
    pans: Array.from(
      data.slice(PAN_MAP_OFFSET, PAN_MAP_OFFSET + MAX_INSTRUMENTS)
    ),
  };

  return {
    magic,
    tempo,
    ticksPerMeasure,
    ticksPerBeat,
    instrumentNames,
    channelConfig,
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
    TRACK_HEADER_SIZE + TRACK_NAME_SIZE
  );
  const rawConfig = chunk.slice(
    TRACK_HEADER_SIZE + TRACK_NAME_SIZE,
    TRACK_PREAMBLE
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
      e.type === "sysex"
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
            data.slice(cOffset, cOffset + EVENT_SIZE)
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
  startOffset: number
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
  const firstBoundaryPos = positions.length > 0 ? positions[0].pos : region.length;
  const preBoundaryPadding = new Uint8Array(
    region.slice(0, firstBoundaryPos)
  );

  for (let i = 0; i < positions.length; i++) {
    const { pos, type } = positions[i];
    boundaries.push({ type, fileOffset: startOffset + pos });

    const start = pos + 4;
    const end =
      i + 1 < positions.length ? positions[i + 1].pos : region.length;
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
  view: DataView
): SongData {
  const arrangement = parseArrangement(data, view);

  // Build Track[] from playable TrackSlots
  const allTracks: (Track | null)[] = trackSlots.map((slot, index) => {
    if (!slot.hasPlayableEvents) return null;

    // Filter to only MIDI events for playback
    const midiEvents = slot.events.filter(
      (e): e is TrackEvent =>
        e.type === "note_on" ||
        e.type === "note_off" ||
        e.type === "aftertouch" ||
        e.type === "control_change" ||
        e.type === "program_change" ||
        e.type === "channel_pressure" ||
        e.type === "pitch_wheel" ||
        e.type === "sysex"
    );

    if (midiEvents.length === 0) return null;

    // Resolve channel: use track config, then header config, then slot index
    const slotInPattern = index % TRACKS_PER_PATTERN;
    let channel = slotInPattern;

    // Track config channel (from the 14-byte config block)
    if (slot.config.midiChannel > 0) {
      channel = slot.config.midiChannel - 1; // 1-based in config
    } else {
      // Fallback to header channel map
      const headerChannel = header.channelConfig.channels[slotInPattern];
      if (headerChannel !== undefined && headerChannel <= 15) {
        channel = headerChannel;
      }
    }

    const isDrums =
      channel === 9 ||
      /drum|percuss/i.test(slot.name) ||
      slotInPattern === 9;

    return {
      name: slot.name,
      channel: isDrums ? 9 : channel,
      header: slot.rawHeader,
      config: slot.rawConfig,
      events: midiEvents,
    };
  });

  // Group into patterns
  const patterns: Pattern[] = [];
  const numPatterns = Math.ceil(allTracks.length / TRACKS_PER_PATTERN);

  for (let p = 0; p < numPatterns; p++) {
    const startSlot = p * TRACKS_PER_PATTERN;
    const patternTracks: Track[] = [];

    for (let t = 0; t < TRACKS_PER_PATTERN; t++) {
      const track = allTracks[startSlot + t];
      if (track) patternTracks.push(track);
    }

    if (patternTracks.length === 0) continue;

    const totalTicks = patternTracks.reduce((max, track) => {
      const last = track.events[track.events.length - 1];
      return last ? Math.max(max, last.tick) : max;
    }, 0);

    patterns.push({
      index: p,
      name: `Pattern ${p + 1}`,
      tracks: patternTracks,
      totalTicks,
    });
  }

  const activePatternIndex = 0;
  const activePattern = patterns[activePatternIndex];
  const activeTracks = activePattern?.tracks ?? [];
  const totalTicks = activePattern?.totalTicks ?? 0;

  console.log(
    `[Parser] ${patterns.length} patterns, ` +
      `active pattern has ${activeTracks.length} tracks, ` +
      `${totalTicks} ticks`
  );

  for (const t of activeTracks) {
    const noteOns = t.events.filter((e) => e.type === "note_on").length;
    const noteOffs = t.events.filter((e) => e.type === "note_off").length;
    console.log(
      `  [Parser] Track "${t.name}" ch=${t.channel}: ${noteOns} note_on, ${noteOffs} note_off`
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
  };
}

// ═══════════════════════════════════════════════════════════════════════
// ARRANGEMENT PARSING
// ═══════════════════════════════════════════════════════════════════════

function parseArrangement(
  data: Uint8Array,
  view: DataView
): { patternIndex: number; bar: number }[] {
  const entries: { patternIndex: number; bar: number }[] = [];
  const regionStart = ARRANGE_OFFSET + 0x16;
  const regionEnd = Math.min(ARRANGE_OFFSET + ARRANGE_SIZE, data.length);

  for (let off = regionStart; off < regionEnd - 4; off += 4) {
    const val = view.getUint32(off, false);
    if (val === 0) continue;

    if ((val & 0xff) === 0xf0 && val > 0x1000 && val < 0x10000) {
      entries.push({
        patternIndex: entries.length,
        bar: entries.length,
      });
    }
  }

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
