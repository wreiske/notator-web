/**
 * GM SoundFont Synthesizer
 *
 * Uses WebAudioFont to provide General MIDI instrument samples
 * for realistic playback. Loads instrument data from CDN on demand.
 *
 * Features:
 * - All 128 GM programs (loaded from FluidR3_GM SoundFont)
 * - Full GM drum kit on channel 10 (MIDI ch 9)
 * - Per-channel program change support
 * - Velocity-sensitive sample playback
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// WebAudioFont doesn't have TypeScript types — use any for its API
declare class WebAudioFontPlayer {
  loader: any;
  queueWaveTable(
    audioContext: AudioContext,
    target: AudioNode,
    preset: any,
    when: number,
    pitch: number,
    duration: number,
    volume?: number,
    slides?: any[],
  ): any;
  cancelQueue(audioContext: AudioContext): void;
  adjustPreset(audioContext: AudioContext, preset: any): void;
}

/** CDN base URL for WebAudioFont instrument data */
const FONT_CDN = "https://surikov.github.io/webaudiofontdata/sound/";

/**
 * FluidR3 GM SoundFont variable names for each GM program (0-127).
 * Format: `_tone_PPPP_FluidR3_GM_sf2_file` where PPPP = program × 10, zero-padded.
 */
function getInstrumentKey(program: number): {
  variable: string;
  url: string;
} {
  const p = String(program * 10).padStart(4, "0");
  return {
    variable: `_tone_${p}_FluidR3_GM_sf2_file`,
    url: `${FONT_CDN}${p}_FluidR3_GM_sf2_file.js`,
  };
}

/**
 * GM drum kit variable names.
 * Uses SBLive SoundFont for drums (good quality, reliable availability).
 */
function getDrumKey(noteNumber: number): {
  variable: string;
  url: string;
} {
  const nn = Math.max(35, Math.min(81, noteNumber));
  return {
    variable: `_drum_${nn}_0_SBLive_sf2`,
    url: `${FONT_CDN}128${nn}_0_SBLive_sf2.js`,
  };
}

interface ActiveEnvelope {
  envelope: any;
  channel: number;
  note: number;
}

interface PendingNote {
  channel: number;
  note: number;
  velocity: number;
  when: number;
}

export class SynthFallback {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private player: WebAudioFontPlayer | null = null;

  /** Loaded instrument presets by GM program number */
  private instruments: Map<number, any> = new Map();
  /** Loaded drum presets by MIDI note number */
  private drums: Map<number, any> = new Map();
  /** Currently active note envelopes (key = channel * 128 + note) */
  private activeNotes: Map<number, ActiveEnvelope> = new Map();
  /** Per-channel program assignment (default: 0 = Acoustic Grand Piano) */
  private channelPrograms: number[] = new Array(16).fill(0);
  /** Set of instruments currently being loaded */
  private loading: Set<string> = new Set();
  /** Notes waiting for their instrument to load */
  private pendingNotes: Map<string, PendingNote[]> = new Map();

  /** Initialize the audio context and WebAudioFont player */
  async init(): Promise<void> {
    if (this.audioContext && this.player) return;

    this.audioContext = new AudioContext();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(this.audioContext.destination);

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    // WebAudioFont has no ESM/CJS exports — it sets globals via script tag.
    // Load it from node_modules build output served by Next.js.
    if (!(window as any).WebAudioFontPlayer) {
      await this.loadScript("/webaudiofont/WebAudioFontPlayer.js");
    }

    if ((window as any).WebAudioFontPlayer) {
      this.player = new (
        window as any
      ).WebAudioFontPlayer() as WebAudioFontPlayer;
      console.log("[GM] WebAudioFont player initialized");

      // Pre-load piano (program 0) and standard drum kit
      this.loadInstrument(0);
      this.preloadDrumKit();
    } else {
      console.warn("[GM] WebAudioFont failed to load — using basic synth");
    }
  }

  /** Set program (instrument) for a channel */
  programChange(channel: number, program: number): void {
    if (channel === 9) return; // Drums don't have program changes in GM
    this.channelPrograms[channel] = program & 0x7f;
    this.loadInstrument(program & 0x7f);
  }

  /** Start a note with SoundFont samples.
   *  @param when  Optional AudioContext time to schedule the note at.
   *               Defaults to audioContext.currentTime (immediate). */
  noteOn(channel: number, note: number, velocity: number, when?: number): void {
    if (!this.audioContext || !this.masterGain || !this.player) return;

    const key = channel * 128 + note;
    this.noteOff(channel, note, when); // Stop any existing note

    const volume = (velocity / 127) * 0.8;
    const scheduledTime = when ?? this.audioContext.currentTime;

    if (channel === 9) {
      // Drum channel — use drum preset
      const preset = this.drums.get(note);
      if (!preset) {
        // Queue the note and start loading
        const drumKey = getDrumKey(note).variable;
        this.queuePendingNote(drumKey, { channel, note, velocity, when: scheduledTime });
        this.loadDrum(note);
        return;
      }

      const envelope = this.player.queueWaveTable(
        this.audioContext,
        this.masterGain,
        preset,
        scheduledTime,
        note,
        1.5, // Duration for drums (they're percussive, will decay)
        volume,
      );

      this.activeNotes.set(key, { envelope, channel, note });
    } else {
      // Melodic channel — use instrument preset based on program
      const program = this.channelPrograms[channel] || 0;
      const preset = this.instruments.get(program);

      if (!preset) {
        // Queue the note and start loading
        const instrKey = getInstrumentKey(program).variable;
        this.queuePendingNote(instrKey, { channel, note, velocity, when: scheduledTime });
        this.loadInstrument(program);
        return;
      }

      const envelope = this.player.queueWaveTable(
        this.audioContext,
        this.masterGain,
        preset,
        scheduledTime,
        note,
        10, // Long duration — noteOff will cut it short
        volume,
      );

      this.activeNotes.set(key, { envelope, channel, note });
    }
  }

