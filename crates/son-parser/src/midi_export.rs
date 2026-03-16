//! Standard MIDI File (SMF Type 1) writer.
//!
//! Exports a SongData to a complete .mid file with:
//!   Track 0 = conductor (tempo, time sig, song name)
//!   Tracks 1..N = MIDI data per channel

use crate::types::*;

/// Export a SongData to Standard MIDI File bytes.
pub fn export_song_to_midi(song: &SongData, song_name: &str) -> Vec<u8> {
    let flat_tracks = flatten_arrangement(song);

    let mut track_chunks: Vec<Vec<u8>> = Vec::new();

    // Track 0: Conductor
    track_chunks.push(build_conductor_track(song, song_name));

    // Data tracks
    for (ch, events) in &flat_tracks {
        if events.is_empty() {
            continue;
        }
        let track_name = format!("Ch {}", ch + 1);
        track_chunks.push(build_midi_track(events, *ch, &track_name, song));
    }

    build_smf_file(song.ticks_per_beat, &track_chunks)
}

/// Flatten the arrangement into per-channel event lists with absolute ticks.
fn flatten_arrangement(song: &SongData) -> Vec<(u8, Vec<FlatEvent>)> {
    let mut channel_events: Vec<Vec<FlatEvent>> = (0..16).map(|_| Vec::new()).collect();

    let ticks_per_bar = if song.ticks_per_measure > 0 {
        song.ticks_per_measure as u32
    } else {
        768
    };

    for entry in &song.arrangement {
        let pattern = song
            .patterns
            .iter()
            .find(|p| p.index == entry.pattern_index);
        let pattern = match pattern {
            Some(p) => p,
            None => continue,
        };

        let bar_offset = (entry.bar.saturating_sub(1)) * ticks_per_bar;
        let max_ticks = entry.length * ticks_per_bar;

        for track in &pattern.tracks {
            let ch = (track.channel as usize) & 0x0F;
            for event in &track.events {
                let tick = event.tick() as u32;
                if tick < max_ticks {
                    channel_events[ch].push(FlatEvent {
                        abs_tick: bar_offset + tick,
                        event: event.clone(),
                    });
                }
            }
        }
    }

    // Sort each channel by absolute tick
    for events in &mut channel_events {
        events.sort_by_key(|e| e.abs_tick);
    }

    channel_events
        .into_iter()
        .enumerate()
        .filter(|(_, events)| !events.is_empty())
        .map(|(ch, events)| (ch as u8, events))
        .collect()
}

struct FlatEvent {
    abs_tick: u32,
    event: TrackEvent,
}

/// Build the conductor track (Track 0).
fn build_conductor_track(song: &SongData, song_name: &str) -> Vec<u8> {
    let mut events = Vec::new();

    // Song name meta-event (FF 03)
    let name_bytes = song_name.as_bytes();
    events.extend_from_slice(&vlq(0));
    events.extend_from_slice(&[0xFF, 0x03]);
    events.extend_from_slice(&vlq(name_bytes.len() as u32));
    events.extend_from_slice(name_bytes);

    // Tempo meta-event (FF 51 03)
    let tempo = if song.tempo > 0 { song.tempo } else { 120 };
    let us_per_beat = (60_000_000u32) / (tempo as u32);
    events.extend_from_slice(&vlq(0));
    events.extend_from_slice(&[0xFF, 0x51, 0x03]);
    events.push(((us_per_beat >> 16) & 0xFF) as u8);
    events.push(((us_per_beat >> 8) & 0xFF) as u8);
    events.push((us_per_beat & 0xFF) as u8);

    // Time signature meta-event (FF 58 04)
    let tpm = if song.ticks_per_measure > 0 {
        song.ticks_per_measure
    } else {
        768
    };
    let tpb = if song.ticks_per_beat > 0 {
        song.ticks_per_beat
    } else {
        192
    };
    let beats_per_bar = (tpm as f32 / tpb as f32).round() as u8;
    events.extend_from_slice(&vlq(0));
    events.extend_from_slice(&[0xFF, 0x58, 0x04]);
    events.extend_from_slice(&[beats_per_bar, 2, 24, 8]);

    // End of track
    events.extend_from_slice(&vlq(0));
    events.extend_from_slice(&[0xFF, 0x2F, 0x00]);

    wrap_track_chunk(&events)
}

