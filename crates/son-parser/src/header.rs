//! Header parsing for .SON files.
//!
//! Reads all header fields from the raw binary data at fixed offsets.

use crate::types::*;

// Header field offsets
pub const MAGIC_EXPECTED: u16 = 0x3B9E;
const TEMPO_OFFSET: usize = 0x0006;
const TICKS_PER_MEASURE_OFFSET: usize = 0x0022;
const INSTRUMENT_NAMES_OFFSET: usize = 0x0064;
const INSTRUMENT_NAME_LENGTH: usize = 9;
const MAX_INSTRUMENTS: usize = 16;
const CHANNEL_MAP_OFFSET: usize = 0x0330;
const PROGRAM_MAP_OFFSET: usize = 0x0340;
const VOLUME_MAP_OFFSET: usize = 0x0350;
const PAN_MAP_OFFSET: usize = 0x0360;
const EXTENDED_HEADER_OFFSET: usize = 0x0008;
const TRACK_GROUP_OFFSET: usize = 0x0330;

/// Read a big-endian u16 from data at offset.
#[inline]
pub fn u16be(data: &[u8], offset: usize) -> u16 {
    ((data[offset] as u16) << 8) | (data[offset + 1] as u16)
}

/// Decode ASCII bytes, stopping at null, replacing non-printable with space.
pub fn decode_ascii(data: &[u8], offset: usize, length: usize) -> String {
    let mut chars = Vec::with_capacity(length);
    for i in 0..length {
        if offset + i >= data.len() {
            break;
        }
        let b = data[offset + i];
        if b == 0 {
            break;
        }
        if (32..127).contains(&b) {
            chars.push(b as char);
        } else {
            chars.push(' ');
        }
    }
    chars.iter().collect::<String>().trim().to_string()
}

/// Parse the .SON file header from raw data.
pub fn parse_header(data: &[u8]) -> SonHeader {
    let magic = u16be(data, 0);
    let tempo = {
        let t = u16be(data, TEMPO_OFFSET);
        if t == 0 { 120 } else { t }
    };
    let ticks_per_measure = {
        let t = u16be(data, TICKS_PER_MEASURE_OFFSET);
        if t == 0 { 768 } else { t }
    };
    let ticks_per_beat = ticks_per_measure / 4;

    // Instrument names (16 × 9 bytes at 0x0064)
    let mut instrument_names = Vec::with_capacity(MAX_INSTRUMENTS);
    for i in 0..MAX_INSTRUMENTS {
        let offset = INSTRUMENT_NAMES_OFFSET + i * INSTRUMENT_NAME_LENGTH;
        if offset + INSTRUMENT_NAME_LENGTH > data.len() {
            break;
        }
        instrument_names.push(decode_ascii(data, offset, INSTRUMENT_NAME_LENGTH));
    }

    // Channel configuration
    let channel_config = ChannelConfig {
        channels: data[CHANNEL_MAP_OFFSET..CHANNEL_MAP_OFFSET + MAX_INSTRUMENTS].to_vec(),
        programs: data[PROGRAM_MAP_OFFSET..PROGRAM_MAP_OFFSET + MAX_INSTRUMENTS].to_vec(),
        volumes: data[VOLUME_MAP_OFFSET..VOLUME_MAP_OFFSET + MAX_INSTRUMENTS].to_vec(),
        pans: data[PAN_MAP_OFFSET..PAN_MAP_OFFSET + MAX_INSTRUMENTS].to_vec(),
    };

    // Extended header config (0x0008–0x0021)
    let flags_byte = data.get(0x000A).copied().unwrap_or(0);
    let header_config = HeaderConfig {
        quantize_value: u16be(data, EXTENDED_HEADER_OFFSET),
        loop_enabled: (flags_byte & 0x01) != 0,
        auto_quantize: (flags_byte & 0x02) != 0,
        flags_byte,
        click_track: data.get(0x000B).copied().unwrap_or(0) != 0,
        metronome_prescale: data.get(0x000C).copied().unwrap_or(0),
        precount_bars: data.get(0x000D).copied().unwrap_or(0),
        active_track_mask: u16be(data, 0x000E),
        display_mode: data.get(0x0010).copied().unwrap_or(0),
    };

    // Track group mapping (0x0330–0x036F)
    let track_groups = TrackGroupMapping {
        groups: data[TRACK_GROUP_OFFSET..TRACK_GROUP_OFFSET + MAX_INSTRUMENTS].to_vec(),
    };

    SonHeader {
        magic,
        tempo,
        ticks_per_measure,
        ticks_per_beat,
        instrument_names,
        channel_config,
        header_config,
        track_groups,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_u16be() {
        assert_eq!(u16be(&[0x3B, 0x9E], 0), 0x3B9E);
        assert_eq!(u16be(&[0x00, 0x44, 0x03, 0x00], 2), 0x0300);
    }

    #[test]
    fn test_decode_ascii() {
        assert_eq!(decode_ascii(&[b'k', b'i', b'c', b'k', 0, 0, 0, 0], 0, 8), "kick");
        assert_eq!(decode_ascii(&[b' ', b' ', 0, 0], 0, 4), "");
        assert_eq!(decode_ascii(&[b'A', 0xFF, b'B', 0], 0, 4), "A B");
    }
}
