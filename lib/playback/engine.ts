/**
 * Playback Engine — schedules MIDI events from parsed SongData
 *
 * Uses a lookahead scheduler (setTimeout-based) to dispatch events
 * at the correct time. Outputs to either Web MIDI or the synth fallback.
 *
 * Supports arrangement-based pattern sequencing: when a pattern finishes,
 * automatically advances to the next pattern in the song.
 */

import type { SongData, TrackEvent } from "@/lib/son-parser/types";
import { SynthFallback } from "@/lib/midi/synth-fallback";
import {
  type MidiOutput,
  noteOn as midiNoteOn,
  noteOff as midiNoteOff,
  pitchWheel as midiPitchWheel,
  panic as midiPanic,
} from "@/lib/midi/web-midi";

export type PlaybackState = "stopped" | "playing" | "paused";

interface PlaybackCallbacks {
  onStateChange?: (state: PlaybackState) => void;
  onPositionChange?: (tick: number) => void;
  onTrackEvent?: (trackIndex: number, event: TrackEvent) => void;
  /** Called when the engine auto-advances to the next pattern */
  onPatternChange?: (patternIndex: number) => void;
}

interface ScheduledTrack {
  events: TrackEvent[];
  nextEventIndex: number;
  channel: number;
}

export class PlaybackEngine {
  private state: PlaybackState = "stopped";
  private song: SongData | null = null;
  private tempo: number = 120;

  // Output
  private synth: SynthFallback = new SynthFallback();
  private midiOutput: MidiOutput | null = null;

  // Scheduling
  private startTime: number = 0;
  private pausePosition: number = 0;
  private scheduledTracks: ScheduledTrack[] = [];
  private schedulerTimer: ReturnType<typeof setTimeout> | null = null;

  // Arrangement / pattern sequencing
  private currentPatternIndex: number = 0;

  // Mute/Solo
  private mutedTracks: Set<number> = new Set();
  private soloedTracks: Set<number> = new Set();

  // Callbacks
  private callbacks: PlaybackCallbacks = {};

  // Scheduling constants
  private readonly SCHEDULE_AHEAD_SECS = 0.1;
  private readonly LOOKAHEAD_MS = 25;

  /** Set the MIDI output device */
  setMidiOutput(output: MidiOutput | null): void {
    this.midiOutput = output;
  }

