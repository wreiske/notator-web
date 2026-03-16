//! Notator SL .SON file data types
//!
//! These types represent the structure of a Notator SL .SON file.
//! All types derive Debug and Clone. When the `wasm` feature is enabled,
//! they also derive Serialize for JSON transport to JavaScript.
//!
//! All serialized field names use camelCase to match the existing
//! TypeScript types in the web app.

#[cfg(feature = "wasm")]
use serde::Serialize;

// ═══════════════════════════════════════════════════════════════════════
// TOP-LEVEL FILE STRUCTURE
// ═══════════════════════════════════════════════════════════════════════

/// Complete .SON file — preserves everything for round-trip serialization.
#[derive(Debug, Clone)]
pub struct SonFile {
    /// Raw header bytes (0x0000–0x5AC7)
    pub raw_header: Vec<u8>,
    /// Parsed header fields
    pub header: SonHeader,
    /// All track slots (including empty ones)
    pub track_slots: Vec<TrackSlot>,
    /// Boundary marker info for each slot
    pub boundaries: Vec<BoundaryInfo>,
    /// Pre-boundary padding
    pub pre_boundary_padding: Vec<u8>,
    /// Pattern names from the header name table at 0x21BE
    pub pattern_names: Vec<String>,
    /// Convenience: derived SongData for playback/UI
    pub song_data: SongData,
}

/// Parsed header fields from the raw header.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct SonHeader {
    /// Bytes at 0x0000-0x0001 (typically 0x3B9E)
    pub magic: u16,
    /// Tempo in BPM (offset 0x0006)
    pub tempo: u16,
    /// Ticks per measure (offset 0x0022, 768 = 4/4, 576 = 3/4)
    pub ticks_per_measure: u16,
    /// Ticks per beat (derived: ticks_per_measure / 4)
    pub ticks_per_beat: u16,
    /// Instrument names from header (16 × 9 bytes at 0x0064)
    pub instrument_names: Vec<String>,
    /// MIDI channel configuration
    pub channel_config: ChannelConfig,
    /// Extended header config (0x0008–0x0021)
    pub header_config: HeaderConfig,
    /// Track group mapping (0x0330–0x036F)
    pub track_groups: TrackGroupMapping,
}

/// Extended header config parsed from 0x0008–0x0021.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct HeaderConfig {
    pub quantize_value: u16,
    pub loop_enabled: bool,
    pub auto_quantize: bool,
    pub flags_byte: u8,
    pub click_track: bool,
    pub metronome_prescale: u8,
    pub precount_bars: u8,
    pub active_track_mask: u16,
    pub display_mode: u8,
}

/// Track-to-group mapping parsed from 0x0330–0x036F.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct TrackGroupMapping {
    /// 16-element array: groups[track_index] = group number
    pub groups: Vec<u8>,
}

/// MIDI channel configuration from the header.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct ChannelConfig {
    pub channels: Vec<u8>,
    pub programs: Vec<u8>,
    pub volumes: Vec<u8>,
    pub pans: Vec<u8>,
}

// ═══════════════════════════════════════════════════════════════════════
// TRACK STRUCTURES
// ═══════════════════════════════════════════════════════════════════════

/// A track slot (may be empty — preserves structure for round-trip).
#[derive(Debug, Clone)]
pub struct TrackSlot {
    /// Raw 24-byte track header
    pub raw_header: Vec<u8>,
    /// Track name (8 bytes, ASCII, space-padded)
    pub name: String,
    /// Raw 8-byte name field
    pub raw_name: Vec<u8>,
    /// Raw 14-byte track config
    pub raw_config: Vec<u8>,
    /// Parsed track config
    pub config: TrackConfig,
    /// ALL events — both MIDI and non-MIDI
    pub events: Vec<SonEvent>,
    /// Whether this slot has any playable MIDI events
    pub has_playable_events: bool,
}

/// Event filter flags (nested to match TypeScript interface).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct TrackFilters {
    pub note_filter: bool,
    pub aftertouch_filter: bool,
    pub cc_filter: bool,
    pub program_filter: bool,
    pub channel_pressure_filter: bool,
    pub pitch_wheel_filter: bool,
    pub sysex_filter: bool,
}

impl Default for TrackFilters {
    fn default() -> Self {
        Self {
            note_filter: false,
            aftertouch_filter: false,
            cc_filter: false,
            program_filter: false,
            channel_pressure_filter: false,
            pitch_wheel_filter: false,
            sysex_filter: false,
        }
    }
}

/// Parsed track config (14 bytes).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct TrackConfig {
    pub filters: TrackFilters,
    /// MIDI channel (byte +3 & 0x1F, 5 bits) — 0 = use slot index
    pub midi_channel: u8,
    /// MIDI port (byte +5, lo nibble)
    pub midi_port: u8,
    /// Note range low (byte +9, 0 = no filter)
    pub note_range_low: u8,
    /// Note range high (byte +10, 0 = no filter)
    pub note_range_high: u8,
}

impl Default for TrackConfig {
    fn default() -> Self {
        Self {
            filters: TrackFilters::default(),
            midi_channel: 0,
            midi_port: 0,
            note_range_low: 0,
            note_range_high: 0,
        }
    }
}

