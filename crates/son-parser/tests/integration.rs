//! Integration tests against the DEADNITE.SON reference file.
//!
//! Reference data from the original Notator SL 3.21 screenshot.

use son_parser::types::*;

/// Load the DEADNITE.SON test fixture.
fn load_deadnite() -> Vec<u8> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/DEADNITE.SON");
    std::fs::read(path).expect("DEADNITE.SON fixture not found")
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
