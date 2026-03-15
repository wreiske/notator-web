"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { TransportBar } from "@/components/transport/TransportBar";
import { TrackList } from "@/components/tracks/TrackList";
import { parseSonFile } from "@/lib/son-parser";
import type { SonFile, SongData, Track } from "@/lib/son-parser/types";
import { PlaybackEngine } from "@/lib/playback/engine";
import type { PlaybackState } from "@/lib/playback/engine";

/** Demo .SON files bundled from the /st directory */
const DEMO_FILES = [
  { name: "EXAMPLE.SON", path: "/demos/EXAMPLE.SON", desc: "Tutorial" },
  { name: "DRUMMAP.SON", path: "/demos/DRUMMAP.SON", desc: "Drum map" },
  { name: "POLYPHON.SON", path: "/demos/POLYPHON.SON", desc: "Polyphonic" },
  { name: "N_TUPLET.SON", path: "/demos/N_TUPLET.SON", desc: "N-tuplet" },
];

/** Map MIDI note number to name */
function midiNoteName(note: number): string {
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`;
}

export default function PlayerPage() {
  // Song state (sonFile preserved for future write-back/export)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [sonFile, setSonFile] = useState<SonFile | null>(null);
  const [song, setSong] = useState<SongData | null>(null);
  const [songName, setSongName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Playback state
  const [playbackState, setPlaybackState] = useState<PlaybackState>("stopped");
  const [currentTick, setCurrentTick] = useState(0);
  const [tempo, setTempo] = useState(120);

  // Track state
  const [mutedTracks, setMutedTracks] = useState<Set<number>>(new Set());
  const [soloedTracks, setSoloedTracks] = useState<Set<number>>(new Set());
  const [activeTrackIndices, setActiveTrackIndices] = useState<Set<number>>(new Set());
  const [activePatternIndex, setActivePatternIndex] = useState(0);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(0);

  // Engine ref
  const engineRef = useRef<PlaybackEngine | null>(null);

  // Initialize engine
  useEffect(() => {
    const engine = new PlaybackEngine();
    engine.setCallbacks({
      onStateChange: setPlaybackState,
      onPositionChange: setCurrentTick,
      onTrackEvent: (trackIndex: number) => {
        setActiveTrackIndices((prev) => {
          const next = new Set(prev);
          next.add(trackIndex);
          setTimeout(() => {
            setActiveTrackIndices((p) => {
              const n = new Set(p);
              n.delete(trackIndex);
              return n;
            });
          }, 100);
          return next;
        });
      },
      onPatternChange: (patternIndex: number) => {
        setActivePatternIndex(patternIndex);
        setSelectedTrackIndex(0);
        setActiveTrackIndices(new Set());
        // Update the displayed song to show the new pattern's tracks
        setSong((prev) => {
          if (!prev || patternIndex >= prev.patterns.length) return prev;
          const pattern = prev.patterns[patternIndex];
          return {
            ...prev,
            tracks: pattern.tracks,
            totalTicks: pattern.totalTicks,
            activePatternIndex: patternIndex,
          };
        });
      },
    });
    engineRef.current = engine;
    return () => engine.destroy();
  }, []);

  // Load a .SON file
  const handleFileLoad = useCallback(
    (buffer: ArrayBuffer, fileName: string) => {
      try {
        setError(null);
        const parsed = parseSonFile(buffer);
        setSonFile(parsed);
        setSong(parsed.songData);
        setSongName(fileName.replace(/\.son$/i, ""));
        setMutedTracks(new Set());
        setSoloedTracks(new Set());
        setActiveTrackIndices(new Set());
        setActivePatternIndex(0);
        setSelectedTrackIndex(0);

        if (engineRef.current) {
          engineRef.current.loadSong(parsed.songData);
          engineRef.current.setTempo(parsed.songData.tempo);
        }
        setTempo(parsed.songData.tempo);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse .SON file");
        setSong(null);
      }
    },
    []
  );

  // Load a demo file
  const handleDemoLoad = useCallback(
    async (path: string, name: string) => {
      try {
        setError(null);
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Failed to fetch demo file: ${name}`);
        const buffer = await response.arrayBuffer();
        handleFileLoad(buffer, name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load demo file");
      }
    },
    [handleFileLoad]
  );

  // Transport controls
  const handlePlay = useCallback(() => engineRef.current?.play(), []);
  const handlePause = useCallback(() => engineRef.current?.pause(), []);
  const handleStop = useCallback(() => engineRef.current?.stop(), []);
  const handleTempoChange = useCallback((bpm: number) => {
    setTempo(bpm);
    engineRef.current?.setTempo(bpm);
  }, []);

  // Switch active pattern
  const handlePatternChange = useCallback(
    (patternIndex: number) => {
      if (!song || patternIndex < 0 || patternIndex >= song.patterns.length) return;
      const pattern = song.patterns[patternIndex];

      engineRef.current?.stop();

      const patternSong: SongData = {
        ...song,
        tracks: pattern.tracks,
        totalTicks: pattern.totalTicks,
        activePatternIndex: patternIndex,
      };

      setSong(patternSong);
      setActivePatternIndex(patternIndex);
      setSelectedTrackIndex(0);
      setMutedTracks(new Set());
      setSoloedTracks(new Set());
      setActiveTrackIndices(new Set());

      if (engineRef.current) {
        engineRef.current.loadSong(patternSong);
        engineRef.current.setTempo(tempo);
      }
    },
    [song, tempo]
  );

  // Track controls
  const handleToggleMute = useCallback(
    (index: number) => {
      engineRef.current?.toggleMute(index);
      setMutedTracks((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    },
    []
  );

  const handleToggleSolo = useCallback(
    (index: number) => {
      engineRef.current?.toggleSolo(index);
      setSoloedTracks((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    },
    []
  );

  // Get selected track info
  const selectedTrack: Track | null = song?.tracks[selectedTrackIndex] ?? null;
  const noteOns = selectedTrack?.events.filter(e => e.type === "note_on") ?? [];
  const noteOffs = selectedTrack?.events.filter(e => e.type === "note_off") ?? [];
  const notes = noteOns.map(e => (e as { note: number }).note);
  const minNote = notes.length ? Math.min(...notes) : 0;
  const maxNote = notes.length ? Math.max(...notes) : 0;

  // ═══════════════════════════════════════════════════════════════
  // Loading state — show file upload
  // ═══════════════════════════════════════════════════════════════
  if (!song) {
    return (
      <div className="flex min-h-screen flex-col bg-notator-bg-deep">
        <TransportBar
          state={playbackState}
          currentTick={0}
          totalTicks={0}
          tempo={tempo}
          songName=""
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={handleStop}
          onTempoChange={handleTempoChange}
        />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          <div className="space-y-8">
            <div>
              <h1 className="mb-2 text-2xl font-bold text-notator-text">Load a Song</h1>
              <p className="mb-6 text-notator-text-muted">
                Open a Notator SL / Creator .SON file to begin playback
              </p>
              <FileDropZone onFileLoad={handleFileLoad} />
            </div>
            <div>
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-notator-text-dim">
                Or try a demo
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {DEMO_FILES.map(({ name, path, desc }) => (
                  <button
                    key={name}
                    onClick={() => handleDemoLoad(path, name)}
                    className="group rounded-lg border border-notator-border bg-notator-surface p-4 text-left transition-all hover:border-notator-accent/50 hover:bg-notator-surface-hover"
                    id={`demo-${name.replace(/\./g, "-")}`}
                  >
                    <div className="mb-1 text-sm font-medium text-notator-text group-hover:text-notator-accent">
                      {name}
                    </div>
                    <div className="text-xs text-notator-text-dim">{desc}</div>
                  </button>
                ))}
              </div>
            </div>
            {error && (
              <div className="rounded-lg border border-notator-red/30 bg-notator-red/10 p-4 text-sm text-notator-red">
                {error}
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Main 3-panel layout (like the original Notator SL)
  //
  //  ┌─────────────┬────────────────────────┬──────────────┐
  //  │  ARRANGE    │  16-TRACK GRID         │  TRACK INFO  │
  //  │  (patterns) │  (name, status, ch)    │  (details)   │
  //  └─────────────┴────────────────────────┴──────────────┘
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="flex min-h-screen flex-col bg-notator-bg-deep">
      {/* Transport Bar (top) */}
      <TransportBar
        state={playbackState}
        currentTick={currentTick}
        totalTicks={song.totalTicks}
        tempo={tempo}
        songName={songName}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onTempoChange={handleTempoChange}
      />

      {/* 3-Panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─── LEFT PANEL: ARRANGE (Pattern List) ─── */}
        <aside className="flex w-52 flex-shrink-0 flex-col border-r border-notator-border-bright bg-notator-panel">
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-notator-border px-3 py-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-notator-text-dim">
              Arrange
            </span>
            <button
              onClick={() => {
                engineRef.current?.stop();
                setSong(null);
                setSongName("");
              }}
              className="text-[10px] text-notator-text-dim hover:text-notator-accent"
              id="load-another-btn"
            >
              ✕
            </button>
          </div>

          {/* Pattern list */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full font-mono text-[11px]">
              <tbody>
                {song.patterns.map((pat, idx) => (
                  <tr
                    key={idx}
                    onClick={() => handlePatternChange(idx)}
                    className={`cursor-pointer transition-colors ${
                      idx === activePatternIndex
                        ? "bg-notator-highlight text-white"
                        : "text-notator-text hover:bg-notator-surface-hover"
                    }`}
                    id={`pattern-row-${idx}`}
                  >
                    <td className="w-8 px-2 py-1.5 text-right text-notator-text-muted">
                      {pat.index + 1}
                    </td>
                    <td className="px-2 py-1.5 font-bold">
                      {pat.name}
                    </td>
                    <td className="px-2 py-1.5 text-right text-notator-text-dim">
                      {pat.tracks.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bottom info */}
          <div className="border-t border-notator-border px-3 py-2 text-[10px] text-notator-text-dim">
            <div className="flex justify-between">
              <span>Patterns</span>
              <span className="text-notator-text-muted">{song.patterns.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Bars</span>
              <span className="text-notator-text-muted">
                {Math.ceil(song.totalTicks / song.ticksPerMeasure)}
              </span>
            </div>
          </div>
        </aside>

        {/* ─── CENTER PANEL: TRACK GRID ─── */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Status bar */}
          <div className="flex items-center gap-3 border-b border-notator-border bg-notator-surface px-3 py-1 text-[10px]">
            <span className="font-bold uppercase tracking-widest text-notator-text-dim">
              Status
            </span>
            <span className="font-bold text-notator-text">
              {songName}
            </span>
            <span className="text-notator-text-dim">
              {song.tracks.length} tracks
            </span>
            <span className="text-notator-text-dim">·</span>
            <span className="text-notator-accent">
              Pattern {activePatternIndex + 1}
            </span>
          </div>

          {/* Track grid */}
          <div className="flex-1 overflow-y-auto p-2">
            <TrackList
              tracks={song.tracks}
              mutedTracks={mutedTracks}
              soloedTracks={soloedTracks}
              activeTrackIndices={activeTrackIndices}
              selectedTrackIndex={selectedTrackIndex}
              onToggleMute={handleToggleMute}
              onToggleSolo={handleToggleSolo}
              onSelectTrack={setSelectedTrackIndex}
            />
          </div>
        </main>

        {/* ─── RIGHT PANEL: TRACK INFO ─── */}
        <aside className="flex w-48 flex-shrink-0 flex-col border-l border-notator-border-bright bg-notator-panel">
          {/* Panel header */}
          <div className="border-b border-notator-border px-3 py-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-notator-text-dim">
              Track: {selectedTrackIndex + 1}
            </span>
          </div>

          {/* Track details */}
          <div className="flex-1 overflow-y-auto">
            {selectedTrack ? (
              <div className="space-y-0 text-[11px]">
                {/* Track properties — styled like the original's right panel */}
                {[
                  { label: "NAME", value: selectedTrack.name || "---" },
                  { label: "CHANNEL", value: `${String.fromCharCode(65 + Math.floor(selectedTrack.channel / 16))} ${(selectedTrack.channel % 16) + 1}` },
                  { label: "QUANTIZE", value: String(song.ticksPerMeasure) },
                  { label: "NOTES", value: String(noteOns.length) },
                  { label: "RANGE", value: notes.length > 0 ? `${midiNoteName(minNote)}-${midiNoteName(maxNote)}` : "---" },
                  { label: "VELOCITY", value: notes.length > 0 ? `${Math.min(...noteOns.map(e => (e as { velocity: number }).velocity))}-${Math.max(...noteOns.map(e => (e as { velocity: number }).velocity))}` : "---" },
                  { label: "EVENTS", value: String(selectedTrack.events.length) },
                  { label: "NOTE ON", value: String(noteOns.length) },
                  { label: "NOTE OFF", value: String(noteOffs.length) },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between border-b border-notator-border/30 px-3 py-1.5"
                  >
                    <span className="text-notator-text-dim">{label}</span>
                    <span className="font-bold tabular-nums text-notator-text">{value}</span>
                  </div>
                ))}

                {/* Mute / Solo controls */}
                <div className="border-t border-notator-border px-3 py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggleMute(selectedTrackIndex)}
                      className={`notator-btn flex-1 rounded px-2 py-1.5 text-[10px] ${
                        mutedTracks.has(selectedTrackIndex)
                          ? "border-notator-red bg-notator-red/20 text-notator-red"
                          : "border-notator-border text-notator-text-dim hover:text-notator-text"
                      }`}
                      id="detail-mute"
                    >
                      MUTE
                    </button>
                    <button
                      onClick={() => handleToggleSolo(selectedTrackIndex)}
                      className={`notator-btn flex-1 rounded px-2 py-1.5 text-[10px] ${
                        soloedTracks.has(selectedTrackIndex)
                          ? "border-notator-amber bg-notator-amber/20 text-notator-amber"
                          : "border-notator-border text-notator-text-dim hover:text-notator-text"
                      }`}
                      id="detail-solo"
                    >
                      SOLO
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 text-[11px] text-notator-text-dim">
                No track selected
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Error */}
      {error && (
        <div className="border-t border-notator-red/30 bg-notator-red/10 px-4 py-2 text-sm text-notator-red">
          {error}
        </div>
      )}
    </div>
  );
}
