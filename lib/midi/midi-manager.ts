/**
 * MIDI Manager — centralized Web MIDI device state management
 *
 * Singleton service that owns the MIDIAccess object, tracks all
 * connected inputs/outputs, handles hot-plug events, provides
 * MIDI Thru functionality, and parses incoming MIDI messages.
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
  type: "input" | "output";
}

export interface MidiInputMessage {
  type:
    | "note_on"
    | "note_off"
    | "control_change"
    | "program_change"
    | "pitch_wheel"
    | "aftertouch"
    | "channel_pressure"
    | "sysex"
    | "clock"
    | "other";
  channel: number;
  data: number[];
  timestamp: number;
  // Typed fields (populated based on message type)
  note?: number;
  velocity?: number;
  controller?: number;
  value?: number;
  program?: number;
  pressure?: number;
}

type MidiEventType =
  | "deviceChange"
  | "midiMessage"
  | "inputActivity"
  | "outputActivity";
type MidiEventCallback = (...args: unknown[]) => void;

// ─── LocalStorage Keys ────────────────────────────────────────────────

const LS_SELECTED_INPUT = "notator_midi_input_id";
const LS_SELECTED_OUTPUT = "notator_midi_output_id";
const LS_MIDI_THRU = "notator_midi_thru";
const LS_SYSEX = "notator_midi_sysex";

// ─── MidiManager ──────────────────────────────────────────────────────

export class MidiManager {
  private access: MIDIAccess | null = null;
  private _inputs: MidiDeviceInfo[] = [];
  private _outputs: MidiDeviceInfo[] = [];
  private _selectedInputId: string | null = null;
  private _selectedOutputId: string | null = null;
  private _midiThruEnabled: boolean = false;
  private _sysexEnabled: boolean = false;
  private _initialized: boolean = false;

  // Active MIDI input listener
  private activeInputPort: MIDIInput | null = null;

  // Event listeners
  private listeners: Map<MidiEventType, Set<MidiEventCallback>> = new Map();

  constructor() {
    // Restore persisted settings
    if (typeof localStorage !== "undefined") {
      this._selectedInputId = localStorage.getItem(LS_SELECTED_INPUT);
      this._selectedOutputId = localStorage.getItem(LS_SELECTED_OUTPUT);
      this._midiThruEnabled = localStorage.getItem(LS_MIDI_THRU) === "true";
      this._sysexEnabled = localStorage.getItem(LS_SYSEX) === "true";
    }
  }

  // ─── Initialization ───────────────────────────────────────────────

  /** Check if Web MIDI API is available in this browser */
  get supported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  /** Whether the manager has been initialized with MIDI access */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Request MIDI access and start tracking devices.
   * Call this once when the app / player page mounts.
   */
  async init(): Promise<boolean> {
    if (this._initialized) return true;
    if (!this.supported) return false;

    try {
      this.access = await navigator.requestMIDIAccess({
        sysex: this._sysexEnabled,
      });

      // Initial device scan
      this.refreshDevices();

      // Listen for hot-plug events
      this.access.onstatechange = () => {
        this.refreshDevices();
        this.emit("deviceChange");
      };

      // Restore selected input listener
      if (this._selectedInputId) {
        this.attachInputListener(this._selectedInputId);
      }

      // Auto-select first available MIDI output if no persisted selection.
      // This prefers hardware/system GM synth (e.g. macOS DLS Synth) over
      // the built-in WebAudioFont, which generally sounds better.
      if (!this._selectedOutputId && this._outputs.length > 0) {
        const firstConnected = this._outputs.find(
          (d) => d.state === "connected",
        );
        if (firstConnected) {
          this._selectedOutputId = firstConnected.id;
          this.persistSelection();
          console.log(
            `[MidiManager] Auto-selected MIDI output: ${firstConnected.name}`,
          );
        }
      }

      this._initialized = true;
      return true;
    } catch (err) {
      console.warn("[MidiManager] MIDI access denied:", err);
      return false;
    }
  }

  // ─── Device Enumeration ───────────────────────────────────────────

  /** All available MIDI inputs */
  get inputs(): MidiDeviceInfo[] {
    return this._inputs;
  }

  /** All available MIDI outputs */
  get outputs(): MidiDeviceInfo[] {
    return this._outputs;
  }

  /** Refresh device lists from the MIDIAccess object */
  private refreshDevices(): void {
    if (!this.access) return;

    const inputs: MidiDeviceInfo[] = [];
    this.access.inputs.forEach((input) => {
      inputs.push({
        id: input.id,
        name: input.name || "Unknown MIDI Input",
        manufacturer: input.manufacturer || "",
        state: input.state,
        type: "input",
      });
    });
    this._inputs = inputs;

    const outputs: MidiDeviceInfo[] = [];
    this.access.outputs.forEach((output) => {
      outputs.push({
        id: output.id,
        name: output.name || "Unknown MIDI Output",
        manufacturer: output.manufacturer || "",
        state: output.state,
        type: "output",
      });
    });
    this._outputs = outputs;

    // If selected devices are no longer connected, keep the IDs
    // (they may reconnect) but the UI should show disconnected state
  }

  // ─── Device Selection ─────────────────────────────────────────────

  get selectedInputId(): string | null {
    return this._selectedInputId;
  }

  get selectedOutputId(): string | null {
    return this._selectedOutputId;
  }

  /** Select a MIDI input device (null = none) */
  selectInput(id: string | null): void {
    // Detach old listener
    this.detachInputListener();

    this._selectedInputId = id;
    this.persistSelection();

    // Attach new listener
    if (id) {
      this.attachInputListener(id);
    }

    this.emit("deviceChange");
  }

  /** Select a MIDI output device (null = use built-in synth) */
  selectOutput(id: string | null): void {
    this._selectedOutputId = id;
    this.persistSelection();
    this.emit("deviceChange");
  }

  /** Get the selected MIDIOutput port (for the PlaybackEngine) */
  getSelectedOutput(): MIDIOutput | null {
    if (!this.access || !this._selectedOutputId) return null;
    const port = this.access.outputs.get(this._selectedOutputId);
    return port && port.state === "connected" ? port : null;
  }

  /**
   * Build a MidiOutput interface compatible with the PlaybackEngine
   * from the currently selected hardware output.
   */
  getMidiOutputForEngine(): import("./web-midi").MidiOutput | null {
    const port = this.getSelectedOutput();
    if (!port) return null;

    return {
      name: port.name || "MIDI Output",
      id: port.id,
      send: (data: number[], timestamp?: number) => {
        port.send(data, timestamp);
        this.emit("outputActivity");
      },
    };
  }

  private persistSelection(): void {
    if (typeof localStorage === "undefined") return;
    if (this._selectedInputId) {
      localStorage.setItem(LS_SELECTED_INPUT, this._selectedInputId);
    } else {
      localStorage.removeItem(LS_SELECTED_INPUT);
    }
    if (this._selectedOutputId) {
      localStorage.setItem(LS_SELECTED_OUTPUT, this._selectedOutputId);
    } else {
      localStorage.removeItem(LS_SELECTED_OUTPUT);
    }
  }

  // ─── MIDI Input ───────────────────────────────────────────────────

  private attachInputListener(inputId: string): void {
    if (!this.access) return;
    const port = this.access.inputs.get(inputId);
    if (!port) return;

    this.activeInputPort = port;
    port.onmidimessage = ((event: Event) => {
      const midiEvent = event as MIDIMessageEvent;
      if (!midiEvent.data || midiEvent.data.length === 0) return;

      this.emit("inputActivity");

      const msg = this.parseMessage(midiEvent.data, midiEvent.timeStamp);

      // Emit parsed message
      this.emit("midiMessage", msg);

      // MIDI Thru: forward raw data to output
      if (this._midiThruEnabled) {
        const output = this.getSelectedOutput();
        if (output) {
          output.send(Array.from(midiEvent.data));
          this.emit("outputActivity");
        }
      }
    }) as EventListener;
  }

  private detachInputListener(): void {
    if (this.activeInputPort) {
      this.activeInputPort.onmidimessage = null;
      this.activeInputPort = null;
    }
  }

  /** Parse raw MIDI bytes into a typed MidiInputMessage */
  private parseMessage(data: Uint8Array, timestamp: number): MidiInputMessage {
    const status = data[0];
    const rawData = Array.from(data);

    // System messages (status >= 0xF0)
    if (status >= 0xf0) {
      if (status === 0xf0) {
        return { type: "sysex", channel: 0, data: rawData, timestamp };
      }
      if (status === 0xf8) {
        return { type: "clock", channel: 0, data: rawData, timestamp };
      }
      return { type: "other", channel: 0, data: rawData, timestamp };
    }

    const channel = status & 0x0f;
    const msgType = status & 0xf0;

    switch (msgType) {
      case 0x90: // Note On
        return {
          type: data[2] > 0 ? "note_on" : "note_off",
          channel,
          data: rawData,
          timestamp,
          note: data[1],
          velocity: data[2],
        };

      case 0x80: // Note Off
        return {
          type: "note_off",
          channel,
          data: rawData,
          timestamp,
          note: data[1],
          velocity: data[2],
        };

      case 0xb0: // Control Change
        return {
          type: "control_change",
          channel,
          data: rawData,
          timestamp,
          controller: data[1],
          value: data[2],
        };

      case 0xc0: // Program Change
        return {
          type: "program_change",
          channel,
          data: rawData,
          timestamp,
          program: data[1],
        };

      case 0xe0: // Pitch Wheel
        return {
          type: "pitch_wheel",
          channel,
          data: rawData,
          timestamp,
          value: ((data[2] << 7) | data[1]) - 8192,
        };

      case 0xa0: // Polyphonic Aftertouch
        return {
          type: "aftertouch",
          channel,
          data: rawData,
          timestamp,
          note: data[1],
          pressure: data[2],
        };

      case 0xd0: // Channel Pressure
        return {
          type: "channel_pressure",
          channel,
          data: rawData,
          timestamp,
          pressure: data[1],
        };

      default:
        return { type: "other", channel, data: rawData, timestamp };
    }
  }

  // ─── MIDI Thru ────────────────────────────────────────────────────

  get midiThruEnabled(): boolean {
    return this._midiThruEnabled;
  }

  toggleMidiThru(): void {
    this._midiThruEnabled = !this._midiThruEnabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_MIDI_THRU, String(this._midiThruEnabled));
    }
    this.emit("deviceChange");
  }

  // ─── SysEx ────────────────────────────────────────────────────────

  get sysexEnabled(): boolean {
    return this._sysexEnabled;
  }

  /**
   * Toggle SysEx support. When enabling, this re-requests MIDI access
   * with sysex: true (browser will prompt the user).
   */
  async toggleSysex(): Promise<void> {
    this._sysexEnabled = !this._sysexEnabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_SYSEX, String(this._sysexEnabled));
    }

    // Re-request access with updated sysex flag
    if (this._initialized) {
      this._initialized = false;
      this.detachInputListener();
      this.access = null;
      await this.init();
    }
  }

  // ─── Panic ────────────────────────────────────────────────────────

  /** Send All Notes Off on all 16 channels to the selected output */
  panic(): void {
    const output = this.getSelectedOutput();
    if (!output) return;

    for (let ch = 0; ch < 16; ch++) {
      // CC 123 = All Notes Off
      output.send([0xb0 | ch, 123, 0]);
      // CC 120 = All Sound Off (more aggressive)
      output.send([0xb0 | ch, 120, 0]);
    }
  }

  // ─── Event Emitter ────────────────────────────────────────────────

  on(event: MidiEventType, callback: MidiEventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: MidiEventType, callback: MidiEventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: MidiEventType, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(...args);
      } catch (err) {
        console.warn(`[MidiManager] Error in ${event} listener:`, err);
      }
    });
  }

  // ─── Cleanup ──────────────────────────────────────────────────────

  destroy(): void {
    this.detachInputListener();
    if (this.access) {
      this.access.onstatechange = null;
    }
    this.listeners.clear();
    this._initialized = false;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

let _instance: MidiManager | null = null;

/** Get the singleton MidiManager instance */
export function getMidiManager(): MidiManager {
  if (!_instance) {
    _instance = new MidiManager();
  }
  return _instance;
}
