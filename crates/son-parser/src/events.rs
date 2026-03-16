//! 6-byte event record parsing.
//!
//! Each event is stored as a 6-byte record:
//!   byte[0] = note/data, byte[1] = status, byte[2..3] = position (BE u16),
//!   byte[4] = velocity/value, byte[5] = arg/continuation
//!
//! Status byte high nibble determines event type:
//!   0x00=Meta, 0x30=Bar, 0x40=TrackSetup, 0x60=TrackConfig,
//!   0x70=Notation, 0x80=NoteOff, 0x90=NoteOn, 0xA0=Aftertouch,
//!   0xB0=CC, 0xC0=ProgramChange, 0xD0=ChannelPressure,
//!   0xE0=PitchWheel, 0xF0=SysEx

use crate::types::*;

const EVENT_SIZE: usize = 6;

/// Parse all 6-byte event records from track event data.
pub fn parse_all_events(data: &[u8]) -> Vec<SonEvent> {
    let mut events = Vec::new();
    let num_records = data.len() / EVENT_SIZE;
    let mut i = 0;

    while i < num_records {
        let offset = i * EVENT_SIZE;
        let note = data[offset];
        let status = data[offset + 1];
        let pos_hi = data[offset + 2];
        let pos_lo = data[offset + 3];
        let vel = data[offset + 4];
        let arg = data[offset + 5];
        let tick = (pos_hi as u16) * 256 + (pos_lo as u16);
        let raw = data[offset..offset + EVENT_SIZE].to_vec();
        let status_hi = status & 0xF0;

        match status_hi {
            // Note On (0x90)
            0x90 => {
                let adjusted_vel = (vel as i16) - 0x80;
                if adjusted_vel <= 0 {
                    events.push(SonEvent::NoteOff(NoteOffEvent { tick, note, raw }));
                } else {
                    events.push(SonEvent::NoteOn(NoteOnEvent {
                        tick,
                        note,
                        velocity: adjusted_vel.min(127).max(1) as u8,
                        raw,
                    }));
                }
            }

            // Note Off (0x80)
            0x80 => {
                events.push(SonEvent::NoteOff(NoteOffEvent { tick, note, raw }));
            }

            // Aftertouch (0xA0)
            0xA0 => {
                events.push(SonEvent::Aftertouch(AftertouchEvent {
                    tick,
                    note,
                    pressure: vel & 0x7F,
                    raw,
                }));
            }

            // Control Change (0xB0)
            0xB0 => {
                events.push(SonEvent::ControlChange(ControlChangeEvent {
                    tick,
                    controller: note,
                    value: vel,
                    raw,
                }));
            }

            // Program Change (0xC0)
            0xC0 => {
                events.push(SonEvent::ProgramChange(ProgramChangeEvent {
                    tick,
                    program: note & 0x7F,
                    raw,
                }));
            }

            // Channel Pressure (0xD0)
            0xD0 => {
                events.push(SonEvent::ChannelPressure(ChannelPressureEvent {
                    tick,
                    pressure: note & 0x7F,
                    raw,
                }));
            }

            // Pitch Wheel (0xE0)
            0xE0 => {
                let value = ((vel as f32 - 128.0) * (8192.0 / 128.0)).round() as i16;
                events.push(SonEvent::PitchWheel(PitchWheelEvent { tick, value, raw }));
            }

            // Meta/System (0x00)
            0x00 => {
                events.push(SonEvent::Meta(MetaEvent {
                    tick,
                    sub_type: arg & 0x0F,
                    raw,
                }));
            }

            // Bar Marker (0x30)
            0x30 => {
                events.push(SonEvent::BarMarker(BarMarkerEvent { tick, raw }));
            }

            // Track Setup (0x40)
            0x40 => {
                events.push(SonEvent::TrackSetup(TrackSetupEvent {
                    tick,
                    sub_type: arg & 0x0F,
                    raw,
                }));
            }

            // Track Config (0x60)
            0x60 => {
                events.push(SonEvent::TrackConfigChange(TrackConfigChangeEvent {
                    tick,
                    sub_type: arg & 0x0F,
                    raw,
                }));
            }

            // Notation (0x70)
            0x70 => {
                events.push(SonEvent::Notation(NotationEvent {
                    tick,
                    sub_type: note,
                    raw,
                }));
            }

            // SysEx (0xF0)
            0xF0 => {
                let mut raw_records: Vec<Vec<u8>> = vec![raw];
                let mut sysex_bytes: Vec<u8> = vec![0xF0, note & 0x7F];
                if vel != 0 {
                    sysex_bytes.push(vel & 0x7F);
                }

                // Follow continuation chain: byte[5] & 0x80
                let mut ci = i;
                while ci < num_records - 1 && (data[ci * EVENT_SIZE + 5] & 0x80) != 0 {
                    ci += 1;
                    let c_offset = ci * EVENT_SIZE;
                    let c_raw = data[c_offset..c_offset + EVENT_SIZE].to_vec();
                    raw_records.push(c_raw);

                    for b in 0..5 {
                        if data[c_offset + b] != 0 {
                            sysex_bytes.push(data[c_offset + b] & 0x7F);
                        }
                    }
                }

                // Terminate SysEx if needed
                if sysex_bytes.last() != Some(&0xF7) {
                    sysex_bytes.push(0xF7);
                }

                events.push(SonEvent::SysEx(SysExEvent {
                    tick,
                    data: sysex_bytes,
                    raw_records,
                }));

                i = ci;
            }

            // Unknown
            _ => {
                events.push(SonEvent::Raw(RawEvent { tick, status, raw }));
            }
        }

        i += 1;
    }

    events
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_note_on() {
        // note=60, status=0x90, tick=100 (0x00,0x64), vel=0xC0 (adjusted=64), arg=0
        let data = [60, 0x90, 0x00, 0x64, 0xC0, 0x00];
        let events = parse_all_events(&data);
        assert_eq!(events.len(), 1);
        match &events[0] {
            SonEvent::NoteOn(e) => {
                assert_eq!(e.tick, 100);
                assert_eq!(e.note, 60);
                assert_eq!(e.velocity, 64);
            }
            _ => panic!("Expected NoteOn"),
        }
    }

    #[test]
    fn test_note_on_zero_vel_is_note_off() {
        // vel=0x80 → adjusted=0 → NoteOff
        let data = [60, 0x90, 0x00, 0x10, 0x80, 0x00];
        let events = parse_all_events(&data);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], SonEvent::NoteOff(_)));
    }

    #[test]
    fn test_note_off() {
        let data = [60, 0x80, 0x00, 0x20, 0x00, 0x00];
        let events = parse_all_events(&data);
        assert_eq!(events.len(), 1);
        match &events[0] {
            SonEvent::NoteOff(e) => {
                assert_eq!(e.tick, 32);
                assert_eq!(e.note, 60);
            }
            _ => panic!("Expected NoteOff"),
        }
    }

    #[test]
    fn test_control_change() {
        // controller=7 (volume), status=0xB0, tick=0, value=100
        let data = [7, 0xB0, 0x00, 0x00, 100, 0x00];
        let events = parse_all_events(&data);
        assert_eq!(events.len(), 1);
        match &events[0] {
            SonEvent::ControlChange(e) => {
                assert_eq!(e.controller, 7);
                assert_eq!(e.value, 100);
            }
            _ => panic!("Expected ControlChange"),
        }
    }

    #[test]
    fn test_program_change() {
        let data = [42, 0xC0, 0x00, 0x00, 0x00, 0x00];
        let events = parse_all_events(&data);
        assert_eq!(events.len(), 1);
        match &events[0] {
            SonEvent::ProgramChange(e) => {
                assert_eq!(e.program, 42);
            }
            _ => panic!("Expected ProgramChange"),
        }
    }

    #[test]
    fn test_meta_event() {
        let data = [0, 0x00, 0x00, 0x00, 0x00, 0x0F];
        let events = parse_all_events(&data);
        assert_eq!(events.len(), 1);
        match &events[0] {
            SonEvent::Meta(e) => {
                assert_eq!(e.sub_type, 0x0F);
            }
            _ => panic!("Expected Meta"),
        }
    }

    #[test]
    fn test_bar_marker() {
        let data = [0, 0x30, 0x03, 0x00, 0x00, 0x00];
        let events = parse_all_events(&data);
        assert_eq!(events.len(), 1);
        match &events[0] {
            SonEvent::BarMarker(e) => {
                assert_eq!(e.tick, 768);
            }
            _ => panic!("Expected BarMarker"),
        }
    }

    #[test]
    fn test_is_playable() {
        let note_on = SonEvent::NoteOn(NoteOnEvent {
            tick: 0,
            note: 60,
            velocity: 100,
            raw: vec![],
        });
        let meta = SonEvent::Meta(MetaEvent {
            tick: 0,
            sub_type: 0,
            raw: vec![],
        });
        assert!(note_on.is_playable());
        assert!(!meta.is_playable());
    }
}
