//! Standard MIDI File (SMF Type 1) writer.
//!
//! Exports a SongData to a complete .mid file with:
//!   Track 0 = conductor (tempo map, time sig, song name)
//!   Tracks 1..N = MIDI data per Notator track (preserving track names)

use crate::types::*;

/// Export a SongData to Standard MIDI File bytes.
pub fn export_song_to_midi(song: &SongData, song_name: &str) -> Vec<u8> {
    let flat_tracks = flatten_arrangement(song);

    let mut track_chunks: Vec<Vec<u8>> = Vec::new();

    // Track 0: Conductor (tempo map + time signature)
    track_chunks.push(build_conductor_track(song, song_name));

    // Data tracks — grouped by Notator track (track_index + name)
    for flat_track in &flat_tracks {
        if flat_track.events.is_empty() {
            continue;
        }
        track_chunks.push(build_midi_track(
            &flat_track.events,
            flat_track.channel,
            &flat_track.name,
            song,
        ));
    }

    build_smf_file(song.ticks_per_beat, &track_chunks)
}

/// A flattened track with events at absolute tick positions.
struct FlatTrack {
    /// Notator track name (e.g., "kick", "snare")
    name: String,
    /// MIDI channel
    channel: u8,
    /// Events sorted by absolute tick
    events: Vec<FlatEvent>,
}

/// Flatten the arrangement into per-Notator-track event lists with absolute ticks.
///
/// Groups by (track_index, track_name) to preserve the original Notator
/// track structure, rather than merging by MIDI channel.
fn flatten_arrangement(song: &SongData) -> Vec<FlatTrack> {
    // Track key: (track_index_within_pattern, track_name)
    // We need stable ordering, so use a Vec of (key, events)
    let mut track_map: Vec<(u8, String, u8, Vec<FlatEvent>)> = Vec::new(); // (track_idx, name, channel, events)

    for entry in &song.arrangement {
        let pattern = song
            .patterns
            .iter()
            .find(|p| p.index == entry.pattern_index);
        let pattern = match pattern {
            Some(p) => p,
            None => continue,
        };

        // Use tick_position for precise absolute offset
        let tick_offset = entry.tick_position;
        let max_ticks = entry.length_ticks;

        for track in &pattern.tracks {
            let ch = track.channel & 0x0F;
            let track_idx = track.track_index;
            let track_name = track.name.clone();

            // Find or create the flat track entry
            let flat_track = track_map
                .iter_mut()
                .find(|(idx, name, _, _)| *idx == track_idx && *name == track_name);

            let events_vec = if let Some((_, _, _, events)) = flat_track {
                events
            } else {
                track_map.push((track_idx, track_name.clone(), ch, Vec::new()));
                &mut track_map.last_mut().unwrap().3
            };

            for event in &track.events {
                let tick = event.tick() as u32;
                if max_ticks > 0 && tick >= max_ticks {
                    continue; // Skip events beyond this entry's duration
                }
                events_vec.push(FlatEvent {
                    abs_tick: tick_offset + tick,
                    event: event.clone(),
                });
            }
        }
    }

    // Sort each track's events by absolute tick
    let mut result = Vec::new();
    for (_, name, channel, mut events) in track_map {
        events.sort_by_key(|e| e.abs_tick);
        if !events.is_empty() {
            result.push(FlatTrack {
                name: if name.trim().is_empty() {
                    format!("Ch {}", channel + 1)
                } else {
                    name
                },
                channel,
                events,
            });
        }
    }

    result
}

struct FlatEvent {
    abs_tick: u32,
    event: TrackEvent,
}

/// Build the conductor track (Track 0) with tempo map and time signature.
fn build_conductor_track(song: &SongData, song_name: &str) -> Vec<u8> {
    let mut events: Vec<(u32, Vec<u8>)> = Vec::new(); // (abs_tick, event_data)

    // Song name meta-event (FF 03) at tick 0
    let name_bytes = song_name.as_bytes();
    let mut name_event = vec![0xFF, 0x03];
    name_event.extend_from_slice(&vlq(name_bytes.len() as u32));
    name_event.extend_from_slice(name_bytes);
    events.push((0, name_event));

    // Time signature meta-event (FF 58 04) at tick 0
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
    events.push((0, vec![0xFF, 0x58, 0x04, beats_per_bar, 2, 24, 8]));

    // Tempo events from tempo map
    if song.tempo_map.is_empty() {
        // Fallback: single tempo from header
        let tempo = if song.tempo > 0 { song.tempo } else { 120 };
        let us_per_beat = 60_000_000u32 / (tempo as u32);
        events.push((
            0,
            vec![
                0xFF,
                0x51,
                0x03,
                ((us_per_beat >> 16) & 0xFF) as u8,
                ((us_per_beat >> 8) & 0xFF) as u8,
                (us_per_beat & 0xFF) as u8,
            ],
        ));
    } else {
        for tc in &song.tempo_map {
            let bpm = if tc.bpm > 0 { tc.bpm } else { 120 };
            let us_per_beat = 60_000_000u32 / (bpm as u32);
            events.push((
                tc.tick,
                vec![
                    0xFF,
                    0x51,
                    0x03,
                    ((us_per_beat >> 16) & 0xFF) as u8,
                    ((us_per_beat >> 8) & 0xFF) as u8,
                    (us_per_beat & 0xFF) as u8,
                ],
            ));
        }
    }

    // Sort by tick
    events.sort_by_key(|(tick, _)| *tick);

    // Build track data with delta times
    let mut data = Vec::new();
    let mut last_tick: u32 = 0;
    for (tick, event_data) in &events {
        let delta = tick.saturating_sub(last_tick);
        last_tick = *tick;
        data.extend_from_slice(&vlq(delta));
        data.extend_from_slice(event_data);
    }

    // End of track
    data.extend_from_slice(&vlq(0));
    data.extend_from_slice(&[0xFF, 0x2F, 0x00]);

    wrap_track_chunk(&data)
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