/// Build a MIDI data track from flat events.
fn build_midi_track(
    events: &[FlatEvent],
    channel: u8,
    track_name: &str,
    song: &SongData,
) -> Vec<u8> {
    let mut data = Vec::new();
    let ch = channel & 0x0F;

    // Track name (FF 03)
    let name_bytes = track_name.as_bytes();
    data.extend_from_slice(&vlq(0));
    data.extend_from_slice(&[0xFF, 0x03]);
    data.extend_from_slice(&vlq(name_bytes.len() as u32));
    data.extend_from_slice(name_bytes);

    // Initial channel setup
    let idx = ch as usize;
    if idx < song.channel_config.programs.len() {
        let program = song.channel_config.programs[idx];
        if program > 0 {
            data.extend_from_slice(&vlq(0));
            data.extend_from_slice(&[0xC0 | ch, program & 0x7F]);
        }
    }
    if idx < song.channel_config.volumes.len() {
        let volume = song.channel_config.volumes[idx];
        if volume > 0 {
            data.extend_from_slice(&vlq(0));
            data.extend_from_slice(&[0xB0 | ch, 0x07, volume & 0x7F]);
        }
    }
    if idx < song.channel_config.pans.len() {
        let pan = song.channel_config.pans[idx];
        if pan > 0 {
            data.extend_from_slice(&vlq(0));
            data.extend_from_slice(&[0xB0 | ch, 0x0A, pan & 0x7F]);
        }
    }

    // Events with delta times
    let mut last_tick: u32 = 0;
    for flat in events {
        let delta = flat.abs_tick.saturating_sub(last_tick);
        last_tick = flat.abs_tick;

        match &flat.event {
            TrackEvent::NoteOn(e) => {
                data.extend_from_slice(&vlq(delta));
                data.extend_from_slice(&[0x90 | ch, e.note & 0x7F, e.velocity & 0x7F]);
            }
            TrackEvent::NoteOff(e) => {
                data.extend_from_slice(&vlq(delta));
                data.extend_from_slice(&[0x80 | ch, e.note & 0x7F, 0x00]);
            }
            TrackEvent::Aftertouch(e) => {
                data.extend_from_slice(&vlq(delta));
                data.extend_from_slice(&[0xA0 | ch, e.note & 0x7F, e.pressure & 0x7F]);
            }
            TrackEvent::ControlChange(e) => {
                data.extend_from_slice(&vlq(delta));
                data.extend_from_slice(&[0xB0 | ch, e.controller & 0x7F, e.value & 0x7F]);
            }
            TrackEvent::ProgramChange(e) => {
                data.extend_from_slice(&vlq(delta));
                data.extend_from_slice(&[0xC0 | ch, e.program & 0x7F]);
            }
            TrackEvent::ChannelPressure(e) => {
                data.extend_from_slice(&vlq(delta));
                data.extend_from_slice(&[0xD0 | ch, e.pressure & 0x7F]);
            }
            TrackEvent::PitchWheel(e) => {
                let midi_val = (e.value as i32 + 8192).clamp(0, 16383) as u16;
                data.extend_from_slice(&vlq(delta));
                data.extend_from_slice(&[
                    0xE0 | ch,
                    (midi_val & 0x7F) as u8,
                    ((midi_val >> 7) & 0x7F) as u8,
                ]);
            }
            TrackEvent::SysEx(e) => {
                data.extend_from_slice(&vlq(delta));
                data.push(0xF0);
                // SysEx length (data after F0, including F7)
                let payload = if e.data.first() == Some(&0xF0) {
                    &e.data[1..]
                } else {
                    &e.data
                };
                data.extend_from_slice(&vlq(payload.len() as u32));
                data.extend_from_slice(payload);
            }
        }
    }

    // End of track
    data.extend_from_slice(&vlq(0));
    data.extend_from_slice(&[0xFF, 0x2F, 0x00]);

    wrap_track_chunk(&data)
}

/// Wrap track data in an MTrk chunk.
fn wrap_track_chunk(data: &[u8]) -> Vec<u8> {
    let mut chunk = Vec::with_capacity(8 + data.len());
    chunk.extend_from_slice(b"MTrk");
    let len = data.len() as u32;
    chunk.push(((len >> 24) & 0xFF) as u8);
    chunk.push(((len >> 16) & 0xFF) as u8);
    chunk.push(((len >> 8) & 0xFF) as u8);
    chunk.push((len & 0xFF) as u8);
    chunk.extend_from_slice(data);
    chunk
}

/// Build the complete SMF file from track chunks.
fn build_smf_file(ticks_per_beat: u16, tracks: &[Vec<u8>]) -> Vec<u8> {
    let num_tracks = tracks.len() as u16;
    let total_size: usize = 14 + tracks.iter().map(|t| t.len()).sum::<usize>();
    let mut output = Vec::with_capacity(total_size);

    // MThd header
    output.extend_from_slice(b"MThd");
    output.extend_from_slice(&[0x00, 0x00, 0x00, 0x06]); // header length
    output.extend_from_slice(&[0x00, 0x01]); // format type 1
    output.push(((num_tracks >> 8) & 0xFF) as u8);
    output.push((num_tracks & 0xFF) as u8);
    output.push(((ticks_per_beat >> 8) & 0xFF) as u8);
    output.push((ticks_per_beat & 0xFF) as u8);

    // Track chunks
    for track in tracks {
        output.extend_from_slice(track);
    }

    output
}

/// Encode a u32 value as a MIDI variable-length quantity.
fn vlq(mut value: u32) -> Vec<u8> {
    if value < 0x80 {
        return vec![value as u8];
    }
    let mut out = Vec::with_capacity(4);
    out.push((value & 0x7F) as u8);
    value >>= 7;
    while value > 0 {
        out.push(((value & 0x7F) | 0x80) as u8);
        value >>= 7;
    }
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vlq() {
        assert_eq!(vlq(0), vec![0x00]);
        assert_eq!(vlq(0x7F), vec![0x7F]);
        assert_eq!(vlq(0x80), vec![0x81, 0x00]);
        assert_eq!(vlq(0x3FFF), vec![0xFF, 0x7F]);
        assert_eq!(vlq(0x4000), vec![0x81, 0x80, 0x00]);
    }

    #[test]
    fn test_wrap_track_chunk() {
        let data = vec![0xFF, 0x2F, 0x00]; // End of track
        let chunk = wrap_track_chunk(&data);
        assert_eq!(&chunk[0..4], b"MTrk");
        assert_eq!(chunk[4..8], [0, 0, 0, 3]); // length
        assert_eq!(&chunk[8..], &data);
    }

    #[test]
    fn test_build_smf_header() {
        let tracks = vec![vec![0x4D, 0x54, 0x72, 0x6B, 0, 0, 0, 3, 0xFF, 0x2F, 0x00]];
        let output = build_smf_file(192, &tracks);
        assert_eq!(&output[0..4], b"MThd");
        assert_eq!(&output[8..10], &[0x00, 0x01]); // Type 1
        assert_eq!(&output[10..12], &[0x00, 0x01]); // 1 track
        assert_eq!(&output[12..14], &[0x00, 0xC0]); // 192 ticks
    }
}