  /** Stop a note.
   *  @param when  Optional AudioContext time to schedule the stop at. */
  noteOff(channel: number, note: number, when?: number): void {
    if (!this.audioContext) return;

    const key = channel * 128 + note;
    const active = this.activeNotes.get(key);
    if (!active || !active.envelope) return;

    // Cancel the envelope with a quick fade
    const stopTime = (when ?? this.audioContext.currentTime) + 0.05;
    try {
      if (active.envelope.audioBufferSourceNode) {
        active.envelope.audioBufferSourceNode.stop(stopTime);
      }
    } catch {
      // Already stopped
    }

    this.activeNotes.delete(key);
  }

  /** Stop all notes */
  panic(): void {
    if (!this.audioContext || !this.player) return;

    for (const [key, active] of this.activeNotes) {
      try {
        if (active.envelope?.audioBufferSourceNode) {
          active.envelope.audioBufferSourceNode.stop(0);
        }
      } catch {
        // Already stopped
      }
      this.activeNotes.delete(key);
    }

    try {
      this.player.cancelQueue(this.audioContext);
    } catch {
      // Ignore
    }
  }

  /** Set master volume (0-1) */
  setVolume(volume: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /** Preload all instruments that a song uses (by GM program numbers).
   *  Call this before playback starts to avoid dropped first notes. */
  async preloadForSong(programs: number[]): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const program of programs) {
      if (!this.instruments.has(program)) {
        promises.push(this.loadInstrument(program));
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /** Clean up resources */
  destroy(): void {
    this.panic();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.instruments.clear();
    this.drums.clear();
    this.pendingNotes.clear();
  }

  // ─── Internal Loading ───────────────────────────────────────────────

  /** Load a GM instrument (by program number 0-127) */
  private async loadInstrument(program: number): Promise<void> {
    if (this.instruments.has(program)) return;

    const { variable, url } = getInstrumentKey(program);
    if (this.loading.has(variable)) return;
    this.loading.add(variable);

    try {
      // Check if already loaded globally (from a previous session)
      if ((window as any)[variable]) {
        const preset = (window as any)[variable];
        if (this.audioContext && this.player) {
          this.player.adjustPreset(this.audioContext, preset);
        }
        this.instruments.set(program, preset);
        console.log(`[GM] Loaded program ${program} (cached): ${variable}`);
        this.replayPendingNotes(variable);
        return;
      }

      // Load the instrument data script from CDN
      await this.loadScript(url);

      const preset = (window as any)[variable];
      if (preset && this.audioContext && this.player) {
        this.player.adjustPreset(this.audioContext, preset);
        this.instruments.set(program, preset);
        console.log(`[GM] Loaded program ${program}: ${variable}`);
        this.replayPendingNotes(variable);
      }
    } catch (err) {
      console.warn(`[GM] Failed to load program ${program}:`, err);
    } finally {
      this.loading.delete(variable);
    }
  }

  /** Load a drum sample (by MIDI note number 35-81) */
  private async loadDrum(noteNumber: number): Promise<void> {
    if (this.drums.has(noteNumber)) return;

    const { variable, url } = getDrumKey(noteNumber);
    if (this.loading.has(variable)) return;
    this.loading.add(variable);

    try {
      if ((window as any)[variable]) {
        const preset = (window as any)[variable];
        if (this.audioContext && this.player) {
          this.player.adjustPreset(this.audioContext, preset);
        }
        this.drums.set(noteNumber, preset);
        this.replayPendingNotes(variable);
        return;
      }

      await this.loadScript(url);

      const preset = (window as any)[variable];
      if (preset && this.audioContext && this.player) {
        this.player.adjustPreset(this.audioContext, preset);
        this.drums.set(noteNumber, preset);
        this.replayPendingNotes(variable);
      }
    } catch (err) {
      console.warn(`[GM] Failed to load drum ${noteNumber}:`, err);
    } finally {
      this.loading.delete(variable);
    }
  }

  /** Pre-load the standard GM drum kit (common notes 35-57) */
  private preloadDrumKit(): void {
    // Most common drum kit notes
    const commonDrums = [
      35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52,
      53, 54, 55, 56, 57,
    ];
    for (const note of commonDrums) {
      this.loadDrum(note);
    }
  }

  // ─── Pending Note Queue ──────────────────────────────────────────────

  /** Queue a note to be played once its instrument/drum loads */
  private queuePendingNote(variableKey: string, pending: PendingNote): void {
    const list = this.pendingNotes.get(variableKey) || [];
    list.push(pending);
    this.pendingNotes.set(variableKey, list);
  }

  /** Replay any pending notes for a just-loaded instrument/drum */
  private replayPendingNotes(variableKey: string): void {
    const pending = this.pendingNotes.get(variableKey);
    if (!pending || pending.length === 0) return;
    this.pendingNotes.delete(variableKey);

    if (!this.audioContext) return;

    // Only replay notes that are still in the near future (within 500ms).
    // Notes that are already far in the past aren't worth replaying.
    const now = this.audioContext.currentTime;
    for (const p of pending) {
      if (p.when >= now - 0.1) {
        // Schedule at 'now' if the original time has passed
        const when = Math.max(now, p.when);
        this.noteOn(p.channel, p.note, p.velocity, when);
      }
    }
  }

  /** Load a JavaScript file from URL */
  private loadScript(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.type = "text/javascript";
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load font: ${url}`));
      document.head.appendChild(script);
    });
  }

  /** Get the AudioContext (for computing scheduled times externally) */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }
}
