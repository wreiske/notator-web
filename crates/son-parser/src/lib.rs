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

use std::collections::HashMap;

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

    // Active pattern = first pattern
    let active_pattern = patterns.first();
    let active_tracks = active_pattern
        .map(|p| p.tracks.clone())
        .unwrap_or_default();
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
