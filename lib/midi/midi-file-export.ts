/**
 * Standard MIDI File (SMF) Type 1 Exporter
 *
 * Converts parsed SongData into a Standard MIDI File (.mid) that can
 * be opened in any DAW or MIDI editor. Produces SMF Type 1 (multi-track)
 * with a conductor track (tempo, time signature, song name) followed by
 * one track per SON track.
 *
 * Supports all MIDI event types:
 *   - Note On / Note Off
 *   - Control Change
 *   - Program Change
 *   - Channel Pressure (aftertouch)
 *   - Polyphonic Key Pressure (aftertouch)
 *   - Pitch Wheel
 *   - System Exclusive (SysEx)
 *
 * Zero dependencies — uses only TypeScript/JavaScript builtins.
 */

import type { SongData, TrackEvent } from "@/lib/son-parser/types";

// ═══════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Export SongData to a Standard MIDI File (Type 1) byte array.
 *
 * @param song - Parsed song data from the SON parser
 * @param songName - Optional song name for the MIDI file metadata
 * @returns Uint8Array containing the complete .mid file
 */
export function exportSongToMidi(
  song: SongData,
  songName?: string,
): Uint8Array {
  const ppqn = song.ticksPerBeat || 192;
  const trackChunks: Uint8Array[] = [];

  // ─── Track 0: Conductor (tempo, time sig, song name) ────────────
  trackChunks.push(buildConductorTrack(song, songName));

  // ─── Check if we should flatten the arrangement ─────────────────
  if (song.arrangement.length > 0) {
    // Flatten the arrangement into merged tracks by channel
    const mergedTracks = flattenArrangement(song);
    for (const mt of mergedTracks) {
      trackChunks.push(buildMidiTrack(mt.events, mt.channel, mt.name, song));
    }
  } else {
    // ── Fallback: single pattern export ───────────────────────────
    for (const track of song.tracks) {
      trackChunks.push(
        buildMidiTrack(track.events, track.channel, track.name, song),
      );
    }
  }

  // ─── Assemble the complete file ─────────────────────────────────
  return buildSmfFile(ppqn, trackChunks);
}

/**
 * Export a single track to a Standard MIDI File (Type 0) byte array.
 *
 * @param song - Parsed song data (for tempo, time sig, channel config)
 * @param trackIndex - Index of the track to export
 * @param songName - Optional song name for metadata
 * @returns Uint8Array containing the complete .mid file
 */
export function exportTrackToMidi(
  song: SongData,
  trackIndex: number,
  songName?: string,
): Uint8Array {
  const track = song.tracks[trackIndex];
  if (!track) throw new Error(`Track ${trackIndex} not found`);

  const ppqn = song.ticksPerBeat || 192;
  const trackChunks: Uint8Array[] = [];

  const label = songName
    ? `${songName} - ${track.name || `Track ${trackIndex + 1}`}`
    : track.name || `Track ${trackIndex + 1}`;

  trackChunks.push(buildConductorTrack(song, label));
  trackChunks.push(
    buildMidiTrack(track.events, track.channel, track.name, song),
  );

  return buildSmfFile(ppqn, trackChunks);
}

/**
 * Flatten the arrangement into a set of merged tracks.
 * Walks through arrangement entries in order, copying each referenced
 * pattern's events at the correct tick offset.
 */
function flattenArrangement(
  song: SongData,
): { events: TrackEvent[]; channel: number; name: string }[] {
  const ticksPerMeasure = song.ticksPerMeasure || 768;

  // Accumulate events by channel, keyed by "channel:trackName"
  const channelMap = new Map<
    string,
    { events: TrackEvent[]; channel: number; name: string }
  >();

  let tickOffset = 0;

  for (const entry of song.arrangement) {
    const pattern = song.patterns[entry.patternIndex];
    if (!pattern) continue;

    const entryDurationTicks = entry.length * ticksPerMeasure;

    for (const track of pattern.tracks) {
      const key = `${track.channel}:${track.name}`;

      if (!channelMap.has(key)) {
        channelMap.set(key, {
          events: [],
          channel: track.channel,
          name: track.name,
        });
      }

      const merged = channelMap.get(key)!;

      // Copy events with tick offset, clamping to entry duration
      for (const event of track.events) {
        if (event.tick >= entryDurationTicks) continue;
        merged.events.push({
          ...event,
          tick: event.tick + tickOffset,
        } as TrackEvent);
      }
    }

    tickOffset += entryDurationTicks;
  }

  // Sort events by tick within each merged track
  for (const mt of channelMap.values()) {
    mt.events.sort((a, b) => a.tick - b.tick);
  }

  return Array.from(channelMap.values());
}

