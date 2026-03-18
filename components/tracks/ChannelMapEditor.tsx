"use client";

import { useState, useCallback, useMemo } from "react";
import type { ChannelConfig } from "@/lib/son-parser/types";
import { GM_INSTRUMENTS, GM_FAMILIES } from "@/lib/midi/gm-instruments";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui/SearchableSelect";

interface ChannelMapEditorProps {
  channelConfig: ChannelConfig;
  instrumentNames: string[];
  drumChannels: Set<number>;
  onApply: (config: ChannelConfig, drumChannels: Set<number>) => void;
  onClose: () => void;
}

export function ChannelMapEditor({
  channelConfig,
  instrumentNames,
  drumChannels: initialDrumChannels,
  onApply,
  onClose,
}: ChannelMapEditorProps) {
  // Local editable copy
  const [programs, setPrograms] = useState<number[]>([
    ...channelConfig.programs,
  ]);
  const [volumes, setVolumes] = useState<number[]>([...channelConfig.volumes]);
  const [pans, setPans] = useState<number[]>([...channelConfig.pans]);
  const [drums, setDrums] = useState<Set<number>>(new Set(initialDrumChannels));

  // Build flat options list with group labels for SearchableSelect
  const instrumentOptions: SearchableSelectOption[] = useMemo(() => {
    const opts: SearchableSelectOption[] = [];
    for (let i = 0; i < GM_INSTRUMENTS.length; i++) {
      const familyIdx = Math.floor(i / 8);
      opts.push({
        value: i,
        label: GM_INSTRUMENTS[i],
        group: GM_FAMILIES[familyIdx],
      });
    }
    return opts;
  }, []);

  const handleProgramChange = useCallback((ch: number, program: number) => {
    setPrograms((prev) => {
      const next = [...prev];
      next[ch] = program;
      return next;
    });
  }, []);

  const handleVolumeChange = useCallback((ch: number, volume: number) => {
    setVolumes((prev) => {
      const next = [...prev];
      next[ch] = volume;
      return next;
    });
  }, []);

  const handlePanChange = useCallback((ch: number, pan: number) => {
    setPans((prev) => {
      const next = [...prev];
      next[ch] = pan;
      return next;
    });
  }, []);

  const handleDrumToggle = useCallback((ch: number) => {
    setDrums((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) {
        next.delete(ch);
      } else {
        next.add(ch);
      }
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setPrograms([...channelConfig.programs]);
    setVolumes([...channelConfig.volumes]);
    setPans([...channelConfig.pans]);
    setDrums(new Set(initialDrumChannels));
  }, [channelConfig, initialDrumChannels]);

  const handleApply = useCallback(() => {
    onApply(
      {
        channels: channelConfig.channels,
        programs,
        volumes,
        pans,
      },
      drums,
    );
  }, [channelConfig.channels, programs, volumes, pans, drums, onApply]);

  /** Pan display: L64..C..R63 */
  const panLabel = (pan: number) => {
    if (pan === 64) return "C";
    if (pan < 64) return `L${64 - pan}`;
    return `R${pan - 64}`;
  };

  return (
    <div
      className="notator-dialog-overlay"
      onClick={onClose}
      id="channel-map-overlay"
    >
      <div
        className="notator-channel-map-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="notator-dialog-titlebar">
          <span className="flex-1 font-bold tracking-wider">
            🎹 MIDI Channel Map
          </span>
          <button
            className="notator-dialog-close"
            onClick={onClose}
            id="channel-map-close"
          >
            ✕
          </button>
        </div>

        {/* Channel grid — using a table for proper column alignment */}
        <div className="channel-map-scroll">
          <table className="channel-map-table">
            <thead>
              <tr className="channel-map-thead-row">
                <th className="channel-map-th channel-map-th-ch">CH</th>
                <th className="channel-map-th channel-map-th-name">NAME</th>
                <th className="channel-map-th channel-map-th-inst">
                  INSTRUMENT
                </th>
                <th className="channel-map-th channel-map-th-drum">DRUM</th>
                <th className="channel-map-th channel-map-th-vol">VOL</th>
                <th className="channel-map-th channel-map-th-pan">PAN</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 16 }, (_, ch) => {
                const isDrum = drums.has(ch);
                const instName = instrumentNames[ch] || "";

                return (
                  <tr
                    key={ch}
                    className={`channel-map-tr ${isDrum ? "channel-map-tr-drum" : ""}`}
                    id={`channel-map-row-${ch}`}
                  >
                    {/* Channel number */}
                    <td className="channel-map-td channel-map-td-ch">
                      <span className="channel-map-ch-badge">{ch + 1}</span>
                    </td>

                    {/* Instrument name from the song */}
                    <td
                      className="channel-map-td channel-map-td-name"
                      title={instName}
                    >
                      {instName || "—"}
                    </td>

                    {/* Program select */}
                    <td className="channel-map-td channel-map-td-inst">
                      {isDrum ? (
                        <span className="channel-map-drum-label">
                          🥁 Standard Kit
                        </span>
                      ) : (
                        <SearchableSelect
                          options={instrumentOptions}
                          value={programs[ch] ?? 0}
                          onChange={(v) => handleProgramChange(ch, v)}
                          placeholder="Search instruments…"
                          id={`channel-map-program-${ch}`}
                        />
                      )}
                    </td>

                    {/* Drum toggle */}
                    <td className="channel-map-td channel-map-td-drum">
                      <button
                        className={`channel-map-drum-btn ${isDrum ? "channel-map-drum-active" : ""}`}
                        onClick={() => handleDrumToggle(ch)}
                        title={isDrum ? "Switch to melodic" : "Switch to drums"}
                        id={`channel-map-drum-${ch}`}
                      >
                        🥁
                      </button>
                    </td>

                    {/* Volume */}
                    <td className="channel-map-td channel-map-td-slider">
                      <div className="channel-map-slider-wrap">
                        <input
                          type="range"
                          min={0}
                          max={127}
                          value={volumes[ch] ?? 100}
                          onChange={(e) =>
                            handleVolumeChange(ch, parseInt(e.target.value, 10))
                          }
                          className="channel-map-slider"
                          id={`channel-map-vol-${ch}`}
                        />
                        <span className="channel-map-slider-val">
                          {volumes[ch] ?? 100}
                        </span>
                      </div>
                    </td>

                    {/* Pan */}
                    <td className="channel-map-td channel-map-td-slider">
                      <div className="channel-map-slider-wrap">
                        <input
                          type="range"
                          min={0}
                          max={127}
                          value={pans[ch] ?? 64}
                          onChange={(e) =>
                            handlePanChange(ch, parseInt(e.target.value, 10))
                          }
                          className="channel-map-slider"
                          id={`channel-map-pan-${ch}`}
                        />
                        <span className="channel-map-slider-val">
                          {panLabel(pans[ch] ?? 64)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer buttons */}
        <div className="channel-map-footer">
          <button
            className="notator-btn channel-map-btn-secondary"
            onClick={handleReset}
            id="channel-map-reset"
          >
            ↻ Reset
          </button>
          <div className="channel-map-footer-right">
            <button
              className="notator-btn channel-map-btn-secondary"
              onClick={onClose}
              id="channel-map-cancel"
            >
              Cancel
            </button>
            <button
              className="notator-btn channel-map-btn-primary"
              onClick={handleApply}
              id="channel-map-apply"
            >
              ✓ Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
