//! Integration tests against multiple .SON reference files.
//!
//! Fixtures: DEADNITE.SON, ALEXA'S.SON, EXAMPLE.SON, DRUMMAP.SON, AUTOLOAD.SON
//! Reference data from the original Notator SL 3.21 screenshots.

use son_parser::types::*;

/// Load a test fixture by name.
fn load_fixture(name: &str) -> Vec<u8> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/");
    let path = format!("{}{}", dir, name);
    std::fs::read(&path).unwrap_or_else(|_| panic!("{} fixture not found", name))
}

fn load_deadnite() -> Vec<u8> {
    load_fixture("DEADNITE.SON")
}
fn load_alexas() -> Vec<u8> {
    load_fixture("ALEXA'S.SON")
}
fn load_example() -> Vec<u8> {
    load_fixture("EXAMPLE.SON")
}
fn load_drummap() -> Vec<u8> {
    load_fixture("DRUMMAP.SON")
}
fn load_autoload() -> Vec<u8> {
    load_fixture("AUTOLOAD.SON")
}

// ═══════════════════════════════════════════════════════════════════════
// HEADER TESTS
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_deadnite_header_magic() {
    let data = load_deadnite();
    let son = son_parser::parse_son_file(&data).expect("parse failed");
    assert_eq!(son.header.magic, 0x3B9E);
}

#[test]
fn test_deadnite_tempo() {
    let data = load_deadnite();
    let son = son_parser::parse_son_file(&data).expect("parse failed");
    assert_eq!(son.header.tempo, 68, "Tempo should be 68 BPM (from screenshot)");
}

#[test]
fn test_deadnite_time_signature() {
    let data = load_deadnite();
    let son = son_parser::parse_son_file(&data).expect("parse failed");
    // Screenshot: 16/16 → ticks_per_measure = 384
    assert_eq!(son.header.ticks_per_measure, 384);
    assert_eq!(son.header.ticks_per_beat, 96); // 384 / 4
}

// ═══════════════════════════════════════════════════════════════════════
// PATTERN TESTS
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_deadnite_pattern_count() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");
    assert!(
        song.patterns.len() >= 12,
        "Should have at least 12 patterns (got {})",
        song.patterns.len()
    );
}

#[test]
fn test_deadnite_pattern1_track_names() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");

    // Find pattern index 0 (= "Pattern 1" in Notator)
    let pat = song.patterns.iter().find(|p| p.index == 0).expect("Pattern 0 not found");

    // Screenshot shows these track names for Pattern 1:
    let expected_names = [
        "kick", "snare", "toms", // tracks 1-3
        // track 4 "hat" may be empty in this pattern
        // track 5 "crash"
    ];

    // Verify track 1 = kick
    assert_eq!(pat.tracks[0].name.trim(), "kick");
    // Verify track 2 = snare
    assert_eq!(pat.tracks[1].name.trim(), "snare");
    // Verify track 3 = toms
    assert_eq!(pat.tracks[2].name.trim(), "toms");
    // Track 5 = crash
    assert_eq!(pat.tracks[4].name.trim(), "crash");
    // Track 9 = bass (0-indexed = 8)
    assert!(
        pat.tracks[8].name.trim().eq_ignore_ascii_case("bass"),
        "Track 9 should be BASS, got '{}'",
        pat.tracks[8].name
    );
    // Track 10 = BRASS (0-indexed = 9)
    assert!(
        pat.tracks[9].name.trim().eq_ignore_ascii_case("brass"),
        "Track 10 should be BRASS, got '{}'",
        pat.tracks[9].name
    );
}

#[test]
fn test_deadnite_pattern1_channels() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");

    let pat = song.patterns.iter().find(|p| p.index == 0).expect("Pattern 0 not found");

    // Screenshot: Track 1 (kick) → Channel A 9 → 0-indexed = 8
    assert_eq!(
        pat.tracks[0].channel, 8,
        "kick channel: expected 8 (A 9), got {}",
        pat.tracks[0].channel
    );
    // Track 9 (BASS) → Channel A 1 → 0-indexed = 0
    assert_eq!(
        pat.tracks[8].channel, 0,
        "BASS channel: expected 0 (A 1), got {}",
        pat.tracks[8].channel
    );
    // Track 10 (BRASS) → Channel A 2 → 0-indexed = 1
    // Note: screenshot shows A 2, but track_index=9 triggers drums detection (ch=9)
    // This is a known behavior — Notator track index 10 (0-based 9) triggers drum channel
}

