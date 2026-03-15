/**
 * Playback Engine — schedules MIDI events from parsed SongData
 *
 * Uses a lookahead scheduler (setTimeout-based) to dispatch events
 * at the correct time. Outputs to either Web MIDI or the synth fallback.
 *
 * Supports arrangement-based pattern sequencing: when a pattern finishes,
 * automatically advances to the next entry in the arrangement. The same
 * pattern can appear multiple times in the arrangement (e.g. drum loops).
 */

import type {
  SongData,
  TrackEvent,
  ArrangementEntry,
} from "@/lib/son-parser/types";
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
  /** Called when the engine advances to a new arrangement entry */
  onPatternChange?: (patternIndex: number) => void;
  /** Called with the arrangement entry index during arrangement-mode playback */
  onArrangementChange?: (
    arrangementIndex: number,
    patternIndex: number,
  ) => void;
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

  // Arrangement sequencing
  private currentArrangementIndex: number = -1; // -1 = no arrangement
  private currentPatternIndex: number = 0;
  private currentEntryTotalTicks: number = 0; // duration of the current entry
  private loopEnabled: boolean = false;
  private useArrangement: boolean = false;

  // Loop region (for piano roll / scrubber)
  private loopRegionStart: number = -1;
  private loopRegionEnd: number = -1;

  // Mute/Solo
  private mutedTracks: Set<number> = new Set();
  private soloedTracks: Set<number> = new Set();

  // Callbacks
  private callbacks: PlaybackCallbacks = {};

  // Scheduling constants
  private readonly SCHEDULE_AHEAD_SECS = 0.1;
  private readonly LOOKAHEAD_MS = 25;

  /** Get the synth for note preview */
  getSynth(): SynthFallback {
    return this.synth;
  }

  /** Ensure the synth is initialized */
  async initSynth(): Promise<void> {
    await this.synth.init();
  }

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

    // Determine if we should use arrangement-based playback
    this.useArrangement = song.arrangement.length > 0;

    if (this.useArrangement) {
      // Start from the first arrangement entry
      this.currentArrangementIndex = 0;
      this.loadArrangementEntry(0);
    } else {
      // Fallback: play the active pattern directly
      this.currentArrangementIndex = -1;
      this.currentPatternIndex = song.activePatternIndex || 0;
      this.currentEntryTotalTicks = song.totalTicks;
      this.resetTrackState();
    }
  }

  /** Set playback tempo */
  setTempo(bpm: number): void {
    if (bpm < 20 || bpm > 300) return;
    this.tempo = bpm;
  }

  /** Set loop mode */
  setLoop(enabled: boolean): void {
    this.loopEnabled = enabled;
  }

  /** Get loop mode */
  getLoop(): boolean {
    return this.loopEnabled;
  }

  /** Set loop region for scrubber (ticks). Pass -1 to clear. */
  setLoopRegion(startTick: number, endTick: number): void {
    this.loopRegionStart = startTick;
    this.loopRegionEnd = endTick;
  }

  /** Get loop region */
  getLoopRegion(): { start: number; end: number } {
    return { start: this.loopRegionStart, end: this.loopRegionEnd };
  }

  /** Seek to a specific tick position */
  seekTo(tick: number): void {
    if (!this.song) return;
    const clampedTick = Math.max(
      0,
      Math.min(tick, this.currentEntryTotalTicks),
    );

    if (this.state === "playing") {
      // Rebase the start time so getCurrentTick() returns the new position
      this.startTime =
        performance.now() / 1000 - this.ticksToSeconds(clampedTick);
      // Reset track scheduling to re-scan from the new position
      this.resetTrackStateFromTick(clampedTick);
      this.silenceAll();
    } else {
      this.pausePosition = clampedTick;
      this.callbacks.onPositionChange?.(clampedTick);
    }
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
      // Resume from paused position
      this.startTime =
        performance.now() / 1000 - this.ticksToSeconds(this.pausePosition);
    } else if (this.pausePosition > 0) {
      // Starting from a seek'd position (user clicked somewhere while stopped)
      this.startTime =
        performance.now() / 1000 - this.ticksToSeconds(this.pausePosition);
      this.resetTrackStateFromTick(this.pausePosition);
    } else {
      // Starting from the very beginning
      if (this.useArrangement && this.currentArrangementIndex !== 0) {
        this.loadArrangementEntry(0);
      } else {
        this.resetTrackState();
      }
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
    const wasPlaying = this.state === "playing" || this.state === "paused";
    this.state = "stopped";
    this.pausePosition = 0;
    this.callbacks.onStateChange?.("stopped");
    this.callbacks.onPositionChange?.(0);
    this.stopScheduler();
    this.silenceAll();

    // Only reset arrangement/tracks if we were actually playing
    if (wasPlaying) {
      if (this.useArrangement && this.song) {
        this.currentArrangementIndex = 0;
        this.loadArrangementEntry(0);
      } else {
        this.resetTrackState();
      }
    }
  }

  /** Jump to a specific arrangement entry (for UI clicks) */
  jumpToArrangementEntry(arrangementIndex: number): void {
    if (!this.song || !this.useArrangement) return;
    if (
      arrangementIndex < 0 ||
      arrangementIndex >= this.song.arrangement.length
    )
      return;

    const wasPlaying = this.state === "playing";
    this.stopScheduler();
    this.silenceAll();

    this.loadArrangementEntry(arrangementIndex);
    this.startTime = performance.now() / 1000;
    this.pausePosition = 0;

    if (wasPlaying) {
      this.state = "playing";
      this.scheduleLoop();
    } else {
      this.state = "stopped";
      this.callbacks.onStateChange?.("stopped");
      this.callbacks.onPositionChange?.(0);
    }
  }

  /**
   * Switch to a specific pattern (for non-arrangement mode).
   * Loads the pattern's tracks without resetting the entire engine.
   */
  setCurrentPattern(patternIndex: number): void {
    if (!this.song) return;
    if (patternIndex < 0 || patternIndex >= this.song.patterns.length) return;

    const wasPlaying = this.state === "playing";
    this.stopScheduler();
    this.silenceAll();

    const pattern = this.song.patterns[patternIndex];
    this.currentPatternIndex = patternIndex;
    this.currentEntryTotalTicks = pattern.totalTicks;

    // Load the pattern's tracks into the scheduler
    this.scheduledTracks = pattern.tracks.map((track) => ({
      events: track.events,
      nextEventIndex: 0,
      channel: track.channel,
    }));

    this.pausePosition = 0;
    this.callbacks.onPatternChange?.(patternIndex);
    this.callbacks.onPositionChange?.(0);

    console.log(
      `[Engine] Switched to pattern ${patternIndex + 1}: ` +
        `"${pattern.name}" (${pattern.tracks.length} tracks, ${pattern.totalTicks} ticks)`,
    );

    if (wasPlaying) {
      this.startTime = performance.now() / 1000;
      this.state = "playing";
      this.scheduleLoop();
    } else {
      this.state = "stopped";
      this.callbacks.onStateChange?.("stopped");
    }
  }

  /** Get current playback state */
  getState(): PlaybackState {
    return this.state;
  }

  /** Get current playback position in ticks */
  getCurrentTick(): number {
    if (this.state === "stopped") return this.pausePosition;
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

    // Check loop region first (piano roll loop)
    if (
      this.loopEnabled &&
      this.loopRegionStart >= 0 &&
      this.loopRegionEnd > this.loopRegionStart &&
      currentTick >= this.loopRegionEnd
    ) {
      this.silenceAll();
      const loopTick = this.loopRegionStart;
      this.startTime = performance.now() / 1000 - this.ticksToSeconds(loopTick);
      this.resetTrackStateFromTick(loopTick);
      this.schedulerTimer = setTimeout(this.scheduleLoop, this.LOOKAHEAD_MS);
      return;
    }

    // Check if current entry/pattern is finished
    if (currentTick >= this.currentEntryTotalTicks) {
      if (this.advanceToNextEntry()) {
        // Successfully moved to next entry — continue playing
        return;
      }
      // No more entries — stop
      this.stop();
      return;
    }

    for (let i = 0; i < this.scheduledTracks.length; i++) {
      const track = this.scheduledTracks[i];

      while (track.nextEventIndex < track.events.length) {
        const event = track.events[track.nextEventIndex];
        if (event.tick > scheduleUntilTick) break;

        // Also skip events beyond the entry's duration
        if (event.tick >= this.currentEntryTotalTicks) break;

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
   * Load an arrangement entry's pattern data for playback.
   * Sets up tracks and calculates the entry's duration in ticks.
   */
  private loadArrangementEntry(arrangementIndex: number): void {
    if (!this.song) return;

    const arrangement = this.song.arrangement;
    if (arrangementIndex < 0 || arrangementIndex >= arrangement.length) return;

    const entry: ArrangementEntry = arrangement[arrangementIndex];
    const pattern = this.song.patterns[entry.patternIndex];

    if (!pattern) {
      console.warn(
        `[Engine] Arrangement entry ${arrangementIndex} references missing pattern ${entry.patternIndex}`,
      );
      return;
    }

    this.currentArrangementIndex = arrangementIndex;
    this.currentPatternIndex = entry.patternIndex;

    // Calculate this entry's duration in ticks based on its bar length
    const ticksPerMeasure = this.song.ticksPerMeasure || 768;
    const entryDurationTicks = entry.length * ticksPerMeasure;

    // Use the shorter of: entry duration or actual pattern data length
    // This ensures we don't play beyond the arrangement entry's bars,
    // but also don't wait forever if the pattern data is shorter
    this.currentEntryTotalTicks = Math.min(
      entryDurationTicks,
      pattern.totalTicks || entryDurationTicks,
    );

    // Load the pattern's tracks into the scheduler
    this.scheduledTracks = pattern.tracks.map((track) => ({
      events: track.events,
      nextEventIndex: 0,
      channel: track.channel,
    }));

    console.log(
      `[Engine] Loaded arrangement entry ${arrangementIndex + 1}/${arrangement.length}: ` +
        `pattern "${pattern.name}" (idx=${entry.patternIndex}), ` +
        `bars ${entry.bar}–${entry.bar + entry.length - 1}, ` +
        `${this.currentEntryTotalTicks} ticks`,
    );

    // Notify UI
    this.callbacks.onPatternChange?.(entry.patternIndex);
    this.callbacks.onArrangementChange?.(arrangementIndex, entry.patternIndex);
  }

  /**
   * Advance to the next arrangement entry (or next pattern in fallback mode).
   * Returns true if a next entry was found and loaded.
   */
  private advanceToNextEntry(): boolean {
    if (!this.song) return false;

    if (this.useArrangement) {
      // ── Arrangement mode ──────────────────────────────────────────
      let nextIndex = this.currentArrangementIndex + 1;

      if (nextIndex >= this.song.arrangement.length) {
        if (this.loopEnabled) {
          nextIndex = 0; // Loop back to first arrangement entry
        } else {
          return false;
        }
      }

      // Silence current notes before switching
      this.silenceAll();

      // Load the next entry
      this.loadArrangementEntry(nextIndex);

      // Reset timing for the new entry
      this.startTime = performance.now() / 1000;
      this.pausePosition = 0;

      this.callbacks.onPositionChange?.(0);

      // Continue the scheduler loop
      this.schedulerTimer = setTimeout(this.scheduleLoop, this.LOOKAHEAD_MS);
      return true;
    } else {
      // ── Fallback: linear pattern walk ─────────────────────────────
      let nextIndex = this.currentPatternIndex + 1;

      if (nextIndex >= this.song.patterns.length) {
        if (this.loopEnabled) {
          nextIndex = 0;
        } else {
          return false;
        }
      }

      const nextPattern = this.song.patterns[nextIndex];
      if (!nextPattern || nextPattern.tracks.length === 0) {
        return false;
      }

      // Silence current notes before switching
      this.silenceAll();

      // Update current pattern
      this.currentPatternIndex = nextIndex;
      this.currentEntryTotalTicks = nextPattern.totalTicks;

      // Load the pattern's tracks
      this.scheduledTracks = nextPattern.tracks.map((track) => ({
        events: track.events,
        nextEventIndex: 0,
        channel: track.channel,
      }));

      // Reset timing
      this.startTime = performance.now() / 1000;
      this.pausePosition = 0;

      // Notify UI
      this.callbacks.onPatternChange?.(nextIndex);
      this.callbacks.onPositionChange?.(0);

      console.log(
        `[Engine] Advanced to pattern ${nextIndex + 1} ` +
          `(${nextPattern.tracks.length} tracks, ${nextPattern.totalTicks} ticks)`,
      );

      // Continue the scheduler loop
      this.schedulerTimer = setTimeout(this.scheduleLoop, this.LOOKAHEAD_MS);
      return true;
    }
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
            this.midiOutput.send([
              0xc0 | (channel & 0x0f),
              event.program & 0x7f,
            ]);
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

  /** Reset track scheduling state — uses the current pattern's tracks */
  private resetTrackState(): void {
    if (!this.song) {
      this.scheduledTracks = [];
      return;
    }

    // Use current pattern tracks if available, otherwise fall back to song.tracks
    const pattern = this.song.patterns[this.currentPatternIndex];
    const tracks = pattern ? pattern.tracks : this.song.tracks;

    this.scheduledTracks = tracks.map((track) => ({
      events: track.events,
      nextEventIndex: 0,
      channel: track.channel,
    }));
  }

  /** Reset track scheduling state starting from a specific tick */
  private resetTrackStateFromTick(tick: number): void {
    for (const track of this.scheduledTracks) {
      // Binary search for the first event at or after the given tick
      let lo = 0;
      let hi = track.events.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (track.events[mid].tick < tick) lo = mid + 1;
        else hi = mid;
      }
      track.nextEventIndex = lo;
    }
  }

  /** Clean up all resources */
  destroy(): void {
    this.stop();
    this.synth.destroy();
  }
}
