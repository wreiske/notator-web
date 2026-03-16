"use client";

import { useState, useRef, useEffect, memo } from "react";
import type { Track } from "@/lib/son-parser/types";

/** Notator SL track name limit: 8 ASCII characters */
const MAX_TRACK_NAME_LENGTH = 8;

/** Map MIDI note number to note name */
function midiNoteToName(note: number): string {
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
  const octave = Math.floor(note / 12) - 1;
  return `${names[note % 12]}${octave}`;
}

/** Map channel index to Notator sub-group letter */
function channelToGroup(ch: number): string {
  return String.fromCharCode(65 + Math.floor(ch / 16));
}

interface TrackListProps {
  tracks: Track[];
  mutedTracks: Set<number>;
  soloedTracks: Set<number>;
  activeTrackIndices: Set<number>;
  selectedTrackIndex: number;
  onToggleMute: (index: number) => void;
  onToggleSolo: (index: number) => void;
  onSelectTrack: (index: number) => void;
  onTrackContextMenu?: (index: number, x: number, y: number) => void;
  onTrackDoubleClick?: (index: number) => void;
  onRenameTrack?: (index: number, newName: string) => void;
}

export function TrackList({
  tracks,
  mutedTracks,
  soloedTracks,
  activeTrackIndices,
  selectedTrackIndex,
  onToggleMute,
  onToggleSolo,
  onSelectTrack,
  onTrackContextMenu,
  onTrackDoubleClick,
  onRenameTrack,
}: TrackListProps) {
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus and select-all when rename input appears
  useEffect(() => {
    if (renamingIndex !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingIndex]);

  const startRename = (index: number, currentName: string) => {
    setRenamingIndex(index);
    setRenameValue(currentName);
  };

  const commitRename = () => {
    if (renamingIndex !== null && onRenameTrack) {
      const trimmed = renameValue.trim();
      if (trimmed.length > 0) {
        onRenameTrack(renamingIndex, trimmed);
      }
    }
    setRenamingIndex(null);
    setRenameValue("");
  };

  const cancelRename = () => {
    setRenamingIndex(null);
    setRenameValue("");
  };

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded border border-dashed border-notator-border p-12 text-center">
        <p className="text-notator-text-muted">No tracks in this pattern</p>
      </div>
    );
  }

  // Pre-compute per-track stats ONCE per render instead of inside each row
  const trackStats = tracks.map((track) => {
    const noteOns = track.events.filter((e) => e.type === "note_on");
    const noteValues = noteOns.map((e) => (e as { note: number }).note);
    return {
      noteOnCount: noteOns.length,
      minNote: noteValues.length > 0 ? Math.min(...noteValues) : 0,
      maxNote: noteValues.length > 0 ? Math.max(...noteValues) : 0,
      notes: noteValues,
    };
  });

  return (
    <div className="overflow-hidden rounded border border-notator-border-bright">
      <table className="w-full border-collapse font-mono">
        <thead>
          <tr className="border-b border-notator-border-bright bg-notator-surface-active text-[10px] font-bold uppercase tracking-wider text-notator-text-muted">
            <th className="border-r border-notator-border/50 px-1.5 py-1 text-center w-8">
              #
            </th>
            <th className="border-r border-notator-border/50 px-2 py-1 text-left">
              Name
            </th>
            <th className="hidden border-r border-notator-border/50 px-2 py-1 text-left w-16 sm:table-cell">
              Status
            </th>
            <th className="border-r border-notator-border/50 px-1.5 py-1 text-center w-12">
              CH
            </th>
            <th className="hidden border-r border-notator-border/50 px-1.5 py-1 text-right w-14 sm:table-cell">
              Notes
            </th>
            <th className="hidden border-r border-notator-border/50 px-1.5 py-1 text-center w-20 sm:table-cell">
              Range
            </th>
            <th className="border-r border-notator-border/50 px-0.5 py-1 text-center w-7">
              M
            </th>
            <th className="px-0.5 py-1 text-center w-7">S</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-notator-border/30">
          {tracks.map((track, index) => {
            const isEmpty = track.events.length === 0 && !track.name;
            const { noteOnCount, minNote, maxNote, notes } = trackStats[index];
            const isDrums = track.channel === 9;
            const isMuted = mutedTracks.has(index);
            const isSoloed = soloedTracks.has(index);
            const isActive = activeTrackIndices.has(index);
            const isSelected = index === selectedTrackIndex;
            const isRenaming = renamingIndex === index;
            const displayName =
              track.name ||
              (isEmpty ? "---" : `Track ${(track.trackIndex ?? index) + 1}`);
            const trackNum = (track.trackIndex ?? index) + 1;

            return (
              <tr
                key={index}
                onClick={() => onSelectTrack(index)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelectTrack(index);
                  onTrackContextMenu?.(index, e.clientX, e.clientY);
                }}
                onDoubleClick={() => onTrackDoubleClick?.(index)}
                className={`
                  group cursor-pointer text-[11px] transition-colors
                  ${
                    isEmpty
                      ? "text-notator-text-dim/40"
                      : isSelected
                        ? "bg-notator-highlight text-white"
                        : isActive
                          ? "bg-notator-selection text-white"
                          : isMuted
                            ? "bg-notator-bg/50 text-notator-text-dim"
                            : "text-notator-text hover:bg-notator-surface-hover"
                  }
                `}
                id={`track-row-${index}`}
              >
                <td className="border-r border-notator-border/50 px-1.5 py-2.5 text-center font-bold text-notator-text-muted sm:py-1.5">
                  {trackNum}
                </td>
                <td className="max-w-[160px] border-r border-notator-border/50 px-2 py-1.5 font-bold">
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) =>
                        setRenameValue(
                          e.target.value.slice(0, MAX_TRACK_NAME_LENGTH),
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                        e.stopPropagation();
                      }}
                      onBlur={commitRename}
                      onClick={(e) => e.stopPropagation()}
                      maxLength={MAX_TRACK_NAME_LENGTH}
                      className="w-full rounded border border-notator-accent bg-notator-bg px-1 py-0 font-mono text-[11px] font-bold text-notator-text outline-none focus:ring-1 focus:ring-notator-accent"
                      id={`track-rename-input-${index}`}
                    />
                  ) : isEmpty ? (
                    <span className="text-notator-text-dim/30">---</span>
                  ) : (
                    <span
                      className="block cursor-text truncate hover:text-notator-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTrack(index);
                        if (onRenameTrack) {
                          startRename(index, track.name || "");
                        }
                      }}
                      title="Click to rename"
                    >
                      {displayName}
                    </span>
                  )}
                </td>
                <td className="hidden border-r border-notator-border/50 px-2 py-1.5 text-notator-text-muted sm:table-cell">
                  {isEmpty ? (
                    ""
                  ) : isDrums ? (
                    <span className="text-notator-amber">DRUMS</span>
                  ) : notes.length > 0 ? (
                    <span>NOTE</span>
                  ) : (
                    <span className="text-notator-text-dim">----</span>
                  )}
                </td>
                <td className="border-r border-notator-border/50 px-1.5 py-1.5 text-center">
                  {!isEmpty && (
                    <>
                      <span className="text-notator-accent">
                        {channelToGroup(track.channel)}
                      </span>
                      <span className="ml-0.5 text-notator-text-muted">
                        {(track.channel % 16) + 1}
                      </span>
                    </>
                  )}
                </td>
                <td className="hidden border-r border-notator-border/50 px-1.5 py-1.5 text-right tabular-nums text-notator-text-muted sm:table-cell">
                  {noteOnCount > 0 ? noteOnCount : ""}
                </td>
                <td className="hidden border-r border-notator-border/50 px-1.5 py-1.5 text-center text-notator-text-dim sm:table-cell">
                  {notes.length > 0 && !isDrums ? (
                    <span>
                      {midiNoteToName(minNote)}-{midiNoteToName(maxNote)}
                    </span>
                  ) : (
                    ""
                  )}
                </td>
                <td className="border-r border-notator-border/50 px-0.5 py-1.5 text-center">
                  {!isEmpty && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleMute(index);
                      }}
                      className={`notator-btn rounded px-1 text-[10px] ${
                        isMuted
                          ? "border-notator-red bg-notator-red/20 text-notator-red"
                          : "border-transparent text-notator-text-dim hover:text-notator-text"
                      }`}
                      title={isMuted ? "Unmute" : "Mute"}
                      id={`track-mute-${index}`}
                    >
                      M
                    </button>
                  )}
                </td>
                <td className="px-0.5 py-1.5 text-center">
                  {!isEmpty && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSolo(index);
                      }}
                      className={`notator-btn rounded px-1 text-[10px] ${
                        isSoloed
                          ? "border-notator-amber bg-notator-amber/20 text-notator-amber"
                          : "border-transparent text-notator-text-dim hover:text-notator-text"
                      }`}
                      title={isSoloed ? "Unsolo" : "Solo"}
                      id={`track-solo-${index}`}
                    >
                      S
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Memoize to prevent re-renders when only tick changes (the parent
// re-renders at ~15fps for transport display, but TrackList only needs
// to update when tracks/mute/solo/selection actually change).
export const MemoizedTrackList = memo(TrackList);