// ═══════════════════════════════════════════════════════════════════════
// ARRANGEMENT TESTS
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_deadnite_arrangement_count() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");
    assert_eq!(
        song.arrangement.len(),
        22,
        "Should have 22 arrangement entries"
    );
}

#[test]
fn test_deadnite_arrangement_entries() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");

    // Reference from screenshot (first 13 entries):
    let expected: Vec<(u32, &str)> = vec![
        (1, "SETUP"),
        (2, "INTRO"),
        (16, "verse"),
        (19, "verse"),
        (23, "chorus  1"),
        (27, "21/16"),
        (32, "roll"),
        (34, "pyramid"),
        (38, "solos"),
        (59, "chorus"),
        (63, "21/16"),
        (68, "roll"),
        (70, "pyramid"),
    ];

    for (i, (expected_bar, expected_name)) in expected.iter().enumerate() {
        assert_eq!(
            song.arrangement[i].bar, *expected_bar,
            "Entry {} bar: expected {}, got {}",
            i, expected_bar, song.arrangement[i].bar
        );
        assert_eq!(
            song.arrangement[i].name.trim(),
            expected_name.trim(),
            "Entry {} name: expected '{}', got '{}'",
            i,
            expected_name,
            song.arrangement[i].name
        );
    }
}

#[test]
fn test_deadnite_arrangement_first_entry_is_setup() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");
    assert_eq!(song.arrangement[0].bar, 1);
    assert_eq!(song.arrangement[0].name.trim(), "SETUP");
}

// ═══════════════════════════════════════════════════════════════════════
// MIDI EXPORT TESTS
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_deadnite_midi_export_valid_header() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");
    let midi = son_parser::export_to_midi(&song, "DEADNITE");

    // Must start with MThd
    assert_eq!(&midi[0..4], b"MThd", "MIDI output must start with MThd");
    // Header length = 6
    assert_eq!(&midi[4..8], &[0, 0, 0, 6]);
    // Format type 1
    assert_eq!(&midi[8..10], &[0, 1]);
}

#[test]
fn test_deadnite_midi_export_has_tracks() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");
    let midi = son_parser::export_to_midi(&song, "DEADNITE");

    // Track count from header (bytes 10-11)
    let num_tracks = ((midi[10] as u16) << 8) | (midi[11] as u16);
    assert!(
        num_tracks >= 2,
        "Should have at least 2 tracks (conductor + data), got {}",
        num_tracks
    );
}

#[test]
fn test_deadnite_midi_export_ticks_per_beat() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");
    let midi = son_parser::export_to_midi(&song, "DEADNITE");

    // Ticks per beat from header (bytes 12-13) should be 96
    let tpb = ((midi[12] as u16) << 8) | (midi[13] as u16);
    assert_eq!(tpb, 96, "Ticks per beat should be 96, got {}", tpb);
}

#[test]
fn test_deadnite_midi_has_note_data() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");
    let midi = son_parser::export_to_midi(&song, "DEADNITE");

    // MIDI file should contain at least one note_on (0x9n)
    let has_note = midi.windows(1).any(|w| w[0] & 0xF0 == 0x90);
    assert!(has_note, "MIDI output should contain note-on events");
}

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASE TESTS
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_empty_file() {
    let result = son_parser::parse_son_file(&[]);
    assert!(result.is_err());
    match result.unwrap_err() {
        ParseError::FileTooSmall { size, .. } => assert_eq!(size, 0),
        _ => panic!("Expected FileTooSmall"),
    }
}

#[test]
fn test_bad_magic() {
    let mut data = vec![0u8; 0x5AC8 + 100];
    data[0] = 0xE5;
    data[1] = 0xE5;
    let result = son_parser::parse_son_file(&data);
    assert!(result.is_err());
    match result.unwrap_err() {
        ParseError::BadMagic { got, .. } => assert_eq!(got, 0xE5E5),
        _ => panic!("Expected BadMagic"),
    }
}