/// Boundary marker metadata.
#[derive(Debug, Clone)]
pub struct BoundaryInfo {
    /// Type A = 7FFFFFFF, Type B = 000FFFFF
    pub boundary_type: BoundaryType,
    /// Absolute offset in the file where this boundary starts
    pub file_offset: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoundaryType {
    A,
    B,
}

// ═══════════════════════════════════════════════════════════════════════
// PLAYBACK-ORIENTED TYPES
// ═══════════════════════════════════════════════════════════════════════

/// Top-level song data for playback/UI (derived from SonFile).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct SongData {
    pub tracks: Vec<Track>,
    pub patterns: Vec<Pattern>,
    pub active_pattern_index: usize,
    pub arrangement: Vec<ArrangementEntry>,
    pub ticks_per_beat: u16,
    pub ticks_per_measure: u16,
    pub total_ticks: u32,
    pub instrument_names: Vec<String>,
    pub tempo: u16,
    pub channel_config: ChannelConfig,
    pub header_config: HeaderConfig,
    pub track_groups: TrackGroupMapping,
}

/// A playable track (derived from TrackSlot for playback).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct Track {
    pub name: String,
    pub channel: u8,
    /// Original 0-indexed position within the pattern (0–15)
    pub track_index: u8,
    /// Parsed track config
    pub track_config: Option<TrackConfig>,
    pub events: Vec<TrackEvent>,
}

/// A pattern containing up to 16 tracks.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct Pattern {
    pub index: usize,
    pub name: String,
    pub tracks: Vec<Track>,
    pub total_ticks: u32,
}

/// Arrangement entry columns (matches TS interface {a, b, c, d}).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct ArrangementColumns {
    pub a: u8,
    pub b: u8,
    pub c: u8,
    pub d: u8,
}

/// An entry in the arrangement table.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct ArrangementEntry {
    /// 0-based pattern index
    pub pattern_index: usize,
    /// Starting bar number (1-based)
    pub bar: u32,
    /// Length in bars
    pub length: u32,
    /// Display name
    pub name: String,
    /// Pattern columns a/b/c/d (1-based, 0 = unused)
    pub columns: ArrangementColumns,
}

// ═══════════════════════════════════════════════════════════════════════
// EVENT TYPES — ALL 14 STATUS CATEGORIES
// ═══════════════════════════════════════════════════════════════════════

/// Complete event union — all event types from the .SON format.
#[derive(Debug, Clone)]
pub enum SonEvent {
    NoteOn(NoteOnEvent),
    NoteOff(NoteOffEvent),
    Aftertouch(AftertouchEvent),
    ControlChange(ControlChangeEvent),
    ProgramChange(ProgramChangeEvent),
    ChannelPressure(ChannelPressureEvent),
    PitchWheel(PitchWheelEvent),
    Meta(MetaEvent),
    BarMarker(BarMarkerEvent),
    TrackSetup(TrackSetupEvent),
    TrackConfigChange(TrackConfigChangeEvent),
    Notation(NotationEvent),
    SysEx(SysExEvent),
    Raw(RawEvent),
}

/// Subset of events relevant for MIDI playback.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
#[cfg_attr(feature = "wasm", serde(tag = "type"))]
pub enum TrackEvent {
    #[cfg_attr(feature = "wasm", serde(rename = "note_on"))]
    NoteOn(NoteOnEvent),
    #[cfg_attr(feature = "wasm", serde(rename = "note_off"))]
    NoteOff(NoteOffEvent),
    #[cfg_attr(feature = "wasm", serde(rename = "aftertouch"))]
    Aftertouch(AftertouchEvent),
    #[cfg_attr(feature = "wasm", serde(rename = "control_change"))]
    ControlChange(ControlChangeEvent),
    #[cfg_attr(feature = "wasm", serde(rename = "program_change"))]
    ProgramChange(ProgramChangeEvent),
    #[cfg_attr(feature = "wasm", serde(rename = "channel_pressure"))]
    ChannelPressure(ChannelPressureEvent),
    #[cfg_attr(feature = "wasm", serde(rename = "pitch_wheel"))]
    PitchWheel(PitchWheelEvent),
    #[cfg_attr(feature = "wasm", serde(rename = "sysex"))]
    SysEx(SysExEvent),
}

impl TrackEvent {
    pub fn tick(&self) -> u16 {
        match self {
            TrackEvent::NoteOn(e) => e.tick,
            TrackEvent::NoteOff(e) => e.tick,
            TrackEvent::Aftertouch(e) => e.tick,
            TrackEvent::ControlChange(e) => e.tick,
            TrackEvent::ProgramChange(e) => e.tick,
            TrackEvent::ChannelPressure(e) => e.tick,
            TrackEvent::PitchWheel(e) => e.tick,
            TrackEvent::SysEx(e) => e.tick,
        }
    }
}

