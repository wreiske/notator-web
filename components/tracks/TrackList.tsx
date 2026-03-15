"use client";

import type { Track } from "@/lib/son-parser/types";

/** Map MIDI note number to note name */
function midiNoteToName(note: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
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
}: TrackListProps) {
  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded border border-dashed border-notator-border p-12 text-center">
        <p className="text-notator-text-muted">No tracks in this pattern</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-notator-border-bright">
      <table className="w-full border-collapse font-mono">
        <thead>
          <tr className="border-b border-notator-border-bright bg-notator-surface-active text-[10px] font-bold uppercase tracking-wider text-notator-text-muted">
            <th className="border-r border-notator-border/50 px-1.5 py-1 text-center w-8">#</th>
            <th className="border-r border-notator-border/50 px-2 py-1 text-left">Name</th>
            <th className="border-r border-notator-border/50 px-2 py-1 text-left w-16">Status</th>
            <th className="border-r border-notator-border/50 px-1.5 py-1 text-center w-12">CH</th>
            <th className="border-r border-notator-border/50 px-1.5 py-1 text-right w-14">Notes</th>
            <th className="border-r border-notator-border/50 px-1.5 py-1 text-center w-20">Range</th>
            <th className="border-r border-notator-border/50 px-0.5 py-1 text-center w-7">M</th>
            <th className="px-0.5 py-1 text-center w-7">S</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-notator-border/30">
          {tracks.map((track, index) => {
            const noteOnCount = track.events.filter(e => e.type === "note_on").length;
            const notes = track.events
              .filter(e => e.type === "note_on")
              .map(e => (e as { note: number }).note);
            const minNote = notes.length > 0 ? Math.min(...notes) : 0;
            const maxNote = notes.length > 0 ? Math.max(...notes) : 0;
            const isDrums = track.channel === 9;
            const isMuted = mutedTracks.has(index);
            const isSoloed = soloedTracks.has(index);
            const isActive = activeTrackIndices.has(index);
            const isSelected = index === selectedTrackIndex;

            return (
              <tr
                key={index}
                onClick={() => onSelectTrack(index)}
                className={`
                  group cursor-pointer text-[11px] transition-colors
                  ${
                    isSelected
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
                <td className="border-r border-notator-border/50 px-1.5 py-1.5 text-center font-bold text-notator-text-muted">
                  {index + 1}
                </td>
                <td className="max-w-[160px] truncate border-r border-notator-border/50 px-2 py-1.5 font-bold">
                  {track.name || `Track ${index + 1}`}
                </td>
                <td className="border-r border-notator-border/50 px-2 py-1.5 text-notator-text-muted">
                  {isDrums ? (
                    <span className="text-notator-amber">DRUMS</span>
                  ) : notes.length > 0 ? (
                    <span>NOTE</span>
                  ) : (
                    <span className="text-notator-text-dim">---</span>
                  )}
                </td>
                <td className="border-r border-notator-border/50 px-1.5 py-1.5 text-center">
                  <span className="text-notator-accent">{channelToGroup(track.channel)}</span>
                  <span className="ml-0.5 text-notator-text-muted">{(track.channel % 16) + 1}</span>
                </td>
                <td className="border-r border-notator-border/50 px-1.5 py-1.5 text-right tabular-nums text-notator-text-muted">
                  {noteOnCount > 0 ? noteOnCount : ""}
                </td>
                <td className="border-r border-notator-border/50 px-1.5 py-1.5 text-center text-notator-text-dim">
                  {notes.length > 0 && !isDrums ? (
                    <span>{midiNoteToName(minNote)}-{midiNoteToName(maxNote)}</span>
                  ) : ""}
                </td>
                <td className="border-r border-notator-border/50 px-0.5 py-1.5 text-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleMute(index); }}
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
                </td>
                <td className="px-0.5 py-1.5 text-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleSolo(index); }}
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
