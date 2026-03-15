/**
 * .SON File Serializer — Write-Back Implementation
 *
 * Converts a SonFile structure back to binary .SON format.
 * If no edits were made, the output should be byte-identical
 * to the original file.
 */

import type { SonFile, TrackSlot } from "./types";

/** Boundary marker bytes */
const BOUNDARY_A = new Uint8Array([0x7f, 0xff, 0xff, 0xff]);
const BOUNDARY_B = new Uint8Array([0x00, 0x0f, 0xff, 0xff]);

const EVENT_SIZE = 6;

/**
 * Serialize a SonFile back to binary .SON format.
 */
export function serializeSonFile(sonFile: SonFile): Uint8Array {
  // ─── Calculate total output size ──────────────────────────────────
  let totalSize = sonFile.rawHeader.length;

  // Pre-boundary padding (between 0x5AC8 and first boundary)
  totalSize += sonFile.preBoundaryPadding.length;

  for (let i = 0; i < sonFile.trackSlots.length; i++) {
    totalSize += 4; // boundary marker
    totalSize += slotDataSize(sonFile.trackSlots[i]);
  }

  // ─── Build output buffer ──────────────────────────────────────────
  const output = new Uint8Array(totalSize);
  let pos = 0;

  // Write raw header (byte-exact)
  output.set(sonFile.rawHeader, pos);
  pos += sonFile.rawHeader.length;

  // Write pre-boundary padding
  output.set(sonFile.preBoundaryPadding, pos);
  pos += sonFile.preBoundaryPadding.length;

  // Write each track slot
  for (let i = 0; i < sonFile.trackSlots.length; i++) {
    const slot = sonFile.trackSlots[i];
    const boundary = sonFile.boundaries[i];

    // Write boundary marker
    const marker = boundary?.type === "B" ? BOUNDARY_B : BOUNDARY_A;
    output.set(marker, pos);
    pos += 4;

    // Write track preamble: header (24) + name (8) + config (14) = 46 bytes
    output.set(slot.rawHeader, pos);
    pos += slot.rawHeader.length;

    output.set(slot.rawName, pos);
    pos += slot.rawName.length;

    output.set(slot.rawConfig, pos);
    pos += slot.rawConfig.length;

    // Write events from raw data
    for (const event of slot.events) {
      if (event.type === "sysex") {
        // SysEx: write all chained records
        for (const record of event.rawRecords) {
          output.set(record, pos);
          pos += EVENT_SIZE;
        }
      } else {
        // All other events: write the raw 6-byte record
        output.set(event.raw, pos);
        pos += EVENT_SIZE;
      }
    }
  }

  return output.slice(0, pos);
}

/** Calculate the data size of a track slot (preamble + events) */
function slotDataSize(slot: TrackSlot): number {
  let size =
    slot.rawHeader.length + slot.rawName.length + slot.rawConfig.length;

  for (const event of slot.events) {
    if (event.type === "sysex") {
      size += event.rawRecords.length * EVENT_SIZE;
    } else {
      size += EVENT_SIZE;
    }
  }

  return size;
}

/**
 * Update a header field in the raw header buffer.
 * This mutates the rawHeader in-place for round-trip fidelity.
 */
export function setHeaderField(
  sonFile: SonFile,
  offset: number,
  value: number,
  size: 1 | 2 | 4 = 2,
): void {
  const view = new DataView(
    sonFile.rawHeader.buffer,
    sonFile.rawHeader.byteOffset,
  );
  switch (size) {
    case 1:
      view.setUint8(offset, value);
      break;
    case 2:
      view.setUint16(offset, value, false); // big-endian
      break;
    case 4:
      view.setUint32(offset, value, false);
      break;
  }
}
