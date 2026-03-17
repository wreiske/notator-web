//! Notator SL .SON file parser and MIDI exporter.
//!
//! # Targets
//! - **Native**: Use as a library or via the `son_to_midi` CLI binary.
//! - **WASM**: Build with `--features wasm` for browser use.

pub mod arrangement;
pub mod boundary;
pub mod events;
pub mod header;
pub mod midi_export;
pub mod patterns;
pub mod tracks;
pub mod types;

#[cfg(feature = "wasm")]
pub mod wasm;

use boundary::split_on_boundaries;
use header::parse_header;
use patterns::{build_patterns, parse_pattern_names};
use tracks::*;
use types::*;

use crate::tracks::PATTERN_TICK_OFFSET;
use std::collections::HashMap;

/// Extract tempo map from pattern events.
///
/// Scans all tracks in all patterns for tempo change events:
/// - Meta events (status 0x00) with sub-type 0x0F
/// - Notation events (status 0x70) with sub-type 1 (byte[0] == 1)
///
/// The embedded BPM is extracted from the raw event bytes.
/// For Notation sub-type 1: BPM is in raw bytes [4] (velocity field),
/// which stores the tempo value directly.
/// For Meta sub-type 0x0F: tempo value is encoded similarly.
fn extract_tempo_map(
    _patterns: &[Pattern],
    arrangement: &[ArrangementEntry],
    header_tempo: u16,
    track_slots: &[TrackSlot],
) -> Vec<TempoChange> {
    let mut tempo_map = Vec::new();

    // Always include the header tempo at tick 0
    tempo_map.push(TempoChange {
        tick: 0,
        bpm: header_tempo,
    });

    // Scan track slots for tempo change events in their full event list
    // We need the original SonEvents (including non-MIDI) to find tempo changes
    for (slot_group_idx, chunk) in track_slots.chunks(16).enumerate() {
        // Find the arrangement entry that references this pattern
        // to get the absolute tick offset
        let pattern_idx = slot_group_idx;

        for slot in chunk {
            for event in &slot.events {
                match event {
                    // Meta sub-type 0x0F = tempo change marker
                    SonEvent::Meta(meta) if meta.sub_type == 0x0F => {
                        // The tempo value in Notator's internal format
                        // Raw bytes: [note, status, pos_hi, pos_lo, velocity, arg]
                        // The velocity byte may carry the tempo
                        if meta.raw.len() >= 5 {
                            let raw_val = meta.raw[4];
                            if raw_val > 0 {
                                // Find all arrangement entries using this pattern
                                for entry in arrangement {
                                    if entry.pattern_index == pattern_idx {
                                        // Subtract the Notator 7680-tick pattern offset
                                        // since meta.tick includes it but tick_position is already absolute
                                        let pattern_tick =
                                            meta.tick.saturating_sub(PATTERN_TICK_OFFSET) as u32;
                                        let abs_tick = entry.tick_position + pattern_tick;
                                        tempo_map.push(TempoChange {
                                            tick: abs_tick,
                                            bpm: raw_val as u16,
                                        });
                                    }
                                }
                            }
                        }
                    }
                    // Notation sub-type 1 = inline tempo change
                    SonEvent::Notation(notation) if notation.sub_type == 1 => {
                        // For notation tempo changes, the BPM is in raw[4] (velocity field)
                        if notation.raw.len() >= 5 {
                            let raw_val = notation.raw[4];
                            if raw_val > 0 {
                                for entry in arrangement {
                                    if entry.pattern_index == pattern_idx {
                                        let pattern_tick =
                                            notation.tick.saturating_sub(PATTERN_TICK_OFFSET)
                                                as u32;
                                        let abs_tick = entry.tick_position + pattern_tick;
                                        tempo_map.push(TempoChange {
                                            tick: abs_tick,
                                            bpm: raw_val as u16,
                                        });
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    // Sort by tick position and deduplicate
    tempo_map.sort_by_key(|t| t.tick);
    tempo_map.dedup_by_key(|t| t.tick);

    tempo_map
}

/// Parse a .SON file into a complete SonFile (preserves raw data for round-trip).
pub fn parse_son_file(data: &[u8]) -> Result<SonFile, ParseError> {
    if data.len() < TRACK_DATA_OFFSET {
        if data.len() >= 2 {
            let magic = header::u16be(data, 0);
            if magic != header::MAGIC_EXPECTED {
                return Err(ParseError::BadMagic {
                    got: magic,
                    expected: header::MAGIC_EXPECTED,
                });
            }
        }
        return Err(ParseError::FileTooSmall {
            size: data.len(),
            minimum: TRACK_DATA_OFFSET,
        });
    }

    let hdr = parse_header(data);
    if hdr.magic != header::MAGIC_EXPECTED {
        return Err(ParseError::BadMagic {
            got: hdr.magic,
            expected: header::MAGIC_EXPECTED,
        });
    }

    let raw_header = data[..TRACK_DATA_OFFSET].to_vec();

    // Split on boundaries
    let boundary_scan_start =
        TRACK_POINTER_TABLE_OFFSET + 24 * TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE;
    let split = split_on_boundaries(data, boundary_scan_start);

    let track_slots: Vec<TrackSlot> = split
        .chunks
        .iter()
        .map(|chunk| parse_track_slot(chunk))
        .collect();

    // Build offset → slot index map
    let mut slot_by_offset: HashMap<u32, usize> = HashMap::new();
    for (idx, boundary) in split.boundaries.iter().enumerate() {
        if idx < track_slots.len() {
            let data_start = boundary.file_offset as u32 + 4;
            slot_by_offset.insert(data_start + 2, idx);
        }
    }

    let pattern_names = parse_pattern_names(data);
    let patterns = build_patterns(data, &hdr, &track_slots, &slot_by_offset, &pattern_names);
    let arrangement_entries =
        arrangement::parse_arrangement(data, &patterns, hdr.ticks_per_measure);

    // Extract tempo map from track events
    let tempo_map = extract_tempo_map(&patterns, &arrangement_entries, hdr.tempo, &track_slots);

    // Active pattern = first pattern
    let active_pattern = patterns.first();
    let active_tracks = active_pattern.map(|p| p.tracks.clone()).unwrap_or_default();
    let total_ticks = active_pattern.map(|p| p.total_ticks).unwrap_or(0);

    let song_data = SongData {
        tracks: active_tracks,
        patterns: patterns.clone(),
        active_pattern_index: 0,
        arrangement: arrangement_entries,
        ticks_per_beat: hdr.ticks_per_beat,
        ticks_per_measure: hdr.ticks_per_measure,
        total_ticks,
        instrument_names: hdr.instrument_names.clone(),
        tempo: hdr.tempo,
        channel_config: hdr.channel_config.clone(),
        header_config: hdr.header_config.clone(),
        track_groups: hdr.track_groups.clone(),
        tempo_map,
    };

    Ok(SonFile {
        raw_header,
        header: hdr,
        track_slots,
        boundaries: split.boundaries,
        pre_boundary_padding: split.pre_boundary_padding,
        pattern_names,
        song_data,
    })
}

/// Parse a .SON file and return only the SongData (for playback/UI).
pub fn parse_song_data(data: &[u8]) -> Result<SongData, ParseError> {
    Ok(parse_son_file(data)?.song_data)
}

/// Export song data to Standard MIDI File bytes.
pub fn export_to_midi(song: &SongData, name: &str) -> Vec<u8> {
    midi_export::export_song_to_midi(song, name)
}
