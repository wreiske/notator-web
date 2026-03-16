/**
 * WASM-powered .SON file parser adapter.
 *
 * Wraps the Rust WASM module to provide the same interface as the
 * original TypeScript parser. The WASM module is lazy-loaded on
 * first use and cached for subsequent calls.
 *
 * Falls back to the TypeScript parser if WASM fails to load.
 */

import type { SonFile, SongData } from "./types";

// Lazy-loaded WASM module references
let wasmParseFn: ((data: Uint8Array) => SongData) | null = null;
let wasmExportFn: ((data: Uint8Array, name: string) => Uint8Array) | null =
  null;
let wasmReady = false;
let wasmInitPromise: Promise<void> | null = null;

/**
 * Initialize the WASM module. Safe to call multiple times.
 */
async function ensureWasm(): Promise<boolean> {
  if (wasmReady) return true;

  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      try {
        const mod = await import("@/lib/son-parser-wasm/son_parser");
        // The default export is the init function
        await mod.default();
        wasmParseFn = mod.parse_son_wasm as (data: Uint8Array) => SongData;
        wasmExportFn = mod.export_midi_wasm as (
          data: Uint8Array,
          name: string,
        ) => Uint8Array;
        wasmReady = true;
        console.log("[son-parser] WASM module loaded successfully");
      } catch (err) {
        console.warn(
          "[son-parser] WASM load failed, will use TS fallback:",
          err,
        );
        wasmReady = false;
      }
    })();
  }

  await wasmInitPromise;
  return wasmReady;
}

/**
 * Parse a .SON file using the Rust WASM parser, with TypeScript fallback.
 *
 * Returns a SonFile with full round-trip data. The `songData` field
 * contains the playback-oriented view used by the UI.
 *
 * @param buffer - Raw .SON file bytes
 * @returns Parsed SonFile structure
 */
export async function parseSonFileWasm(buffer: ArrayBuffer): Promise<SonFile> {
  const ready = await ensureWasm();

  if (ready && wasmParseFn) {
    const data = new Uint8Array(buffer);
    const songData = wasmParseFn(data);

    // Wrap into a SonFile-compatible object.
    // The WASM parser serializes SongData (the playback view).
    // For full round-trip editing, use the TS parser instead.
    return {
      rawHeader: new Uint8Array(buffer.slice(0, 0x5ac8)),
      header: {
        magic: 0x3b9e,
        tempo: songData.tempo,
        ticksPerMeasure: songData.ticksPerMeasure,
        ticksPerBeat: songData.ticksPerBeat,
        instrumentNames: songData.instrumentNames,
        channelConfig: songData.channelConfig,
        headerConfig: songData.headerConfig,
        trackGroups: songData.trackGroups,
      },
      trackSlots: [],
      boundaries: [],
      preBoundaryPadding: new Uint8Array(0),
      patternNames: [],
      songData,
    };
  }

  // Fallback to TypeScript parser
  const { parseSonFile } = await import("@/lib/son-parser");
  return parseSonFile(buffer);
}

/**
 * Export a .SON file to MIDI bytes using the Rust WASM exporter.
 * Falls back to the TypeScript MIDI exporter if WASM is not available.
 */
export async function exportToMidiWasm(
  buffer: ArrayBuffer,
  songName: string,
): Promise<Uint8Array> {
  const ready = await ensureWasm();

  if (ready && wasmExportFn) {
    const data = new Uint8Array(buffer);
    return wasmExportFn(data, songName);
  }

  // Fallback: parse with TS, export with TS
  const { parseSonFile } = await import("@/lib/son-parser");
  const { exportSongToMidi } = await import("@/lib/midi/midi-file-export");
  const sonFile = parseSonFile(buffer);
  return exportSongToMidi(sonFile.songData, songName);
}