impl SonEvent {
    pub fn tick(&self) -> u16 {
        match self {
            SonEvent::NoteOn(e) => e.tick,
            SonEvent::NoteOff(e) => e.tick,
            SonEvent::Aftertouch(e) => e.tick,
            SonEvent::ControlChange(e) => e.tick,
            SonEvent::ProgramChange(e) => e.tick,
            SonEvent::ChannelPressure(e) => e.tick,
            SonEvent::PitchWheel(e) => e.tick,
            SonEvent::Meta(e) => e.tick,
            SonEvent::BarMarker(e) => e.tick,
            SonEvent::TrackSetup(e) => e.tick,
            SonEvent::TrackConfigChange(e) => e.tick,
            SonEvent::Notation(e) => e.tick,
            SonEvent::SysEx(e) => e.tick,
            SonEvent::Raw(e) => e.tick,
        }
    }

    /// Returns true if this is a playable MIDI event.
    pub fn is_playable(&self) -> bool {
        matches!(
            self,
            SonEvent::NoteOn(_)
                | SonEvent::NoteOff(_)
                | SonEvent::Aftertouch(_)
                | SonEvent::ControlChange(_)
                | SonEvent::ProgramChange(_)
                | SonEvent::ChannelPressure(_)
                | SonEvent::PitchWheel(_)
                | SonEvent::SysEx(_)
        )
    }

    /// Convert to a TrackEvent if this is a playable MIDI event.
    pub fn to_track_event(&self) -> Option<TrackEvent> {
        match self {
            SonEvent::NoteOn(e) => Some(TrackEvent::NoteOn(e.clone())),
            SonEvent::NoteOff(e) => Some(TrackEvent::NoteOff(e.clone())),
            SonEvent::Aftertouch(e) => Some(TrackEvent::Aftertouch(e.clone())),
            SonEvent::ControlChange(e) => Some(TrackEvent::ControlChange(e.clone())),
            SonEvent::ProgramChange(e) => Some(TrackEvent::ProgramChange(e.clone())),
            SonEvent::ChannelPressure(e) => Some(TrackEvent::ChannelPressure(e.clone())),
            SonEvent::PitchWheel(e) => Some(TrackEvent::PitchWheel(e.clone())),
            SonEvent::SysEx(e) => Some(TrackEvent::SysEx(e.clone())),
            _ => None,
        }
    }
}

// ─── MIDI Events ──────────────────────────────────────────────────────

#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct NoteOnEvent {
    pub tick: u16,
    pub note: u8,
    pub velocity: u8,
    #[cfg_attr(feature = "wasm", serde(skip))]
    pub raw: Vec<u8>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct NoteOffEvent {
    pub tick: u16,
    pub note: u8,
    #[cfg_attr(feature = "wasm", serde(skip))]
    pub raw: Vec<u8>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct AftertouchEvent {
    pub tick: u16,
    pub note: u8,
    pub pressure: u8,
    #[cfg_attr(feature = "wasm", serde(skip))]
    pub raw: Vec<u8>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct ControlChangeEvent {
    pub tick: u16,
    pub controller: u8,
    pub value: u8,
    #[cfg_attr(feature = "wasm", serde(skip))]
    pub raw: Vec<u8>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct ProgramChangeEvent {
    pub tick: u16,
    pub program: u8,
    #[cfg_attr(feature = "wasm", serde(skip))]
    pub raw: Vec<u8>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct ChannelPressureEvent {
    pub tick: u16,
    pub pressure: u8,
    #[cfg_attr(feature = "wasm", serde(skip))]
    pub raw: Vec<u8>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct PitchWheelEvent {
    pub tick: u16,
    pub value: i16,
    #[cfg_attr(feature = "wasm", serde(skip))]
    pub raw: Vec<u8>,
}

// ─── Non-MIDI Events ──────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct MetaEvent {
    pub tick: u16,
    pub sub_type: u8,
    pub raw: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct BarMarkerEvent {
    pub tick: u16,
    pub raw: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct TrackSetupEvent {
    pub tick: u16,
    pub sub_type: u8,
    pub raw: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct TrackConfigChangeEvent {
    pub tick: u16,
    pub sub_type: u8,
    pub raw: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct NotationEvent {
    pub tick: u16,
    pub sub_type: u8,
    pub raw: Vec<u8>,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct SysExEvent {
    pub tick: u16,
    /// Reconstructed SysEx data (starts with 0xF0, ends with 0xF7)
    pub data: Vec<u8>,
    /// All raw 6-byte records in the chain
    #[cfg_attr(feature = "wasm", serde(skip))]
    pub raw_records: Vec<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct RawEvent {
    pub tick: u16,
    pub status: u8,
    pub raw: Vec<u8>,
}

// ═══════════════════════════════════════════════════════════════════════
// ERROR TYPE
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
pub enum ParseError {
    FileTooSmall { size: usize, minimum: usize },
    BadMagic { got: u16, expected: u16 },
    NoPatterns,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::FileTooSmall { size, minimum } => {
                write!(f, "File too small ({size} bytes, need at least {minimum})")
            }
            ParseError::BadMagic { got, expected } => {
                write!(f, "Bad magic: 0x{got:04X} (expected 0x{expected:04X})")
            }
            ParseError::NoPatterns => write!(f, "No patterns found"),
        }
    }
}

impl std::error::Error for ParseError {}
