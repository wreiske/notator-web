"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  Suspense,
  type ChangeEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { TransportBar } from "@/components/transport/TransportBar";
import { MemoizedTrackList as TrackList } from "@/components/tracks/TrackList";
import { TrackContextMenu } from "@/components/tracks/TrackContextMenu";
import { PianoRollEditor } from "@/components/tracks/PianoRollEditor";
import { NotationTimeline } from "@/components/tracks/NotationTimeline";
import { parseSonFileWasm } from "@/lib/son-parser/wasm-adapter";
import type {
  SonFile,
  SongData,
  Track,
  TrackEvent as SonTrackEvent,
} from "@/lib/son-parser/types";
import { PlaybackEngine } from "@/lib/playback/engine";
import type { PlaybackState } from "@/lib/playback/engine";
import {
  exportSongToMidi,
  exportTrackToMidi,
  downloadMidi,
} from "@/lib/midi/midi-file-export";
import { useAuth } from "@/lib/auth/AuthContext";
import { LoginModal } from "@/components/auth/LoginModal";
import { UserMenu } from "@/components/auth/UserMenu";
import { PublishModal } from "@/components/songs/PublishModal";
import { downloadUserFile } from "@/lib/auth/api";

/** Demo .SON files bundled from the /st directory */
const DEMO_FILES = [
  { name: "ALEXA'S.SON", path: "/demos/ALEXA'S.SON", desc: "Alexa's song" },
  { name: "AUTOLOAD.SON", path: "/demos/AUTOLOAD.SON", desc: "Autoload" },
  { name: "EXAMPLE.SON", path: "/demos/EXAMPLE.SON", desc: "Tutorial" },
  { name: "DRUMMAP.SON", path: "/demos/DRUMMAP.SON", desc: "Drum map" },
  { name: "POLYPHON.SON", path: "/demos/POLYPHON.SON", desc: "Polyphonic" },
  { name: "N_TUPLET.SON", path: "/demos/N_TUPLET.SON", desc: "N-tuplet" },
];