  /** Set callback functions */
  setCallbacks(callbacks: PlaybackCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Load a song for playback */
  loadSong(song: SongData): void {
    this.stop();
    this.song = song;
    this.tempo = song.tempo || 120;
    this.currentPatternIndex = song.activePatternIndex || 0;
    this.resetTrackState();
  }

  /** Set playback tempo */
  setTempo(bpm: number): void {
    if (bpm < 20 || bpm > 300) return;
    this.tempo = bpm;
  }

  /** Toggle mute for a track */
  toggleMute(trackIndex: number): void {
    if (this.mutedTracks.has(trackIndex)) {
      this.mutedTracks.delete(trackIndex);
    } else {
      this.mutedTracks.add(trackIndex);
    }
  }

  /** Toggle solo for a track */
  toggleSolo(trackIndex: number): void {
    if (this.soloedTracks.has(trackIndex)) {
      this.soloedTracks.delete(trackIndex);
    } else {
      this.soloedTracks.add(trackIndex);
    }
  }

  /** Check if a track should produce sound */
  private isTrackAudible(trackIndex: number): boolean {
    if (this.mutedTracks.has(trackIndex)) return false;
    if (this.soloedTracks.size > 0 && !this.soloedTracks.has(trackIndex))
      return false;
    return true;
  }

  /** Start or resume playback */
  async play(): Promise<void> {
    if (!this.song) return;

    await this.synth.init();

    if (this.state === "paused") {
      this.startTime =
        performance.now() / 1000 -
        this.ticksToSeconds(this.pausePosition);
    } else {
      this.resetTrackState();
      this.startTime = performance.now() / 1000;
    }

    this.state = "playing";
    this.callbacks.onStateChange?.("playing");
    this.scheduleLoop();
  }

  /** Pause playback */
  pause(): void {
    if (this.state !== "playing") return;

    this.pausePosition = this.getCurrentTick();
    this.state = "paused";
    this.callbacks.onStateChange?.("paused");
    this.stopScheduler();
    this.silenceAll();
  }

  /** Stop playback and reset to beginning */
  stop(): void {
    this.state = "stopped";
    this.pausePosition = 0;
    this.callbacks.onStateChange?.("stopped");
    this.callbacks.onPositionChange?.(0);
    this.stopScheduler();
    this.silenceAll();
    this.resetTrackState();
  }

  /** Get current playback position in ticks */
  getCurrentTick(): number {
    if (this.state === "stopped") return 0;
    if (this.state === "paused") return this.pausePosition;

    const elapsed = performance.now() / 1000 - this.startTime;
    return this.secondsToTicks(elapsed);
  }

  /** Convert ticks to seconds based on current tempo */
  private ticksToSeconds(ticks: number): number {
    const tpb = this.song?.ticksPerBeat ?? 192;
    const ticksPerSecond = (this.tempo * tpb) / 60;
    return ticks / ticksPerSecond;
  }

  /** Convert seconds to ticks based on current tempo */
  private secondsToTicks(seconds: number): number {
    const tpb = this.song?.ticksPerBeat ?? 192;
    const ticksPerSecond = (this.tempo * tpb) / 60;
    return Math.floor(seconds * ticksPerSecond);
  }

  /** Main scheduler loop */
  private scheduleLoop = (): void => {
    if (this.state !== "playing" || !this.song) return;

    const currentTick = this.getCurrentTick();
    const lookaheadTicks = this.secondsToTicks(this.SCHEDULE_AHEAD_SECS);
    const scheduleUntilTick = currentTick + lookaheadTicks;

    this.callbacks.onPositionChange?.(currentTick);

    // Check if current pattern is finished
    if (currentTick >= this.song.totalTicks) {
      // Try to advance to the next pattern
      if (this.advanceToNextPattern()) {
        // Successfully moved to next pattern — continue playing
        return;
      }
      // No more patterns — stop
      this.stop();
      return;
    }

    for (let i = 0; i < this.scheduledTracks.length; i++) {
      const track = this.scheduledTracks[i];

      while (track.nextEventIndex < track.events.length) {
        const event = track.events[track.nextEventIndex];
        if (event.tick > scheduleUntilTick) break;

        if (this.isTrackAudible(i)) {
          this.dispatchEvent(track.channel, event);
          this.callbacks.onTrackEvent?.(i, event);
        }

        track.nextEventIndex++;
      }
    }

    this.schedulerTimer = setTimeout(this.scheduleLoop, this.LOOKAHEAD_MS);
  };

  /**
   * Advance to the next pattern in the song.
   * Returns true if a next pattern was found and loaded.
   */
  private advanceToNextPattern(): boolean {
    if (!this.song) return false;

    const nextIndex = this.currentPatternIndex + 1;

    // Check if there are more patterns
    if (nextIndex >= this.song.patterns.length) {
      return false;
    }

    const nextPattern = this.song.patterns[nextIndex];
    if (!nextPattern || nextPattern.tracks.length === 0) {
      return false;
    }

    // Silence current notes before switching
    this.silenceAll();

    // Update current pattern
    this.currentPatternIndex = nextIndex;

    // Load the next pattern's tracks
    this.song = {
      ...this.song,
      tracks: nextPattern.tracks,
      totalTicks: nextPattern.totalTicks,
      activePatternIndex: nextIndex,
    };

    // Reset timing and track state for the new pattern
    this.resetTrackState();
    this.startTime = performance.now() / 1000;
    this.pausePosition = 0;

    // Notify UI about the pattern change
    this.callbacks.onPatternChange?.(nextIndex);
    this.callbacks.onPositionChange?.(0);

    console.log(
      `[Engine] Advanced to pattern ${nextIndex + 1} ` +
        `(${nextPattern.tracks.length} tracks, ${nextPattern.totalTicks} ticks)`
    );

    // Continue the scheduler loop
    this.schedulerTimer = setTimeout(this.scheduleLoop, this.LOOKAHEAD_MS);
    return true;
  }

  /** Dispatch a single event to the output */
  private dispatchEvent(channel: number, event: TrackEvent): void {
    if (this.midiOutput) {
      switch (event.type) {
        case "note_on":
          midiNoteOn(this.midiOutput, channel, event.note, event.velocity);
          break;
        case "note_off":
          midiNoteOff(this.midiOutput, channel, event.note);
          break;
        case "pitch_wheel":
          midiPitchWheel(this.midiOutput, channel, event.value);
          break;
        case "program_change":
          // Send MIDI program change to hardware
          if (this.midiOutput.send) {
            this.midiOutput.send([0xc0 | (channel & 0x0f), event.program & 0x7f]);
          }
          break;
      }
    } else {
      switch (event.type) {
        case "note_on":
          this.synth.noteOn(channel, event.note, event.velocity);
          break;
        case "note_off":
          this.synth.noteOff(channel, event.note);
          break;
        case "program_change":
          this.synth.programChange(channel, event.program);
          break;
      }
    }
  }

  /** Silence all active notes */
  private silenceAll(): void {
    this.synth.panic();
    if (this.midiOutput) {
      midiPanic(this.midiOutput);
    }
  }

  /** Stop the scheduler timer */
  private stopScheduler(): void {
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  /** Reset track scheduling state */
  private resetTrackState(): void {
    if (!this.song) {
      this.scheduledTracks = [];
      return;
    }

    this.scheduledTracks = this.song.tracks.map((track) => ({
      events: track.events,
      nextEventIndex: 0,
      channel: track.channel,
    }));
  }

  /** Clean up all resources */
  destroy(): void {
    this.stop();
    this.synth.destroy();
  }
}
