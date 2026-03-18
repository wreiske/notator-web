"use client";

/**
 * MIDI Settings Panel — device selection, MIDI Thru, SysEx, and panic
 *
 * Matches the Notator aesthetic using existing CSS utility classes.
 * Shown as an expandable panel triggered from the TransportBar MIDI menu.
 */

import { useEffect, useState, useCallback } from "react";
import type { UseMidiResult } from "@/lib/midi/use-midi";
import { getMidiManager } from "@/lib/midi/midi-manager";

interface MidiSettingsPanelProps {
  midi: UseMidiResult;
  onClose: () => void;
}

export function MidiSettingsPanel({ midi, onClose }: MidiSettingsPanelProps) {
  const [inputActivity, setInputActivity] = useState(false);
  const [outputActivity, setOutputActivity] = useState(false);

  // Flash activity indicators via MidiManager events
  useEffect(() => {
    const mgr = getMidiManager();

    const handleInput = () => {
      setInputActivity(true);
      setTimeout(() => setInputActivity(false), 100);
    };
    const handleOutput = () => {
      setOutputActivity(true);
      setTimeout(() => setOutputActivity(false), 100);
    };

    mgr.on("inputActivity", handleInput);
    mgr.on("outputActivity", handleOutput);

    return () => {
      mgr.off("inputActivity", handleInput);
      mgr.off("outputActivity", handleOutput);
    };
  }, []);

  // Initialize MIDI access on panel open (user gesture)
  useEffect(() => {
    if (!midi.initialized && midi.supported) {
      midi.requestAccess();
    }
  }, [midi]);

  const handleOutputChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      midi.selectOutput(value === "" ? null : value);
    },
    [midi],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      midi.selectInput(value === "" ? null : value);
    },
    [midi],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        id="midi-settings-backdrop"
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md rounded border-2 border-notator-border-bright bg-notator-panel font-mono text-notator-text shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-notator-border px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">🎹</span>
            <h2 className="text-xs font-bold uppercase tracking-widest">
              MIDI Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-notator-text-dim hover:text-notator-text"
            id="midi-settings-close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="space-y-0">
          {!midi.supported && (
            <div className="px-4 py-4 text-center text-xs text-notator-red">
              Web MIDI is not supported in this browser.
              <br />
              <span className="text-notator-text-dim">
                Try Chrome, Edge, or Opera for MIDI device support.
              </span>
            </div>
          )}

          {midi.supported && !midi.initialized && (
            <div className="px-4 py-4 text-center">
              <button
                onClick={() => midi.requestAccess()}
                className="notator-btn rounded border-notator-accent bg-notator-accent/10 px-4 py-2 text-xs text-notator-accent hover:bg-notator-accent/20"
                id="midi-request-access"
              >
                Grant MIDI Access
              </button>
              <p className="mt-2 text-[10px] text-notator-text-dim">
                Click to allow Web MIDI access in your browser
              </p>
            </div>
          )}

          {midi.initialized && (
            <>
              {/* ── OUTPUT DEVICE ── */}
              <div className="border-b border-notator-border/30 px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim">
                    Output Device
                  </label>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`h-1.5 w-1.5 rounded-full transition-colors ${
                        outputActivity
                          ? "bg-notator-green"
                          : midi.selectedOutputId
                            ? "bg-notator-green/40"
                            : "bg-notator-text-dim/30"
                      }`}
                    />
                    <span className="text-[8px] text-notator-text-dim">
                      OUT
                    </span>
                  </div>
                </div>
                <select
                  value={midi.selectedOutputId ?? ""}
                  onChange={handleOutputChange}
                  className="w-full rounded border border-notator-border bg-notator-bg px-2 py-1.5 text-xs text-notator-text outline-none focus:border-notator-accent"
                  id="midi-output-select"
                >
                  <option value="">GM Synth (Built-in)</option>
                  {midi.outputs.map((device) => (
                    <option
                      key={device.id}
                      value={device.id}
                      disabled={device.state !== "connected"}
                    >
                      {device.name}
                      {device.state !== "connected" ? " (disconnected)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* ── INPUT DEVICE ── */}
              <div className="border-b border-notator-border/30 px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-notator-text-dim">
                    Input Device
                  </label>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`h-1.5 w-1.5 rounded-full transition-colors ${
                        inputActivity
                          ? "bg-notator-accent"
                          : midi.selectedInputId
                            ? "bg-notator-accent/40"
                            : "bg-notator-text-dim/30"
                      }`}
                    />
                    <span className="text-[8px] text-notator-text-dim">IN</span>
                  </div>
                </div>
                <select
                  value={midi.selectedInputId ?? ""}
                  onChange={handleInputChange}
                  className="w-full rounded border border-notator-border bg-notator-bg px-2 py-1.5 text-xs text-notator-text outline-none focus:border-notator-accent"
                  id="midi-input-select"
                >
                  <option value="">None</option>
                  {midi.inputs.map((device) => (
                    <option
                      key={device.id}
                      value={device.id}
                      disabled={device.state !== "connected"}
                    >
                      {device.name}
                      {device.state !== "connected" ? " (disconnected)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* ── TOGGLES ── */}
              <div className="flex border-b border-notator-border/30">
                {/* MIDI Thru */}
                <button
                  onClick={midi.toggleMidiThru}
                  className={`flex-1 border-r border-notator-border/30 px-3 py-2.5 text-left text-[10px] transition-colors ${
                    midi.midiThruEnabled
                      ? "bg-notator-accent/15 text-notator-accent"
                      : "text-notator-text-dim hover:text-notator-text"
                  }`}
                  title="Forward MIDI input directly to output in real-time"
                  id="midi-thru-toggle"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold">MIDI THRU</span>
                    <span
                      className={`text-[8px] ${midi.midiThruEnabled ? "text-notator-accent" : "text-notator-text-dim"}`}
                    >
                      {midi.midiThruEnabled ? "ON" : "OFF"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[8px] text-notator-text-dim">
                    Forward input → output
                  </div>
                </button>

                {/* SysEx */}
                <button
                  onClick={() => midi.toggleSysex()}
                  className={`flex-1 px-3 py-2.5 text-left text-[10px] transition-colors ${
                    midi.sysexEnabled
                      ? "bg-notator-accent/15 text-notator-accent"
                      : "text-notator-text-dim hover:text-notator-text"
                  }`}
                  title="Enable System Exclusive messages (requires browser permission)"
                  id="midi-sysex-toggle"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold">SYSEX</span>
                    <span
                      className={`text-[8px] ${midi.sysexEnabled ? "text-notator-accent" : "text-notator-text-dim"}`}
                    >
                      {midi.sysexEnabled ? "ON" : "OFF"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[8px] text-notator-text-dim">
                    System Exclusive msgs
                  </div>
                </button>
              </div>

              {/* ── PANIC BUTTON ── */}
              <div className="px-4 py-3">
                <button
                  onClick={midi.panic}
                  className="notator-btn w-full rounded border-notator-red bg-notator-red/10 px-3 py-2 text-[10px] font-bold text-notator-red transition-colors hover:bg-notator-red/20"
                  title="Send All Notes Off + All Sound Off on all 16 channels"
                  id="midi-panic"
                >
                  ■ ALL NOTES OFF
                </button>
              </div>

              {/* ── DEVICE INFO ── */}
              {(midi.inputs.length > 0 || midi.outputs.length > 0) && (
                <div className="border-t border-notator-border/30 px-4 py-2">
                  <div className="text-[8px] text-notator-text-dim">
                    {midi.inputs.length} input
                    {midi.inputs.length !== 1 ? "s" : ""}, {midi.outputs.length}{" "}
                    output
                    {midi.outputs.length !== 1 ? "s" : ""} detected
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