/** Map MIDI note number to name */
function midiNoteName(note: number): string {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`;
}

function PlayerContent() {
  const { isAuthenticated } = useAuth();
  const searchParams = useSearchParams();

  // Song state (sonFile preserved for future write-back/export)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [sonFile, setSonFile] = useState<SonFile | null>(null);
  const [song, setSong] = useState<SongData | null>(null);
  const [songName, setSongName] = useState("");
  const [songBuffer, setSongBuffer] = useState<ArrayBuffer | null>(null);
  const [songFileName, setSongFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  // Auth / Community UI state
  const [showLogin, setShowLogin] = useState(false);
  const [showPublish, setShowPublish] = useState(false);

  // Playback state
  const [playbackState, setPlaybackState] = useState<PlaybackState>("stopped");
  const [currentTick, setCurrentTick] = useState(0);
  const [tempo, setTempo] = useState(120);

  // Track state
  const [mutedTracks, setMutedTracks] = useState<Set<number>>(new Set());
  const [soloedTracks, setSoloedTracks] = useState<Set<number>>(new Set());
  const [activeTrackIndices, setActiveTrackIndices] = useState<Set<number>>(
    new Set(),
  );

  // ── Performance: high-frequency refs (avoid React re-renders) ──
  // The engine fires onPositionChange every 25ms. Instead of calling
  // setState each time (which re-renders the entire 1300-line component),
  // we write to refs and update React state at a throttled rate.
  const tickRef = useRef(0);
  const activeTracksRef = useRef<Set<number>>(new Set());
  const activeTrackTimers = useRef<Map<number, number>>(new Map());
  const rafIdRef = useRef(0);
  const lastDisplayUpdateRef = useRef(0);
  const [activePatternIndex, setActivePatternIndex] = useState(0);
  const [currentArrangementIndex, setCurrentArrangementIndex] = useState(0);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);

  // Mobile panel navigation
  const [activePanel, setActivePanel] = useState<"arrange" | "tracks" | "info">(
    "tracks",
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    trackIndex: number;
  } | null>(null);
  const [trackClipboard, setTrackClipboard] = useState<Track | null>(null);

  // Piano roll editor state
  const [editingTrackIndex, setEditingTrackIndex] = useState<number | null>(
    null,
  );
  const [editorPlaybackState, setEditorPlaybackState] = useState<
    "stopped" | "playing" | "paused"
  >("stopped");
  const editorTickRef = useRef(0);
  const [editorCurrentTick, setEditorCurrentTick] = useState(0);
  const [editorLoopEnabled, setEditorLoopEnabled] = useState(false);
  const [editorLoopStart, setEditorLoopStart] = useState(-1);
  const [editorLoopEnd, setEditorLoopEnd] = useState(-1);
  const [editorSoloed, setEditorSoloed] = useState(false);

  // Refs
  const engineRef = useRef<PlaybackEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── rAF display loop: reads refs and updates React state at ~15fps ──
  useEffect(() => {
    let running = true;
    const DISPLAY_INTERVAL_MS = 66; // ~15fps for transport text

    const displayLoop = () => {
      if (!running) return;
      const now = performance.now();
      if (now - lastDisplayUpdateRef.current >= DISPLAY_INTERVAL_MS) {
        lastDisplayUpdateRef.current = now;
        const t = tickRef.current;
        setCurrentTick(t);
        setEditorCurrentTick(t);

        // Sync active track indices to React state for TrackList highlighting
        setActiveTrackIndices((prev) => {
          // Only update if the set actually changed
          const ref = activeTracksRef.current;
          if (prev.size === ref.size && [...prev].every((v) => ref.has(v))) {
            return prev; // same — skip re-render
          }
          return new Set(ref);
        });
      }
      rafIdRef.current = requestAnimationFrame(displayLoop);
    };
    rafIdRef.current = requestAnimationFrame(displayLoop);

    return () => {
      running = false;
      cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // Initialize engine
  useEffect(() => {
    const engine = new PlaybackEngine();
    engine.setCallbacks({
      onStateChange: (state: PlaybackState) => {
        setPlaybackState(state);
        // Keep editor state in sync
        if (state === "stopped") setEditorPlaybackState("stopped");
        else if (state === "playing") setEditorPlaybackState("playing");
        else if (state === "paused") setEditorPlaybackState("paused");
      },
      onPositionChange: (tick: number) => {
        // HOT PATH — write to ref only, NO React setState here.
        // The rAF display loop reads this ref at ~15fps.
        tickRef.current = tick;
        editorTickRef.current = tick;
      },
      onTrackEvent: (trackIndex: number) => {
        // HOT PATH — mutate ref in-place, no React setState.
        // Direct DOM update for track row highlighting.
        activeTracksRef.current.add(trackIndex);

        // Schedule removal after 100ms via lightweight timer
        const prev = activeTrackTimers.current.get(trackIndex);
        if (prev) clearTimeout(prev);
        activeTrackTimers.current.set(
          trackIndex,
          window.setTimeout(() => {
            activeTracksRef.current.delete(trackIndex);
            activeTrackTimers.current.delete(trackIndex);
          }, 100),
        );
      },
      onPatternChange: (patternIndex: number) => {
        setActivePatternIndex(patternIndex);
        setSelectedTrackIndex(0);
        activeTracksRef.current.clear();
        setActiveTrackIndices(new Set());
        // Update the displayed song to show the new pattern's tracks
        setSong((prev) => {
          if (!prev) return prev;
          const pattern = prev.patterns.find((p) => p.index === patternIndex);
          if (!pattern) return prev;
          return {
            ...prev,
            tracks: pattern.tracks,
            totalTicks: pattern.totalTicks,
            activePatternIndex: patternIndex,
          };
        });
      },
      onArrangementChange: (arrangementIndex: number, patternIndex: number) => {
        setCurrentArrangementIndex(arrangementIndex);
        setActivePatternIndex(patternIndex);
      },
    });
    engineRef.current = engine;
    // Capture ref value before cleanup (React hooks lint rule)
    const timers = activeTrackTimers.current;
    return () => {
      engine.destroy();
      // Clear all active track timers
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Global keyboard shortcuts (spacebar play/pause, etc.)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if piano roll editor is open (it has its own handler)
      if (editingTrackIndex !== null) return;
      // Don't intercept if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        const engine = engineRef.current;
        if (!engine) return;
        const state = engine.getState();
        if (state === "playing") {
          engine.pause();
        } else {
          engine.play();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingTrackIndex]);

  // Load a .SON file
  const handleFileLoad = useCallback(
    async (buffer: ArrayBuffer, fileName: string) => {
      try {
        setError(null);
        const parsed = await parseSonFileWasm(buffer);
        setSonFile(parsed);
        setSong(parsed.songData);
        setSongName(fileName.replace(/\.son$/i, ""));
        setSongBuffer(buffer.slice(0)); // Store a copy for publishing
        setSongFileName(fileName);
        setMutedTracks(new Set());
        setSoloedTracks(new Set());
        setActiveTrackIndices(new Set());
        setActivePatternIndex(0);
        setCurrentArrangementIndex(0);
        setSelectedTrackIndex(0);

        if (engineRef.current) {
          engineRef.current.loadSong(parsed.songData);
          engineRef.current.setTempo(parsed.songData.tempo);
        }
        setTempo(parsed.songData.tempo);

        // Apply loop setting from SON file header
        const fileLoop = parsed.songData.headerConfig.loopEnabled;
        setLoopEnabled(fileLoop);
        engineRef.current?.setLoop(fileLoop);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to parse .SON file",
        );
        setSong(null);
      }
    },
    [],
  );

  // ── Auto-load file from query params ──
  useEffect(() => {
    const fileId = searchParams.get("file");
    const source = searchParams.get("source");

    if (fileId && !song && !loadingFile) {
      // Load user's file by ID
      setLoadingFile(true);
      downloadUserFile(fileId)
        .then(({ buffer, filename }) => {
          handleFileLoad(buffer, filename);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to load file");
        })
        .finally(() => setLoadingFile(false));
    } else if (source === "shared" && !song && !loadingFile) {
      // Load shared file from sessionStorage
      const base64 = sessionStorage.getItem("notator_shared_file");
      const filename =
        sessionStorage.getItem("notator_shared_filename") || "Shared.SON";
      if (base64) {
        try {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          handleFileLoad(bytes.buffer, filename);
          sessionStorage.removeItem("notator_shared_file");
          sessionStorage.removeItem("notator_shared_filename");
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to load shared file",
          );
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
        setError(
          err instanceof Error ? err.message : "Failed to load demo file",
        );
      }
    },
    [handleFileLoad],
  );

  // File menu: trigger hidden file input (or native dialog in Electron)
  const handleLoadFileClick = useCallback(() => {
    // Use native Electron file dialog when available
    if (window.electronAPI?.isElectron) {
      window.electronAPI.openFileDialog().then((result) => {
        if (result) {
          handleFileLoad(result.buffer, result.filename);
        }
      });
      return;
    }
    fileInputRef.current?.click();
  }, [handleFileLoad]);

  // File menu: handle selected file
  const handleFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          handleFileLoad(reader.result, file.name);
        }
      };
      reader.readAsArrayBuffer(file);
      // Reset so the same file can be re-selected
      e.target.value = "";
    },
    [handleFileLoad],
  );

  // Transport controls
  const handlePlay = useCallback(() => engineRef.current?.play(), []);
  const handlePause = useCallback(() => engineRef.current?.pause(), []);
  const handleStop = useCallback(() => engineRef.current?.stop(), []);
  const handleSeek = useCallback((tick: number) => {
    engineRef.current?.seekTo(tick);
    tickRef.current = tick;
  }, []);
  const handleTempoChange = useCallback((bpm: number) => {
    setTempo(bpm);
    engineRef.current?.setTempo(bpm);
  }, []);

  // Toggle loop mode
  const handleToggleLoop = useCallback(() => {
    setLoopEnabled((prev) => {
      const next = !prev;
      engineRef.current?.setLoop(next);
      return next;
    });
  }, []);

  // Export as MIDI
  const handleExportMidi = useCallback(() => {
    if (!song) return;
    const midiData = exportSongToMidi(song, songName || undefined);
    const filename = (songName || "export").replace(/\s+/g, "_") + ".mid";
    downloadMidi(midiData, filename);
  }, [song, songName]);

  // Switch active pattern (from pattern list fallback)
  const handlePatternChange = useCallback(
    (patternIndex: number) => {
      if (!song || patternIndex < 0 || patternIndex >= song.patterns.length)
        return;

      // Use the engine's setCurrentPattern to properly switch without full stop/reload
      engineRef.current?.setCurrentPattern(patternIndex);

      // Update UI state
      const pattern = song.patterns[patternIndex];
      setSong((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tracks: pattern.tracks,
          totalTicks: pattern.totalTicks,
          activePatternIndex: patternIndex,
        };
      });
      setActivePatternIndex(patternIndex);
      setSelectedTrackIndex(0);
      setMutedTracks(new Set());
      setSoloedTracks(new Set());
      setActiveTrackIndices(new Set());
    },
    [song],
  );

  // Jump to a specific arrangement entry
  const handleArrangementJump = useCallback((arrangementIndex: number) => {
    if (!engineRef.current) return;
    engineRef.current.jumpToArrangementEntry(arrangementIndex);
  }, []);

  // Track controls
  const handleToggleMute = useCallback((index: number) => {
    engineRef.current?.toggleMute(index);
    setMutedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const handleToggleSolo = useCallback((index: number) => {
    engineRef.current?.toggleSolo(index);
    setSoloedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // Context menu trigger
  const handleTrackContextMenu = useCallback(
    (trackIndex: number, x: number, y: number) => {
      setContextMenu({ x, y, trackIndex });
    },
    [],
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Open piano roll editor
  const handleOpenEditor = useCallback((trackIndex: number) => {
    setContextMenu(null);
    setEditingTrackIndex(trackIndex);
  }, []);

  // Save edited track from piano roll
  const handleSaveEditor = useCallback(
    (trackIndex: number, events: SonTrackEvent[]) => {
      setSong((prev) => {
        if (!prev) return prev;
        const newTracks = [...prev.tracks];
        newTracks[trackIndex] = { ...newTracks[trackIndex], events };
        return { ...prev, tracks: newTracks };
      });
      setEditingTrackIndex(null);
    },
    [],
  );

  const handleCloseEditor = useCallback(() => {
    // Stop any editor playback
    const engine = engineRef.current;
    if (engine && editorPlaybackState !== "stopped") {
      engine.stop();
      engine.setLoopRegion(-1, -1);
    }
    setEditorPlaybackState("stopped");
    setEditorCurrentTick(0);
    setEditorLoopEnabled(false);
    setEditorLoopStart(-1);
    setEditorLoopEnd(-1);
    // Un-solo the track if it was soloed
    if (editorSoloed && editingTrackIndex !== null) {
      engineRef.current?.toggleSolo(editingTrackIndex);
    }
    setEditorSoloed(false);
    setEditingTrackIndex(null);
  }, [editorPlaybackState, editorSoloed, editingTrackIndex]);

  // Editor note preview (supports chord: multiple notes at once)
  const activePreviewsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const handlePreviewNote = useCallback(
    (note: number, velocity: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const synth = engine.getSynth();
      engine.initSynth().then(() => {
        const channel = song?.tracks[editingTrackIndex ?? 0]?.channel ?? 0;

        // If this note is already previewing, stop it first
        const existingTimer = activePreviewsRef.current.get(note);
        if (existingTimer) {
          clearTimeout(existingTimer);
          synth.noteOff(channel, note);
        }

        synth.noteOn(channel, note, velocity);

        // Auto-stop after 250ms
        const timer = setTimeout(() => {
          synth.noteOff(channel, note);
          activePreviewsRef.current.delete(note);
        }, 250);
        activePreviewsRef.current.set(note, timer);
      });
    },
    [song, editingTrackIndex],
  );

  // Editor playback controls
  const handleEditorPlay = useCallback(() => {
    engineRef.current?.play();
    setEditorPlaybackState("playing");
  }, []);

  const handleEditorPause = useCallback(() => {
    engineRef.current?.pause();
    setEditorPlaybackState("paused");
  }, []);

  const handleEditorStop = useCallback(() => {
    engineRef.current?.stop();
    setEditorPlaybackState("stopped");
    setEditorCurrentTick(0);
  }, []);

  const handleEditorSeek = useCallback((tick: number) => {
    engineRef.current?.seekTo(tick);
    // Set tickRef AFTER seekTo — seekTo clamps to pattern length via
    // onPositionChange, but the piano roll may display a wider range.
    // This prevents the rAF loop from snapping the cursor back.
    tickRef.current = tick;
    setEditorCurrentTick(tick);
  }, []);

  const handleEditorToggleLoop = useCallback(() => {
    setEditorLoopEnabled((prev) => {
      const next = !prev;
      engineRef.current?.setLoop(next);
      return next;
    });
  }, []);

  const handleEditorSetLoopRegion = useCallback(
    (start: number, end: number) => {
      setEditorLoopStart(start);
      setEditorLoopEnd(end);
      engineRef.current?.setLoopRegion(start, end);
    },
    [],
  );

  const handleEditorToggleSolo = useCallback(() => {
    if (editingTrackIndex === null) return;
    engineRef.current?.toggleSolo(editingTrackIndex);
    setEditorSoloed((prev) => !prev);
  }, [editingTrackIndex]);

  // Export single track as MIDI
  const handleExportTrackMidi = useCallback(
    (trackIndex: number) => {
      if (!song) return;
      const track = song.tracks[trackIndex];
      const trackLabel = track?.name || `Track ${trackIndex + 1}`;
      const midiData = exportTrackToMidi(
        song,
        trackIndex,
        songName || undefined,
      );
      const filename = `${(songName || "export").replace(/\s+/g, "_")}_${trackLabel.replace(/\s+/g, "_")}.mid`;
      downloadMidi(midiData, filename);
    },
    [song, songName],
  );

  // Copy track to clipboard
  const handleCopyTrack = useCallback(
    (trackIndex: number) => {
      if (!song) return;
      const track = song.tracks[trackIndex];
      if (track) setTrackClipboard({ ...track, events: [...track.events] });
    },
    [song],
  );

  // Paste clipboard track onto target
  const handlePasteTrack = useCallback(
    (trackIndex: number) => {
      if (!song || !trackClipboard) return;
      setSong((prev) => {
        if (!prev) return prev;
        const newTracks = [...prev.tracks];
        newTracks[trackIndex] = {
          ...trackClipboard,
          events: [...trackClipboard.events],
        };
        return { ...prev, tracks: newTracks };
      });
    },
    [song, trackClipboard],
  );

  // Delete track
  const handleDeleteTrack = useCallback(
    (trackIndex: number) => {
      if (!song || song.tracks.length <= 1) return;
      setSong((prev) => {
        if (!prev) return prev;
        const newTracks = prev.tracks.filter((_, i) => i !== trackIndex);
        return { ...prev, tracks: newTracks };
      });
      if (selectedTrackIndex >= song.tracks.length - 1) {
        setSelectedTrackIndex(Math.max(0, song.tracks.length - 2));
      }
    },
    [song, selectedTrackIndex],
  );

  // Cut track (copy + delete)
  const handleCutTrack = useCallback(
    (trackIndex: number) => {
      if (!song) return;
      const track = song.tracks[trackIndex];
      if (track) setTrackClipboard({ ...track, events: [...track.events] });
      handleDeleteTrack(trackIndex);
    },
    [song, handleDeleteTrack],
  );

  // Duplicate track (insert copy below with " 2" suffix)
  const handleDuplicateTrack = useCallback(
    (trackIndex: number) => {
      if (!song) return;
      const track = song.tracks[trackIndex];
      if (!track) return;

      // Determine suffix number
      const baseName = track.name || `Track ${trackIndex + 1}`;
      const match = baseName.match(/^(.+?)\s+(\d+)$/);
      let newName: string;
      if (match) {
        newName = `${match[1]} ${parseInt(match[2]) + 1}`;
      } else {
        newName = `${baseName} 2`;
      }

      const duplicate: Track = {
        ...track,
        name: newName,
        events: [...track.events],
      };

      setSong((prev) => {
        if (!prev) return prev;
        const newTracks = [...prev.tracks];
        newTracks.splice(trackIndex + 1, 0, duplicate);
        return { ...prev, tracks: newTracks };
      });
    },
    [song],
  );

  // Rename track (8 char max enforced by TrackList)
  const handleRenameTrack = useCallback(
    (trackIndex: number, newName: string) => {
      setSong((prev) => {
        if (!prev) return prev;
        const newTracks = [...prev.tracks];
        newTracks[trackIndex] = { ...newTracks[trackIndex], name: newName };
        return { ...prev, tracks: newTracks };
      });
    },
    [],
  );

  // Move track to another pattern
  const handleMoveToPattern = useCallback(
    (trackIndex: number, targetPatternIndex: number) => {
      if (!song) return;
      const track = song.tracks[trackIndex];
      if (!track) return;

      setSong((prev) => {
        if (!prev) return prev;
        // Remove from current tracks
        const newTracks = prev.tracks.filter((_, i) => i !== trackIndex);
        // Add to target pattern
        const newPatterns = prev.patterns.map((pat, i) => {
          if (i === targetPatternIndex) {
            return {
              ...pat,
              tracks: [...pat.tracks, { ...track, events: [...track.events] }],
            };
          }
          if (i === activePatternIndex) {
            return {
              ...pat,
              tracks: newTracks,
            };
          }
          return pat;
        });
        return {
          ...prev,
          tracks: newTracks,
          patterns: newPatterns,
        };
      });

      // Adjust selected track index if needed
      if (selectedTrackIndex >= song.tracks.length - 1) {
        setSelectedTrackIndex(Math.max(0, song.tracks.length - 2));
      }
    },
    [song, activePatternIndex, selectedTrackIndex],
  );

  // Get selected track info
  const selectedTrack: Track | null = song?.tracks[selectedTrackIndex] ?? null;
  const noteOns =
    selectedTrack?.events.filter((e) => e.type === "note_on") ?? [];
  const noteOffs =
    selectedTrack?.events.filter((e) => e.type === "note_off") ?? [];
  const notes = noteOns.map((e) => (e as { note: number }).note);
  const minNote = notes.length ? Math.min(...notes) : 0;
  const maxNote = notes.length ? Math.max(...notes) : 0;

  // ═══════════════════════════════════════════════════════════════
  // Loading file from query param
  // ═══════════════════════════════════════════════════════════════
  if (loadingFile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-notator-bg-deep">
        <div className="animate-pulse space-y-4 text-center">
          <span className="text-5xl">🎵</span>
          <p className="text-sm text-notator-text-muted">Loading song…</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Loading state — show file upload
  // ═══════════════════════════════════════════════════════════════
  if (!song) {
    return (
      <div className="flex min-h-screen flex-col bg-notator-bg-deep">
        {/* Hidden file input for File > Load menu item */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".son,.SON"
          className="hidden"
          onChange={handleFileInputChange}
        />
        <TransportBar
          state={playbackState}
          currentTick={0}
          totalTicks={0}
          tempo={tempo}
          songName=""
          ticksPerMeasure={768}
          loopEnabled={loopEnabled}
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={handleStop}
          onTempoChange={handleTempoChange}
          onToggleLoop={handleToggleLoop}
          onLoadFileClick={handleLoadFileClick}
          onDemoLoad={handleDemoLoad}
          onExportMidi={undefined}
        />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          <div className="space-y-8">
            <div>
              <h1 className="mb-2 text-2xl font-bold text-notator-text">
                Load a Song
              </h1>
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
      {/* Hidden file input for File > Load menu item */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".son,.SON"
        className="hidden"
        onChange={handleFileInputChange}
      />
      {/* Transport Bar (top) */}
      <TransportBar
        state={playbackState}
        currentTick={currentTick}
        totalTicks={song.totalTicks}
        tempo={tempo}
        songName={songName}
        ticksPerMeasure={song.ticksPerMeasure}
        loopEnabled={loopEnabled}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onTempoChange={handleTempoChange}
        onToggleLoop={handleToggleLoop}
        onLoadFileClick={handleLoadFileClick}
        onDemoLoad={handleDemoLoad}
        onExportMidi={handleExportMidi}
      />

      {/* Mobile panel tabs — visible only below sm */}
      <div className="flex border-b border-notator-border bg-notator-surface sm:hidden">
        {(
          [
            { key: "arrange", label: "📋 Arrange" },
            { key: "tracks", label: "🎵 Tracks" },
            { key: "info", label: "ℹ️ Info" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActivePanel(key)}
            className={`flex-1 px-3 py-2.5 text-xs font-bold transition-colors ${
              activePanel === key
                ? "border-b-2 border-notator-accent bg-notator-surface-active text-notator-accent"
                : "text-notator-text-dim hover:text-notator-text"
            }`}
            id={`panel-tab-${key}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 3-Panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─── LEFT PANEL: ARRANGE (Arrangement List) ─── */}
        <aside
          className={`flex w-full flex-shrink-0 flex-col border-r border-notator-border-bright bg-notator-panel sm:flex sm:w-72 ${
            activePanel === "arrange" ? "flex" : "hidden"
          }`}
        >
          {/* Panel header */}
          <div className="flex items-center justify-end border-b border-notator-border px-3 py-1.5">
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

          {/* Arrangement list */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full font-mono text-[11px]">
              <thead className="sticky top-0 bg-notator-panel text-[10px] font-bold uppercase tracking-widest text-notator-text-dim">
                <tr className="border-b border-notator-border">
                  <th className="w-8 px-2 py-1 text-right font-bold">Bar</th>
                  <th className="px-2 py-1 text-left font-bold">Arrange</th>
                  <th className="w-5 py-1 text-center font-bold">a</th>
                  <th className="w-5 py-1 text-center font-bold">b</th>
                  <th className="w-5 py-1 text-center font-bold">c</th>
                  <th className="w-5 py-1 text-center font-bold">d</th>
                </tr>
              </thead>
              <tbody>
                {song.arrangement.length > 0
                  ? song.arrangement.map((entry, idx) => (
                      <tr
                        key={idx}
                        onClick={() => handleArrangementJump(idx)}
                        className={`cursor-pointer transition-colors ${
                          idx === currentArrangementIndex
                            ? "bg-notator-highlight text-white"
                            : entry.patternIndex === activePatternIndex
                              ? "bg-notator-surface-active text-notator-accent"
                              : "text-notator-text hover:bg-notator-surface-hover"
                        }`}
                        id={`arrange-row-${idx}`}
                      >
                        <td className="w-8 px-2 py-2.5 text-right text-notator-text-muted sm:py-1.5">
                          {entry.bar}
                        </td>
                        <td className="px-2 py-2.5 font-bold sm:py-1.5">
                          {entry.name}
                        </td>
                        <td className="w-5 py-2.5 text-center text-notator-text-dim sm:py-1.5">
                          {entry.columns.a || ""}
                        </td>
                        <td className="w-5 py-2.5 text-center text-notator-text-dim sm:py-1.5">
                          {entry.columns.b || ""}
                        </td>
                        <td className="w-5 py-2.5 text-center text-notator-text-dim sm:py-1.5">
                          {entry.columns.c || ""}
                        </td>
                        <td className="w-5 py-2.5 text-center text-notator-text-dim sm:py-1.5">
                          {entry.columns.d || ""}
                        </td>
                      </tr>
                    ))
                  : /* Fallback: show patterns directly if no arrangement */
                    song.patterns.map((pat, idx) => (
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
                        <td className="w-8 px-2 py-2.5 text-right text-notator-text-muted sm:py-1.5">
                          {idx + 1}
                        </td>
                        <td className="px-2 py-2.5 font-bold sm:py-1.5">
                          {pat.name}
                        </td>
                        <td className="w-6 px-2 py-2.5 text-right text-notator-text-dim sm:py-1.5">
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
              <span className="text-notator-text-muted">
                {song.patterns.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Entries</span>
              <span className="text-notator-text-muted">
                {song.arrangement.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Bars</span>
              <span className="text-notator-text-muted">
                {song.arrangement.length > 0
                  ? song.arrangement[song.arrangement.length - 1].bar +
                    song.arrangement[song.arrangement.length - 1].length -
                    1
                  : Math.ceil(song.totalTicks / song.ticksPerMeasure)}
              </span>
            </div>
          </div>
        </aside>

        {/* ─── CENTER PANEL: TRACK GRID ─── */}
        <main
          className={`flex flex-1 flex-col overflow-hidden sm:flex ${
            activePanel === "tracks" ? "flex" : "hidden"
          }`}
        >
          {/* Status bar */}
          <div className="flex items-center gap-2 border-b border-notator-border bg-notator-surface px-3 py-1 text-[10px] sm:gap-3">
            <span className="hidden font-bold uppercase tracking-widest text-notator-text-dim sm:inline">
              Status
            </span>
            <span className="truncate font-bold text-notator-text">
              {songName}
            </span>
            <span className="hidden text-notator-text-dim sm:inline">
              {song.tracks.length} tracks
            </span>
            <span className="hidden text-notator-text-dim sm:inline">·</span>
            <span className="text-notator-accent">
              {song.patterns.find((p) => p.index === activePatternIndex)
                ?.name || `P${activePatternIndex + 1}`}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setShowTimeline((v) => !v)}
                className={`rounded px-2 py-0.5 text-[9px] font-bold ${
                  showTimeline
                    ? "bg-notator-accent/20 text-notator-accent"
                    : "bg-notator-bg/50 text-notator-text-dim"
                }`}
                id="toggle-timeline-btn"
              >
                {showTimeline ? "▼ SCORE" : "▶ SCORE"}
              </button>
              {song && isAuthenticated && (
                <button
                  onClick={() => setShowPublish(true)}
                  className="notator-btn rounded border-notator-green/50 px-2 py-0.5 text-[9px] text-notator-green transition-colors hover:border-notator-green hover:bg-notator-green/10"
                  id="publish-song-btn"
                >
                  🌍 Share
                </button>
              )}
              <UserMenu onLoginClick={() => setShowLogin(true)} />
            </span>
          </div>

          {/* Track grid */}
          <div className="flex-1 overflow-y-auto p-1 sm:p-2">
            <TrackList
              tracks={song.tracks}
              mutedTracks={mutedTracks}
              soloedTracks={soloedTracks}
              activeTrackIndices={activeTrackIndices}
              selectedTrackIndex={selectedTrackIndex}
              onToggleMute={handleToggleMute}
              onToggleSolo={handleToggleSolo}
              onSelectTrack={setSelectedTrackIndex}
              onTrackContextMenu={handleTrackContextMenu}
              onTrackDoubleClick={handleOpenEditor}
              onRenameTrack={handleRenameTrack}
            />
          </div>
        </main>

        {/* ─── RIGHT PANEL: TRACK INFO ─── */}
        <aside
          className={`flex w-full flex-shrink-0 flex-col border-l border-notator-border-bright bg-notator-panel sm:flex sm:w-48 ${
            activePanel === "info" ? "flex" : "hidden"
          }`}
        >
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
                  {
                    label: "CHANNEL",
                    value: `${String.fromCharCode(65 + Math.floor(selectedTrack.channel / 16))} ${(selectedTrack.channel % 16) + 1}`,
                  },
                  { label: "QUANTIZE", value: String(song.ticksPerMeasure) },
                  { label: "NOTES", value: String(noteOns.length) },
                  {
                    label: "RANGE",
                    value:
                      notes.length > 0
                        ? `${midiNoteName(minNote)}-${midiNoteName(maxNote)}`
                        : "---",
                  },
                  {
                    label: "VELOCITY",
                    value:
                      notes.length > 0
                        ? `${Math.min(...noteOns.map((e) => (e as { velocity: number }).velocity))}-${Math.max(...noteOns.map((e) => (e as { velocity: number }).velocity))}`
                        : "---",
                  },
                  {
                    label: "EVENTS",
                    value: String(selectedTrack.events.length),
                  },
                  { label: "NOTE ON", value: String(noteOns.length) },
                  { label: "NOTE OFF", value: String(noteOffs.length) },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between border-b border-notator-border/30 px-3 py-1.5"
                  >
                    <span className="text-notator-text-dim">{label}</span>
                    <span className="font-bold tabular-nums text-notator-text">
                      {value}
                    </span>
                  </div>
                ))}

                {/* Track config details (MIDI port, filters, note range) */}
                {selectedTrack.trackConfig && (
                  <>
                    <div className="border-t border-notator-border px-3 py-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim">
                        Config
                      </span>
                    </div>
                    {[
                      {
                        label: "PORT",
                        value:
                          selectedTrack.trackConfig.midiPort > 0
                            ? String(selectedTrack.trackConfig.midiPort)
                            : "---",
                      },
                      {
                        label: "NOTE FILT",
                        value: `${selectedTrack.trackConfig.noteRangeLow || "---"}-${selectedTrack.trackConfig.noteRangeHigh || "---"}`,
                      },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        className="flex items-center justify-between border-b border-notator-border/30 px-3 py-1"
                      >
                        <span className="text-notator-text-dim text-[10px]">
                          {label}
                        </span>
                        <span className="font-bold tabular-nums text-notator-text text-[10px]">
                          {value}
                        </span>
                      </div>
                    ))}
                    {/* Event type filters */}
                    <div className="px-3 py-1">
                      <div className="flex flex-wrap gap-1">
                        {(
                          [
                            [
                              "NOTE",
                              !selectedTrack.trackConfig.filters.noteFilter,
                            ],
                            [
                              "AT",
                              !selectedTrack.trackConfig.filters
                                .aftertouchFilter,
                            ],
                            ["CC", !selectedTrack.trackConfig.filters.ccFilter],
                            [
                              "PC",
                              !selectedTrack.trackConfig.filters.programFilter,
                            ],
                            [
                              "CP",
                              !selectedTrack.trackConfig.filters
                                .channelPressureFilter,
                            ],
                            [
                              "PW",
                              !selectedTrack.trackConfig.filters
                                .pitchWheelFilter,
                            ],
                            [
                              "SX",
                              !selectedTrack.trackConfig.filters.sysexFilter,
                            ],
                          ] as [string, boolean][]
                        ).map(([label, enabled]) => (
                          <span
                            key={label}
                            className={`rounded px-1 py-0.5 text-[8px] font-bold ${
                              enabled
                                ? "bg-notator-accent/20 text-notator-accent"
                                : "bg-notator-bg/50 text-notator-text-dim line-through"
                            }`}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}

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

                {/* Channel config overview */}
                <div className="border-t border-notator-border px-3 py-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim">
                    Channel {(selectedTrack.channel % 16) + 1}
                  </span>
                </div>
                {[
                  {
                    label: "PROGRAM",
                    value:
                      song.channelConfig.programs[
                        selectedTrack.channel % 16
                      ] !== undefined
                        ? String(
                            song.channelConfig.programs[
                              selectedTrack.channel % 16
                            ],
                          )
                        : "---",
                  },
                  {
                    label: "VOLUME",
                    value:
                      song.channelConfig.volumes[selectedTrack.channel % 16] !==
                      undefined
                        ? String(
                            song.channelConfig.volumes[
                              selectedTrack.channel % 16
                            ],
                          )
                        : "---",
                  },
                  {
                    label: "PAN",
                    value:
                      song.channelConfig.pans[selectedTrack.channel % 16] !==
                      undefined
                        ? String(
                            song.channelConfig.pans[selectedTrack.channel % 16],
                          )
                        : "---",
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between border-b border-notator-border/30 px-3 py-1"
                  >
                    <span className="text-notator-text-dim text-[10px]">
                      {label}
                    </span>
                    <span className="font-bold tabular-nums text-notator-text text-[10px]">
                      {value}
                    </span>
                  </div>
                ))}

                {/* Song config (from extended header) */}
                <div className="border-t border-notator-border px-3 py-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim">
                    Song Config
                  </span>
                </div>
                {[
                  {
                    label: "QUANTIZE",
                    value: String(
                      song.headerConfig.quantizeValue || song.ticksPerMeasure,
                    ),
                  },
                  {
                    label: "LOOP",
                    value: song.headerConfig.loopEnabled ? "ON" : "OFF",
                  },
                  {
                    label: "CLICK",
                    value: song.headerConfig.clickTrack ? "ON" : "OFF",
                  },
                  {
                    label: "PRECOUNT",
                    value:
                      song.headerConfig.precountBars > 0
                        ? String(song.headerConfig.precountBars)
                        : "---",
                  },
                  {
                    label: "GROUP",
                    value: (() => {
                      const g = song.trackGroups.groups[selectedTrackIndex];
                      return g !== undefined && g > 0 ? String(g) : "---";
                    })(),
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between border-b border-notator-border/30 px-3 py-1"
                  >
                    <span className="text-notator-text-dim text-[10px]">
                      {label}
                    </span>
                    <span className="font-bold tabular-nums text-notator-text text-[10px]">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 text-[11px] text-notator-text-dim">
                No track selected
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ─── BOTTOM PANEL: NOTATION TIMELINE ─── */}
      {showTimeline && (
        <div className="border-t border-notator-border-bright bg-notator-bg">
          <NotationTimeline
            tracks={song.tracks}
            ticksPerMeasure={song.ticksPerMeasure}
            ticksPerBeat={song.ticksPerBeat}
            totalTicks={song.totalTicks}
            currentTick={currentTick}
            selectedTrackIndex={selectedTrackIndex}
            isPlaying={playbackState === "playing"}
            onSeek={handleSeek}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border-t border-notator-red/30 bg-notator-red/10 px-4 py-2 text-sm text-notator-red">
          {error}
        </div>
      )}

      {/* Track Context Menu */}
      {contextMenu && (
        <TrackContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          trackIndex={contextMenu.trackIndex}
          trackName={
            song.tracks[contextMenu.trackIndex]?.name ||
            `Track ${contextMenu.trackIndex + 1}`
          }
          isMuted={mutedTracks.has(contextMenu.trackIndex)}
          isSoloed={soloedTracks.has(contextMenu.trackIndex)}
          patterns={song.patterns.map((p, i) => ({
            index: i,
            name: p.name || `Pattern ${i + 1}`,
          }))}
          activePatternIndex={activePatternIndex}
          hasClipboard={trackClipboard !== null}
          onEdit={() => handleOpenEditor(contextMenu.trackIndex)}
          onExportMidi={() => handleExportTrackMidi(contextMenu.trackIndex)}
          onToggleMute={() => handleToggleMute(contextMenu.trackIndex)}
          onToggleSolo={() => handleToggleSolo(contextMenu.trackIndex)}
          onCopy={() => handleCopyTrack(contextMenu.trackIndex)}
          onCut={() => handleCutTrack(contextMenu.trackIndex)}
          onPaste={() => handlePasteTrack(contextMenu.trackIndex)}
          onDelete={() => handleDeleteTrack(contextMenu.trackIndex)}
          onDuplicate={() => handleDuplicateTrack(contextMenu.trackIndex)}
          onMoveToPattern={(patIdx) =>
            handleMoveToPattern(contextMenu.trackIndex, patIdx)
          }
          onClose={handleCloseContextMenu}
        />
      )}

      {/* Piano Roll Editor */}
      {editingTrackIndex !== null && song.tracks[editingTrackIndex] && (
        <PianoRollEditor
          track={song.tracks[editingTrackIndex]}
          trackIndex={editingTrackIndex}
          ticksPerBeat={song.ticksPerBeat}
          ticksPerMeasure={song.ticksPerMeasure}
          totalTicks={song.totalTicks}
          currentTick={editorCurrentTick}
          isPlaying={editorPlaybackState === "playing"}
          loopEnabled={editorLoopEnabled}
          loopStart={editorLoopStart}
          loopEnd={editorLoopEnd}
          onSave={handleSaveEditor}
          onClose={handleCloseEditor}
          onPreviewNote={handlePreviewNote}
          onSeek={handleEditorSeek}
          onPlay={handleEditorPlay}
          onPause={handleEditorPause}
          onStop={handleEditorStop}
          onToggleLoop={handleEditorToggleLoop}
          onSetLoopRegion={handleEditorSetLoopRegion}
          isSoloed={editorSoloed}
          onToggleSolo={handleEditorToggleSolo}
        />
      )}

      {/* Auth & Publish Modals */}
      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
      <PublishModal
        isOpen={showPublish}
        onClose={() => setShowPublish(false)}
        songBuffer={songBuffer}
        songFileName={songFileName}
      />
    </div>
  );
}

export default function PlayerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-notator-bg-deep">
          <div className="animate-pulse text-notator-text-muted text-sm">
            Loading…
          </div>
        </div>
      }
    >
      <PlayerContent />
    </Suspense>
  );
}
