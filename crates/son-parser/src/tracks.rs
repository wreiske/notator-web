//! Track slot parsing, config parsing, and pointer table reading.

use crate::events::parse_all_events;
use crate::header::{decode_ascii, u16be};
use crate::types::*;

// Track structure sizes
pub const TRACK_HEADER_SIZE: usize = 24;
pub const TRACK_NAME_SIZE: usize = 8;
pub const TRACK_CONFIG_SIZE: usize = 14;
pub const TRACK_PREAMBLE: usize = TRACK_HEADER_SIZE + TRACK_NAME_SIZE + TRACK_CONFIG_SIZE; // 46
pub const TRACKS_PER_PATTERN: usize = 16;

// Pointer table
pub const TRACK_POINTER_TABLE_OFFSET: usize = 0x0502;
pub const TRACK_POINTER_ENTRY_SIZE: usize = 4;
pub const EMPTY_TRACK_POINTER: u32 = 0x1D40;
pub const TRACK_DATA_OFFSET: usize = 0x5AC8;

/// Parse a track data chunk into a TrackSlot.
pub fn parse_track_slot(chunk: &[u8]) -> TrackSlot {
    if chunk.len() < TRACK_PREAMBLE {
        return TrackSlot {
            raw_header: chunk[..chunk.len().min(TRACK_HEADER_SIZE)].to_vec(),
            name: String::new(),
            raw_name: vec![0u8; TRACK_NAME_SIZE],
            raw_config: vec![0u8; TRACK_CONFIG_SIZE],
            config: TrackConfig::default(),
            events: Vec::new(),
            has_playable_events: false,
        };
    }

    let raw_header = chunk[..TRACK_HEADER_SIZE].to_vec();
    let raw_name = chunk[TRACK_HEADER_SIZE..TRACK_HEADER_SIZE + TRACK_NAME_SIZE].to_vec();
    let raw_config = chunk[TRACK_HEADER_SIZE + TRACK_NAME_SIZE..TRACK_PREAMBLE].to_vec();
    let event_data = &chunk[TRACK_PREAMBLE..];

    let name = decode_ascii(&raw_name, 0, raw_name.len());
    let config = parse_track_config(&raw_config);
    let events = parse_all_events(event_data);
    let has_playable = events.iter().any(|e| e.is_playable());

    TrackSlot {
        raw_header,
        name,
        raw_name,
        raw_config,
        config,
        events,
        has_playable_events: has_playable,
    }
}

/// Parse the 14-byte track config block.
pub fn parse_track_config(raw: &[u8]) -> TrackConfig {
    let filter_byte = raw.get(1).copied().unwrap_or(0);
    let channel_byte = raw.get(3).copied().unwrap_or(0);
    let port_byte = raw.get(5).copied().unwrap_or(0);

    TrackConfig {
        filters: TrackFilters {
            note_filter: (filter_byte & 0x02) != 0,
            aftertouch_filter: (filter_byte & 0x04) != 0,
            cc_filter: (filter_byte & 0x08) != 0,
            program_filter: (filter_byte & 0x10) != 0,
            channel_pressure_filter: (filter_byte & 0x20) != 0,
            pitch_wheel_filter: (filter_byte & 0x40) != 0,
            sysex_filter: (filter_byte & 0x80) != 0,
        },
        midi_channel: channel_byte & 0x1F,
        midi_port: port_byte & 0x0F,
        note_range_low: raw.get(9).copied().unwrap_or(0),
        note_range_high: raw.get(10).copied().unwrap_or(0),
    }
}

/// Read the full 32-bit track pointer for pattern p, track t.
pub fn read_track_pointer(data: &[u8], p: usize, t: usize) -> u32 {
    let entry_offset = TRACK_POINTER_TABLE_OFFSET
        + p * TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE
        + t * TRACK_POINTER_ENTRY_SIZE;

    if entry_offset + 4 > data.len() {
        return 0;
    }

    let ptr_low = u16be(data, entry_offset) as u32;

    let ptr_high: u32 = if t > 0 {
        let prev_offset = entry_offset - TRACK_POINTER_ENTRY_SIZE;
        u16be(data, prev_offset + 2) as u32
    } else if p > 0 {
        let prev_row_last = TRACK_POINTER_TABLE_OFFSET
            + (p - 1) * TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE
            + (TRACKS_PER_PATTERN - 1) * TRACK_POINTER_ENTRY_SIZE;
        if prev_row_last + 4 <= data.len() {
            u16be(data, prev_row_last + 2) as u32
        } else {
            0
        }
    } else {
        // For the very first entry (p=0, t=0): initial high word at 0x0500
        let init_high_offset = TRACK_POINTER_TABLE_OFFSET - 2;
        if init_high_offset + 2 <= data.len() {
            u16be(data, init_high_offset) as u32
        } else {
            0
        }
    };

    (ptr_high << 16) | ptr_low
}

/// Check if a pointer value represents an empty track.
#[inline]
pub fn is_empty_pointer(ptr: u32) -> bool {
    ptr == EMPTY_TRACK_POINTER || ptr == 0
}

/// Convert a TrackSlot to a playable Track (or None if no playable events).
pub fn slot_to_track(slot: &TrackSlot, track_index: u8, header: &SonHeader) -> Option<Track> {
    if !slot.has_playable_events {
        return None;
    }

    let midi_events: Vec<TrackEvent> = slot
        .events
        .iter()
        .filter_map(|e| e.to_track_event())
        .collect();

    if midi_events.is_empty() {
        return None;
    }

    // Resolve MIDI channel
    let mut channel = track_index;
    let header_ch_byte = slot.raw_header.get(5).copied().unwrap_or(0);

    if header_ch_byte > 0 && header_ch_byte <= 16 {
        channel = header_ch_byte - 1; // Convert 1-based to 0-based
    } else if slot.config.midi_channel > 0 {
        channel = slot.config.midi_channel - 1;
    } else {
        let idx = track_index as usize;
        if idx < header.channel_config.channels.len()
            && header.channel_config.channels[idx] <= 15
        {
            channel = header.channel_config.channels[idx];
        }
    }

    // Drums detection
    let is_drums = channel == 9
        || slot
            .name
            .to_lowercase()
            .contains("drum")
        || slot
            .name
            .to_lowercase()
            .contains("percuss")
        || track_index == 9;
    if is_drums {
        channel = 9;
    }

    Some(Track {
        name: slot.name.clone(),
        channel,
        track_index,
        track_config: Some(slot.config.clone()),
        events: midi_events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_empty_pointer() {
        assert!(is_empty_pointer(0x1D40));
        assert!(is_empty_pointer(0));
        assert!(!is_empty_pointer(0x5AC8));
    }

    #[test]
    fn test_parse_track_config_default() {
        let raw = vec![0u8; 14];
        let config = parse_track_config(&raw);
        assert_eq!(config.midi_channel, 0);
        assert!(!config.filters.note_filter);
    }

    #[test]
    fn test_parse_track_slot_too_small() {
        let chunk = vec![0u8; 10];
        let slot = parse_track_slot(&chunk);
        assert_eq!(slot.name, "");
        assert!(slot.events.is_empty());
        assert!(!slot.has_playable_events);
    }
}
