/**
 * Web MIDI API integration
 *
 * Handles requesting MIDI access and sending MIDI messages
 * to connected output devices.
 */

export interface MidiOutput {
  name: string;
  id: string;
  send: (data: number[], timestamp?: number) => void;
}

/** Check if Web MIDI API is available */
export function isMidiSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

/** Request MIDI access and return available outputs */
export async function getMidiAccess(): Promise<{
  outputs: MidiOutput[];
  access: MIDIAccess;
} | null> {
  if (!isMidiSupported()) return null;

  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    const outputs: MidiOutput[] = [];

    access.outputs.forEach((output) => {
      outputs.push({
        name: output.name || "Unknown MIDI Device",
        id: output.id,
        send: (data: number[], timestamp?: number) => {
          output.send(data, timestamp);
        },
      });
    });

    return { outputs, access };
  } catch (err) {
    console.warn("Web MIDI access denied:", err);
    return null;
  }
}

/** Send a Note On message */
export function noteOn(
  output: MidiOutput,
  channel: number,
  note: number,
  velocity: number,
  timestamp?: number
): void {
  const status = 0x90 | (channel & 0x0f);
  output.send([status, note & 0x7f, velocity & 0x7f], timestamp);
}

/** Send a Note Off message */
export function noteOff(
  output: MidiOutput,
  channel: number,
  note: number,
  timestamp?: number
): void {
  const status = 0x80 | (channel & 0x0f);
  output.send([status, note & 0x7f, 0], timestamp);
}

/** Send a Pitch Wheel change message */
export function pitchWheel(
  output: MidiOutput,
  channel: number,
  value: number,
  timestamp?: number
): void {
  const status = 0xe0 | (channel & 0x0f);
  // Convert -8192..8191 range to 14-bit value (0..16383)
  const midiValue = Math.max(0, Math.min(16383, value + 8192));
  const lsb = midiValue & 0x7f;
  const msb = (midiValue >> 7) & 0x7f;
  output.send([status, lsb, msb], timestamp);
}

/** Send All Notes Off on a channel */
export function allNotesOff(
  output: MidiOutput,
  channel: number,
  timestamp?: number
): void {
  const status = 0xb0 | (channel & 0x0f);
  output.send([status, 123, 0], timestamp); // CC 123 = All Notes Off
}

/** Send All Notes Off on all 16 channels */
export function panic(output: MidiOutput): void {
  for (let ch = 0; ch < 16; ch++) {
    allNotesOff(output, ch);
  }
}
