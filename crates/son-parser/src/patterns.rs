//! Pattern building from the pointer table and track slots.

use crate::header::decode_ascii;
use crate::tracks::*;
use crate::types::*;
use std::collections::HashMap;

const PATTERN_NAME_TABLE_OFFSET: usize = 0x21BE;
const MAX_PATTERN_NAMES: usize = 16;
const PATTERN_NAME_SIZE: usize = 8;
const DEFAULT_PATTERN_NAMES: &[&str] = &["Pattern:", "Name"];

/// Parse pattern names from the name table at 0x21BE.
pub fn parse_pattern_names(data: &[u8]) -> Vec<String> {
    let off = PATTERN_NAME_TABLE_OFFSET;
    if off + PATTERN_NAME_SIZE > data.len() {
        return Vec::new();
    }

    // Validate entry[0] is printable ASCII
    for j in 0..PATTERN_NAME_SIZE {
        let b = data[off + j];
        if b == 0 {
            break;
        }
        if b < 0x20 || b >= 0x7F {
            return Vec::new();
        }
    }

    let first_entry = decode_ascii(data, off, PATTERN_NAME_SIZE);
    let valid = DEFAULT_PATTERN_NAMES
        .iter()
        .any(|d| first_entry == *d || first_entry.starts_with(d.trim_end_matches(':')));

    if !valid {
        return Vec::new();
    }

    let mut names = Vec::with_capacity(MAX_PATTERN_NAMES);
    for i in 0..MAX_PATTERN_NAMES {
        let name_off = off + i * PATTERN_NAME_SIZE;
        if name_off + PATTERN_NAME_SIZE > data.len() {
            break;
        }
        names.push(decode_ascii(data, name_off, PATTERN_NAME_SIZE));
    }
    names
}

/// Build patterns from track slots and pointer table.
pub fn build_patterns(
    data: &[u8],
    header: &SonHeader,
    track_slots: &[TrackSlot],
    slot_by_offset: &HashMap<u32, usize>,
    pattern_names: &[String],
) -> Vec<Pattern> {
    // Determine number of patterns from pointer table
    let max_table_patterns = (TRACK_DATA_OFFSET - TRACK_POINTER_TABLE_OFFSET)
        / (TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE);

    let mut num_patterns: usize = 0;
    let mut pointer_table_resolves = false;

    for p in 0..max_table_patterns {
        let mut has_entry = false;
        for t in 0..TRACKS_PER_PATTERN {
            let ptr = read_track_pointer(data, p, t);
            if !is_empty_pointer(ptr) {
                has_entry = true;
                if slot_by_offset.contains_key(&ptr) {
                    pointer_table_resolves = true;
                }
                break;
            }
        }
        if has_entry {
            num_patterns = p + 1;
        }
    }

    if num_patterns == 0 {
        num_patterns = ((track_slots.len() + TRACKS_PER_PATTERN - 1) / TRACKS_PER_PATTERN).max(1);
    }

    let has_pointer_table = pointer_table_resolves;
    let mut patterns = Vec::new();

    for p in 0..num_patterns {
        let mut pattern_tracks: Vec<Track> = Vec::new();
        let mut pattern_slot_names: Vec<Option<String>> = Vec::new();

        for t in 0..TRACKS_PER_PATTERN {
            let slot: Option<&TrackSlot> = if has_pointer_table {
                let ptr = read_track_pointer(data, p, t);
                if !is_empty_pointer(ptr) {
                    slot_by_offset
                        .get(&ptr)
                        .and_then(|&idx| track_slots.get(idx))
                } else {
                    None
                }
            } else {
                let slot_idx = p * TRACKS_PER_PATTERN + t;
                track_slots.get(slot_idx)
            };

            if let Some(slot) = slot {
                pattern_slot_names.push(Some(slot.name.clone()));
                if let Some(track) = slot_to_track(slot, t as u8, header) {
                    pattern_tracks.push(track);
                } else {
                    pattern_tracks.push(Track {
                        name: slot.name.clone(),
                        channel: t as u8,
                        track_index: t as u8,
                        track_config: Some(slot.config.clone()),
                        events: Vec::new(),
                    });
                }
            } else {
                pattern_slot_names.push(None);
                pattern_tracks.push(Track {
                    name: String::new(),
                    channel: t as u8,
                    track_index: t as u8,
                    track_config: None,
                    events: Vec::new(),
                });
            }
        }

        // Pattern naming
        let table_name_idx = p + 1; // 1-based: entry[0] is default
        let table_name = pattern_names.get(table_name_idx).cloned();
        let is_default = table_name.as_ref().map_or(true, |n| {
            DEFAULT_PATTERN_NAMES
                .iter()
                .any(|d| n.starts_with(d.trim_end_matches(':')))
        });

        let pat_name = if !is_default {
            table_name.unwrap()
        } else {
            // Fall back to first named track
            let mut name = format!("Pattern {}", p + 1);
            for slot_name in &pattern_slot_names {
                if let Some(sn) = slot_name {
                    let trimmed = sn.trim();
                    if !trimmed.is_empty() && trimmed != "Name" {
                        name = trimmed.to_string();
                        break;
                    }
                }
            }
            name
        };

        let total_ticks = pattern_tracks
            .iter()
            .flat_map(|t| t.events.last())
            .map(|e| e.tick() as u32)
            .max()
            .unwrap_or(0);

        let has_any_events = pattern_tracks.iter().any(|t| !t.events.is_empty());
        if has_any_events {
            patterns.push(Pattern {
                index: p,
                name: pat_name,
                tracks: pattern_tracks,
                total_ticks,
            });
        }
    }

    patterns
}
