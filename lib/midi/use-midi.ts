/**
 * useMidi — React hook wrapping MidiManager
 *
 * Provides reactive MIDI device state for components.
 * Uses the MidiManager singleton and subscribes to device changes.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getMidiManager,
  type MidiDeviceInfo,
  type MidiInputMessage,
} from "./midi-manager";

export interface UseMidiResult {
  /** Whether the Web MIDI API is available in this browser */
  supported: boolean;
  /** Whether MIDI access has been granted and initialized */
  initialized: boolean;
  /** All connected MIDI input devices */
  inputs: MidiDeviceInfo[];
  /** All connected MIDI output devices */
  outputs: MidiDeviceInfo[];
  /** Currently selected input device ID (null = none) */
  selectedInputId: string | null;
  /** Currently selected output device ID (null = built-in synth) */
  selectedOutputId: string | null;
  /** Select a MIDI input device */
  selectInput: (id: string | null) => void;
  /** Select a MIDI output device */
  selectOutput: (id: string | null) => void;
  /** Whether MIDI Thru is enabled (input → output forwarding) */
  midiThruEnabled: boolean;
  /** Toggle MIDI Thru on/off */
  toggleMidiThru: () => void;
  /** Whether SysEx is enabled */
  sysexEnabled: boolean;
  /** Toggle SysEx support (re-requests MIDI access) */
  toggleSysex: () => Promise<void>;
  /** Most recent MIDI input message (for activity indicators) */
  lastInputMessage: MidiInputMessage | null;
  /** Send All Notes Off on all channels */
  panic: () => void;
  /** Request MIDI access (call on user gesture) */
  requestAccess: () => Promise<boolean>;
}

export function useMidi(): UseMidiResult {
  const manager = getMidiManager();

  const [supported] = useState(() => manager.supported);
  const [initialized, setInitialized] = useState(manager.initialized);
  const [inputs, setInputs] = useState<MidiDeviceInfo[]>(manager.inputs);
  const [outputs, setOutputs] = useState<MidiDeviceInfo[]>(manager.outputs);
  const [selectedInputId, setSelectedInputId] = useState<string | null>(
    manager.selectedInputId,
  );
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(
    manager.selectedOutputId,
  );
  const [midiThruEnabled, setMidiThruEnabled] = useState(
    manager.midiThruEnabled,
  );
  const [sysexEnabled, setSysexEnabled] = useState(manager.sysexEnabled);
  const [lastInputMessage, setLastInputMessage] =
    useState<MidiInputMessage | null>(null);

  // Ref to prevent stale closure in event callbacks
  const managerRef = useRef(manager);
  useEffect(() => {
    managerRef.current = manager;
  });

  // Sync state from MidiManager when devices change
  useEffect(() => {
    const handleDeviceChange = () => {
      const m = managerRef.current;
      setInitialized(m.initialized);
      setInputs([...m.inputs]);
      setOutputs([...m.outputs]);
      setSelectedInputId(m.selectedInputId);
      setSelectedOutputId(m.selectedOutputId);
      setMidiThruEnabled(m.midiThruEnabled);
      setSysexEnabled(m.sysexEnabled);
    };

    const handleMidiMessage = (...args: unknown[]) => {
      const msg = args[0] as MidiInputMessage;
      setLastInputMessage(msg);
    };

    manager.on("deviceChange", handleDeviceChange);
    manager.on("midiMessage", handleMidiMessage);

    return () => {
      manager.off("deviceChange", handleDeviceChange);
      manager.off("midiMessage", handleMidiMessage);
    };
  }, [manager]);

  const selectInput = useCallback(
    (id: string | null) => {
      manager.selectInput(id);
      setSelectedInputId(id);
    },
    [manager],
  );

  const selectOutput = useCallback(
    (id: string | null) => {
      manager.selectOutput(id);
      setSelectedOutputId(id);
    },
    [manager],
  );

  const toggleMidiThru = useCallback(() => {
    manager.toggleMidiThru();
    setMidiThruEnabled(manager.midiThruEnabled);
  }, [manager]);

  const toggleSysex = useCallback(async () => {
    await manager.toggleSysex();
    setSysexEnabled(manager.sysexEnabled);
  }, [manager]);

  const panic = useCallback(() => {
    manager.panic();
  }, [manager]);

  const requestAccess = useCallback(async () => {
    const ok = await manager.init();
    if (ok) {
      setInitialized(true);
      setInputs([...manager.inputs]);
      setOutputs([...manager.outputs]);
      setSelectedInputId(manager.selectedInputId);
      setSelectedOutputId(manager.selectedOutputId);
    }
    return ok;
  }, [manager]);

  return {
    supported,
    initialized,
    inputs,
    outputs,
    selectedInputId,
    selectedOutputId,
    selectInput,
    selectOutput,
    midiThruEnabled,
    toggleMidiThru,
    sysexEnabled,
    toggleSysex,
    lastInputMessage,
    panic,
    requestAccess,
  };
}