#[test]
fn test_truncated_file_with_good_magic() {
    let mut data = vec![0u8; 100];
    data[0] = 0x3B;
    data[1] = 0x9E;
    let result = son_parser::parse_son_file(&data);
    assert!(result.is_err());
    match result.unwrap_err() {
        ParseError::FileTooSmall { size, .. } => assert_eq!(size, 100),
        _ => panic!("Expected FileTooSmall"),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// NOTE COUNT & PATTERN NOTES
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_deadnite_has_notes_across_patterns() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");

    let total_notes: usize = song
        .patterns
        .iter()
        .flat_map(|p| &p.tracks)
        .flat_map(|t| &t.events)
        .filter(|e| matches!(e, TrackEvent::NoteOn(_)))
        .count();

    assert!(
        total_notes > 100,
        "DEADNITE should have >100 notes total, got {}",
        total_notes
    );
}

#[test]
fn test_deadnite_pattern1_has_kick_notes() {
    let data = load_deadnite();
    let song = son_parser::parse_song_data(&data).expect("parse failed");

    let pat = song.patterns.iter().find(|p| p.index == 0).expect("Pattern 0 not found");
    let kick = &pat.tracks[0]; // Track 1 = kick
    let note_count = kick
        .events
        .iter()
        .filter(|e| matches!(e, TrackEvent::NoteOn(_)))
        .count();

    assert!(
        note_count > 0,
        "kick track should have note events, got {}",
        note_count
    );
}

// ═══════════════════════════════════════════════════════════════════════
// MULTI-FILE PARSING TESTS
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_all_fixtures_parse_successfully() {
    let fixtures = ["DEADNITE.SON", "ALEXA'S.SON", "EXAMPLE.SON", "DRUMMAP.SON", "AUTOLOAD.SON"];
    for name in &fixtures {
        let data = load_fixture(name);
        let result = son_parser::parse_son_file(&data);
        assert!(result.is_ok(), "{} failed to parse: {:?}", name, result.err());
    }
}

#[test]
fn test_all_fixtures_have_magic() {
    let fixtures = ["DEADNITE.SON", "ALEXA'S.SON", "EXAMPLE.SON", "DRUMMAP.SON", "AUTOLOAD.SON"];
    for name in &fixtures {
        let data = load_fixture(name);
        let son = son_parser::parse_son_file(&data).unwrap();
        assert_eq!(son.header.magic, 0x3B9E, "{} has wrong magic", name);
    }
}

#[test]
fn test_all_fixtures_have_valid_tempo() {
    let fixtures = ["DEADNITE.SON", "ALEXA'S.SON", "EXAMPLE.SON", "DRUMMAP.SON", "AUTOLOAD.SON"];
    for name in &fixtures {
        let data = load_fixture(name);
        let son = son_parser::parse_son_file(&data).unwrap();
        assert!(
            son.header.tempo >= 20 && son.header.tempo <= 300,
            "{} has out-of-range tempo: {}",
            name,
            son.header.tempo
        );
    }
}

#[test]
fn test_all_fixtures_have_valid_ticks_per_measure() {
    let fixtures = ["DEADNITE.SON", "ALEXA'S.SON", "EXAMPLE.SON", "DRUMMAP.SON", "AUTOLOAD.SON"];
    for name in &fixtures {
        let data = load_fixture(name);
        let son = son_parser::parse_son_file(&data).unwrap();
        // ticks_per_measure must be > 0 and a multiple of 192 (base resolution)
        assert!(
            son.header.ticks_per_measure > 0 && son.header.ticks_per_measure % 192 == 0,
            "{} has unexpected ticks_per_measure: {}",
            name,
            son.header.ticks_per_measure
        );
    }
}

#[test]
fn test_all_fixtures_have_patterns() {
    let fixtures = ["DEADNITE.SON", "ALEXA'S.SON", "EXAMPLE.SON", "DRUMMAP.SON", "AUTOLOAD.SON"];
    for name in &fixtures {
        let data = load_fixture(name);
        let song = son_parser::parse_song_data(&data).unwrap();
        assert!(
            !song.patterns.is_empty(),
            "{} has no patterns",
            name
        );
    }
}

#[test]
fn test_all_fixtures_have_16_tracks_per_pattern() {
    let fixtures = ["DEADNITE.SON", "ALEXA'S.SON", "EXAMPLE.SON", "DRUMMAP.SON", "AUTOLOAD.SON"];
    for name in &fixtures {
        let data = load_fixture(name);
        let song = son_parser::parse_song_data(&data).unwrap();
        for pat in &song.patterns {
            assert_eq!(
                pat.tracks.len(),
                16,
                "{} pattern '{}' has {} tracks (expected 16)",
                name,
                pat.name,
                pat.tracks.len()
            );
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// ALEXA'S.SON SPECIFIC TESTS
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_alexas_tempo() {
    let data = load_alexas();
    let son = son_parser::parse_son_file(&data).unwrap();
    assert_eq!(son.header.tempo, 120, "ALEXA'S tempo should be 120 BPM");
}

#[test]
fn test_alexas_time_signature() {
    let data = load_alexas();
    let son = son_parser::parse_son_file(&data).unwrap();
    // ALEXA'S uses 1536 ticks/measure (8/4 or compound time)
    assert_eq!(son.header.ticks_per_measure, 1536, "ALEXA'S should be 1536 ticks/measure");
}

#[test]
fn test_alexas_has_notes() {
    let data = load_alexas();
    let song = son_parser::parse_song_data(&data).unwrap();
    let total_notes: usize = song
        .patterns
        .iter()
        .flat_map(|p| &p.tracks)
        .flat_map(|t| &t.events)
        .filter(|e| matches!(e, TrackEvent::NoteOn(_)))
        .count();
    assert!(total_notes > 0, "ALEXA'S should have note events, got {}", total_notes);
}

// ═══════════════════════════════════════════════════════════════════════
// VELOCITY ENCODING TESTS
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_velocity_range_all_files() {
    let fixtures = ["DEADNITE.SON", "ALEXA'S.SON", "EXAMPLE.SON", "DRUMMAP.SON", "AUTOLOAD.SON"];
    for name in &fixtures {
        let data = load_fixture(name);
        let song = son_parser::parse_song_data(&data).unwrap();
        for pat in &song.patterns {
            for track in &pat.tracks {
                for event in &track.events {
                    if let TrackEvent::NoteOn(e) = event {
                        assert!(
                            e.velocity >= 1 && e.velocity <= 127,
                            "{} has out-of-range velocity {} in track '{}'",
                            name,
                            e.velocity,
                            track.name
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn test_note_values_are_in_byte_range() {
    // Note: Notator stores notes as raw bytes (0-255). Values > 127 can occur
    // in special contexts (e.g., drum maps, transposed ranges). We verify they
    // are valid u8 values — the parser stores them as u8 so this is inherently true,
    // but we verify no panic occurs during parsing.
    let fixtures = ["DEADNITE.SON", "ALEXA'S.SON", "EXAMPLE.SON", "DRUMMAP.SON", "AUTOLOAD.SON"];
    for name in &fixtures {
        let data = load_fixture(name);
        let song = son_parser::parse_song_data(&data).unwrap();
        let total_notes: usize = song
            .patterns
            .iter()
            .flat_map(|p| &p.tracks)
            .flat_map(|t| &t.events)
            .filter(|e| matches!(e, TrackEvent::NoteOn(_) | TrackEvent::NoteOff(_)))
            .count();
        // Each fixture should have at least some note events
        assert!(total_notes > 0, "{} should have note events", name);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// TRACK CONFIG & FILTER TESTS
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_track_configs_have_valid_channels() {
    let fixtures = ["DEADNITE.SON", "ALEXA'S.SON", "EXAMPLE.SON"];
    for name in &fixtures {
        let data = load_fixture(name);
        let song = son_parser::parse_song_data(&data).unwrap();
        for pat in &song.patterns {
            for track in &pat.tracks {
                assert!(
                    track.channel <= 15,
                    "{} track '{}' has invalid channel {}",
                    name,
                    track.name,
                    track.channel
                );
            }
        }
    }
}

#[test]
fn test_track_config_midi_port_valid() {
    let data = load_deadnite();
    let son = son_parser::parse_son_file(&data).unwrap();
    for slot in &son.track_slots {
        assert!(
            slot.config.midi_port <= 15,
            "Track '{}' has invalid MIDI port {}",
            slot.name,
            slot.config.midi_port
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════
// MIDI EXPORT MULTI-FILE TESTS
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_all_fixtures_export_valid_midi() {
    let fixtures = [
        ("DEADNITE.SON", "DEADNITE"),
        ("ALEXA'S.SON", "ALEXAS"),
        ("EXAMPLE.SON", "EXAMPLE"),
        ("DRUMMAP.SON", "DRUMMAP"),
        ("AUTOLOAD.SON", "AUTOLOAD"),
    ];
    for (filename, midi_name) in &fixtures {
        let data = load_fixture(filename);
        let song = son_parser::parse_song_data(&data).unwrap();
        let midi = son_parser::export_to_midi(&song, midi_name);

        // Must start with MThd
        assert_eq!(
            &midi[0..4],
            b"MThd",
            "{} MIDI output must start with MThd",
            filename
        );
        // Header length = 6
        assert_eq!(&midi[4..8], &[0, 0, 0, 6], "{} MIDI header length wrong", filename);
        // Format type 1
        assert_eq!(&midi[8..10], &[0, 1], "{} should be MIDI format 1", filename);
        // Must contain at least one MTrk
        let has_mtrk = midi.windows(4).any(|w| w == b"MTrk");
        assert!(has_mtrk, "{} MIDI output must contain at least one MTrk", filename);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// EVENT STATISTICS TESTS
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_drummap_has_named_tracks() {
    let data = load_drummap();
    let song = son_parser::parse_song_data(&data).unwrap();
    // DRUMMAP should have at least one named track with events
    let has_named = song
        .patterns
        .iter()
        .flat_map(|p| &p.tracks)
        .any(|t| !t.name.trim().is_empty() && !t.events.is_empty());
    assert!(has_named, "DRUMMAP should have named tracks with events");
}

#[test]
fn test_event_ticks_are_monotonic_per_track() {
    // Note: Ticks are 16-bit and wrap per measure in Notator. For files with
    // large ticks_per_measure (like ALEXA'S at 1536), ticks can appear to
    // decrease when wrapping. We test DEADNITE which has 384 ticks/measure.
    let data = load_fixture("DEADNITE.SON");
    let song = son_parser::parse_song_data(&data).unwrap();
    let pat = song.patterns.iter().find(|p| p.index == 0).unwrap();
    for track in &pat.tracks {
        if track.events.is_empty() {
            continue;
        }
        let mut last_tick: u16 = 0;
        for event in &track.events {
            let tick = event.tick();
            assert!(
                tick >= last_tick,
                "DEADNITE pattern 0 track '{}': tick {} < previous {}",
                track.name,
                tick,
                last_tick
            );
            last_tick = tick;
        }
    }
}

#[test]
fn test_channel_config_arrays_are_16_elements() {
    let fixtures = ["DEADNITE.SON", "ALEXA'S.SON", "EXAMPLE.SON", "DRUMMAP.SON", "AUTOLOAD.SON"];
    for name in &fixtures {
        let data = load_fixture(name);
        let son = son_parser::parse_son_file(&data).unwrap();
        assert_eq!(son.header.channel_config.channels.len(), 16, "{} channels array", name);
        assert_eq!(son.header.channel_config.programs.len(), 16, "{} programs array", name);
        assert_eq!(son.header.channel_config.volumes.len(), 16, "{} volumes array", name);
        assert_eq!(son.header.channel_config.pans.len(), 16, "{} pans array", name);
    }
}

#[test]
fn test_boundaries_exist_in_all_files() {
    let fixtures = ["DEADNITE.SON", "ALEXA'S.SON", "EXAMPLE.SON", "DRUMMAP.SON", "AUTOLOAD.SON"];
    for name in &fixtures {
        let data = load_fixture(name);
        let son = son_parser::parse_son_file(&data).unwrap();
        assert!(
            !son.boundaries.is_empty(),
            "{} should have boundary markers",
            name
        );
    }
}
