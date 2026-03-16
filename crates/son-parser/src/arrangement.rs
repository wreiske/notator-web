//! Arrangement table parsing.
//!
//! The arrangement is stored as 24-byte entries starting at 0x20BE.
//! Each entry: byte 0 = pattern index (1-based), bytes 1-3 = tick position,
//! bytes 12-20 = name (9 chars), bytes 22-23 = signature (0x80, 0xD2).

use crate::header::u16be;
use crate::types::*;

const ARRANGE_TABLE_OFFSET: usize = 0x20BE;
const ARRANGE_ENTRY_SIZE: usize = 24;
const ARRANGE_SIG_0: u8 = 0x80;
const ARRANGE_SIG_1: u8 = 0xD2;

const DEFAULT_PATTERN_NAMES: &[&str] = &["Pattern:", "Name"];

/// Parse the arrangement table.
pub fn parse_arrangement(
    data: &[u8],
    patterns: &[Pattern],
    ticks_per_measure: u16,
) -> Vec<ArrangementEntry> {
    let mut entries = Vec::new();
    let off = ARRANGE_TABLE_OFFSET;

    // Check if the arrangement table exists (3 consecutive entries with signature)
    let has_table = if off + ARRANGE_ENTRY_SIZE * 3 <= data.len() {
        (0..3).all(|e| {
            let e_off = off + e * ARRANGE_ENTRY_SIZE;
            data[e_off + 22] == ARRANGE_SIG_0 && data[e_off + 23] == ARRANGE_SIG_1
        })
    } else {
        false
    };

    if has_table {
        // Read tick positions for bar-length detection
        let mut tick_positions: Vec<u32> = Vec::new();
        for e in 0..64 {
            let e_off = off + e * ARRANGE_ENTRY_SIZE;
            if e_off + ARRANGE_ENTRY_SIZE > data.len() {
                break;
            }
            let ac = data[e_off];
            if ac == 127 || ac == 0 {
                break;
            }
            let b1 = data[e_off + 1];
            let tp16 = u16be(data, e_off + 2) as u32;
            tick_positions.push((b1 as u32 & 0x01) * 0x10000 + tp16);
        }

        let mut ticks_per_bar: u32 = if ticks_per_measure > 0 {
            ticks_per_measure as u32
        } else {
            768
        };

        if tick_positions.len() >= 2 {
            let mut min_delta: u32 = u32::MAX;
            for i in 1..tick_positions.len() {
                let d = tick_positions[i].saturating_sub(tick_positions[i - 1]);
                if d > 0 && d < min_delta {
                    min_delta = d;
                }
            }
            if min_delta < u32::MAX && min_delta >= 48 {
                ticks_per_bar = min_delta;
            }
        }

        let mut base_tick: i64 = -1;

        for e in 0..64 {
            let e_off = off + e * ARRANGE_ENTRY_SIZE;
            if e_off + ARRANGE_ENTRY_SIZE > data.len() {
                break;
            }

            let a_col = data[e_off];
            let byte1 = data[e_off + 1];
            let tick_pos16 = u16be(data, e_off + 2) as u32;
            let page_bit = (byte1 as u32) & 0x01;
            let tick_pos = page_bit * 0x10000 + tick_pos16;

            // Read name (bytes 12-20, high-bit stripped)
            let mut name_chars = String::new();
            for j in 12..=20 {
                let b = data[e_off + j] & 0x7F;
                if (32..127).contains(&b) {
                    name_chars.push(b as char);
                }
            }
            let name = name_chars.trim().to_string();

            if a_col == 127 {
                break;
            }
            if a_col == 0 && (name == "stop" || name.is_empty()) {
                break;
            }

            if base_tick < 0 {
                base_tick = tick_pos as i64;
            }
            let bar = ((tick_pos as i64 - base_tick) as u32) / ticks_per_bar + 1;

            let pat = patterns.iter().find(|p| p.index == (a_col as usize) - 1);

            let is_default = DEFAULT_PATTERN_NAMES
                .iter()
                .any(|d| name.starts_with(d.trim_end_matches(':')));
            let display_name = if !name.is_empty() && !is_default {
                name
            } else {
                pat.map(|p| p.name.clone())
                    .unwrap_or_else(|| format!("Pattern {}", a_col))
            };

            entries.push(ArrangementEntry {
                pattern_index: (a_col as usize) - 1,
                bar,
                length: 1, // Will be recomputed below
                name: display_name,
                columns: ArrangementColumns { a: a_col, b: 0, c: 0, d: 0 },
            });
        }

        // Compute bar lengths from consecutive entry positions
        for i in 0..entries.len().saturating_sub(1) {
            entries[i].length = entries[i + 1].bar - entries[i].bar;
        }
        // Set last entry length
        if !entries.is_empty() {
            let last_len = if entries.len() > 1 {
                entries[entries.len() - 2].length.max(1)
            } else {
                4
            };
            entries.last_mut().unwrap().length = last_len;
        }
    }

    if entries.is_empty() {
        // Fallback: one entry per pattern
        let mut bar = 1u32;
        let tpm = if ticks_per_measure > 0 {
            ticks_per_measure as u32
        } else {
            768
        };
        for pat in patterns {
            if pat.tracks.is_empty() {
                continue;
            }
            let bar_length = ((pat.total_ticks + tpm - 1) / tpm).max(1);
            entries.push(ArrangementEntry {
                pattern_index: pat.index,
                bar,
                length: bar_length,
                name: pat.name.clone(),
                columns: ArrangementColumns { a: (pat.index + 1) as u8, b: 0, c: 0, d: 0 },
            });
            bar += bar_length;
        }
    }

    entries
}