/**
 * Trigger a browser download of the MIDI data.
 *
 * @param data - MIDI file bytes (from exportSongToMidi)
 * @param filename - Download filename (e.g. "EXAMPLE.mid")
 */
export function downloadMidi(data: Uint8Array, filename: string): void {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ═══════════════════════════════════════════════════════════════════════
// CONDUCTOR TRACK (Track 0)
// ═══════════════════════════════════════════════════════════════════════

function buildConductorTrack(song: SongData, songName?: string): Uint8Array {
  const events: number[] = [];

  // Song name meta-event (FF 03 len text)
  const name = songName || "Notator Export";
  events.push(...vlq(0)); // delta = 0
  events.push(0xff, 0x03);
  const nameBytes = encodeText(name);
  events.push(...vlq(nameBytes.length));
  events.push(...nameBytes);

  // Tempo meta-event (FF 51 03 tt tt tt)
  const tempo = song.tempo || 120;
  const microsecondsPerBeat = Math.round(60_000_000 / tempo);
  events.push(...vlq(0)); // delta = 0
  events.push(0xff, 0x51, 0x03);
  events.push(
    (microsecondsPerBeat >> 16) & 0xff,
    (microsecondsPerBeat >> 8) & 0xff,
    microsecondsPerBeat & 0xff,
  );

  // Time signature meta-event (FF 58 04 nn dd cc bb)
  const ticksPerMeasure = song.ticksPerMeasure || 768;
  const ticksPerBeat = song.ticksPerBeat || 192;
  const beatsPerBar = Math.round(ticksPerMeasure / ticksPerBeat);
  // dd = log2 of denominator (4 = quarter note → dd=2)
  const denominator = 2; // quarter note
  const midiClocks = 24; // standard: 24 MIDI clocks per metronome click
  const thirtySeconds = 8; // standard: 8 32nd-notes per beat
  events.push(...vlq(0)); // delta = 0
  events.push(0xff, 0x58, 0x04);
  events.push(beatsPerBar, denominator, midiClocks, thirtySeconds);

  // End-of-track (FF 2F 00)
  events.push(...vlq(0));
  events.push(0xff, 0x2f, 0x00);

  return wrapTrackChunk(new Uint8Array(events));
}

// ═══════════════════════════════════════════════════════════════════════
// MIDI TRACK BUILDER
// ═══════════════════════════════════════════════════════════════════════

function buildMidiTrack(
  trackEvents: TrackEvent[],
  channel: number,
  trackName: string,
  song: SongData,
): Uint8Array {
  const events: number[] = [];
  const ch = channel & 0x0f;

  // Track name meta-event
  if (trackName) {
    events.push(...vlq(0));
    events.push(0xff, 0x03);
    const nameBytes = encodeText(trackName);
    events.push(...vlq(nameBytes.length));
    events.push(...nameBytes);
  }

  // ─── Initial channel setup at tick 0 ────────────────────────────
  // Program change from channelConfig
  const program = song.channelConfig.programs[ch];
  if (program !== undefined && program > 0) {
    events.push(...vlq(0));
    events.push(0xc0 | ch, program & 0x7f);
  }

  // Volume (CC 7) from channelConfig
  const volume = song.channelConfig.volumes[ch];
  if (volume !== undefined && volume > 0) {
    events.push(...vlq(0));
    events.push(0xb0 | ch, 0x07, volume & 0x7f);
  }

  // Pan (CC 10) from channelConfig
  const pan = song.channelConfig.pans[ch];
  if (pan !== undefined && pan > 0) {
    events.push(...vlq(0));
    events.push(0xb0 | ch, 0x0a, pan & 0x7f);
  }

  // ─── Convert track events to MIDI with delta times ──────────────
  let lastTick = 0;

  for (const event of trackEvents) {
    const delta = Math.max(0, event.tick - lastTick);
    lastTick = event.tick;

    switch (event.type) {
      case "note_on":
        events.push(...vlq(delta));
        events.push(0x90 | ch, event.note & 0x7f, event.velocity & 0x7f);
        break;

      case "note_off":
        events.push(...vlq(delta));
        events.push(0x80 | ch, event.note & 0x7f, 0x00);
        break;

      case "control_change":
        events.push(...vlq(delta));
        events.push(0xb0 | ch, event.controller & 0x7f, event.value & 0x7f);
        break;

      case "program_change":
        events.push(...vlq(delta));
        events.push(0xc0 | ch, event.program & 0x7f);
        break;

      case "channel_pressure":
        events.push(...vlq(delta));
        events.push(0xd0 | ch, event.pressure & 0x7f);
        break;

      case "aftertouch":
        events.push(...vlq(delta));
        events.push(0xa0 | ch, event.note & 0x7f, event.pressure & 0x7f);
        break;

      case "pitch_wheel": {
        events.push(...vlq(delta));
        // Convert from -8192..8191 to 14-bit (0..16383)
        const midiValue = Math.max(0, Math.min(16383, event.value + 8192));
        const lsb = midiValue & 0x7f;
        const msb = (midiValue >> 7) & 0x7f;
        events.push(0xe0 | ch, lsb, msb);
        break;
      }

      case "sysex":
        events.push(...vlq(delta));
        // Write F0 <length> <data excluding F0>
        // data starts with F0 and ends with F7
        if (event.data.length > 1) {
          events.push(0xf0);
          const sysexBody = event.data.slice(1); // skip the leading F0
          events.push(...vlq(sysexBody.length));
          events.push(...sysexBody);
        }
        break;
    }
  }

  // End-of-track
  events.push(...vlq(0));
  events.push(0xff, 0x2f, 0x00);

  return wrapTrackChunk(new Uint8Array(events));
}

// ═══════════════════════════════════════════════════════════════════════
// SMF FILE ASSEMBLY
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the complete SMF file: MThd header + MTrk chunks.
 */
function buildSmfFile(ppqn: number, trackChunks: Uint8Array[]): Uint8Array {
  // MThd header (14 bytes total):
  //   "MThd"     (4 bytes)
  //   length=6   (4 bytes, big-endian)
  //   format=1   (2 bytes)
  //   nTracks    (2 bytes)
  //   division   (2 bytes, PPQN)
  const header = new Uint8Array(14);
  const hView = new DataView(header.buffer);
  header[0] = 0x4d; // M
  header[1] = 0x54; // T
  header[2] = 0x68; // h
  header[3] = 0x64; // d
  hView.setUint32(4, 6, false); // chunk length
  hView.setUint16(8, 1, false); // format 1
  hView.setUint16(10, trackChunks.length, false);
  hView.setUint16(12, ppqn & 0x7fff, false);

  // Calculate total size
  let totalSize = header.length;
  for (const chunk of trackChunks) {
    totalSize += chunk.length;
  }

  // Assemble
  const output = new Uint8Array(totalSize);
  let pos = 0;
  output.set(header, pos);
  pos += header.length;
  for (const chunk of trackChunks) {
    output.set(chunk, pos);
    pos += chunk.length;
  }

  return output;
}

/**
 * Wrap track data in an MTrk chunk: "MTrk" + length + data
 */
function wrapTrackChunk(data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + data.length);
  const view = new DataView(chunk.buffer);
  chunk[0] = 0x4d; // M
  chunk[1] = 0x54; // T
  chunk[2] = 0x72; // r
  chunk[3] = 0x6b; // k
  view.setUint32(4, data.length, false);
  chunk.set(data, 8);
  return chunk;
}

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Encode a non-negative integer as a MIDI variable-length quantity (VLQ).
 * Returns an array of 1–4 bytes.
 */
function vlq(value: number): number[] {
  if (value < 0) value = 0;

  if (value < 0x80) return [value];

  const bytes: number[] = [];
  bytes.unshift(value & 0x7f);
  value >>= 7;

  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }

  return bytes;
}

/**
 * Encode a string as ASCII bytes.
 */
function encodeText(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes.push(code < 128 ? code : 0x3f); // replace non-ASCII with '?'
  }
  return bytes;
}
