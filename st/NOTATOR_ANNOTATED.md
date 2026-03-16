# NOTATOR.PRG Annotated Decompilation

> **Source**: Ghidra decompilation of `NOTATOR.PRG` 3.21 for Atari ST  
> **Architecture**: Motorola 68000 (big-endian, 24-bit address bus)  
> **Original file**: `st/NOTATOR_PRG_decompiled_v2.txt`

This document maps the raw `FUN_*` names from the Ghidra decompilation to descriptive names, with pseudocode explanations of key functions.

---

## Function Name Map

| Ghidra Name       | Annotated Name           | Address    | Description                                |
|-------------------|--------------------------|------------|--------------------------------------------|
| `FUN_000149dc`    | `dispatch_event`         | 0x000149dc | Main event processor — 665-line switch on `status & 0xF0` |
| `FUN_00010990`    | `record_midi_input`      | 0x00010990 | Encodes incoming MIDI bytes into 6-byte event records |
| `FUN_00010b90`    | `process_incoming_midi`  | 0x00010b90 | Routes MIDI status bytes, handles running status |
| `FUN_000112ae`    | `apply_event_filters`    | 0x000112ae | Tests note/velocity/channel against filter config |
| `FUN_00010ce6`    | `write_boundary_marker`  | 0x00010ce6 | Writes `7F FF FF FF` boundary markers between track slots |
| `FUN_000172ac`    | `update_timer_period`    | 0x000172ac | Converts BPM tempo to 68000 hardware timer period |
| `FUN_00014ac8`    | `check_note_range`       | 0x00014ac8 | Validates note against track's note range filter |
| `FUN_00010a16`    | `advance_event_pointer`  | 0x00010a16 | Advances the 6-byte event read pointer |
| `FUN_00010a66`    | `reset_event_pointer`    | 0x00010a66 | Resets event read position to end of track |
| `FUN_000115f0`    | `midi_output_2bytes`     | 0x000115f0 | Sends 2-byte MIDI message (e.g., Program Change) |
| `FUN_000115f2`    | `midi_output_3bytes`     | 0x000115f2 | Sends 3-byte MIDI message (e.g., Note On) |
| `FUN_000116c4`    | `set_track_flag_bit`     | 0x000116c4 | Sets or clears a bit in the track flag array |
| `FUN_000117be`    | `write_track_config`     | 0x000117be | Writes track config byte and triggers MIDI output |
| `FUN_00011b98`    | `enqueue_midi_byte`      | 0x00011b98 | Pushes a byte into the MIDI output ring buffer |
| `FUN_00010cca`    | `store_event_record`     | 0x00010cca | Stores a complete 6-byte record into track data |
| `FUN_00010ce0`    | `store_raw_event`        | 0x00010ce0 | Writes raw event data with boundary check |
| `FUN_00010ce6`    | `write_boundary_and_advance` | 0x00010ce6 | Writes `0x7FFFFFFF` marker and advances write pointer |
| `FUN_00016602`    | `compute_tempo_from_tap` | 0x00016602 | Calculates BPM from tap timing interval |
| `FUN_000145be`    | `compute_channel_offset` | 0x000145be | Gets channel number from track config for MIDI output |
| `FUN_00014594`    | `resolve_track_pointer`  | 0x00014594 | Resolves track data pointer from pattern/track index |
| `FUN_0001464c`    | `get_midi_channel`       | 0x0001464c | Returns the effective MIDI channel for current track |
| `FUN_00014624`    | `get_note_value`         | 0x00014624 | Reads note byte with any transposition applied |
| `FUN_000147d6`    | `send_program_change`    | 0x000147d6 | Sends MIDI Program Change message |
| `FUN_00017d28`    | `advance_to_next_event`  | 0x00017d28 | Moves to the next event in the track's event list |
| `FUN_00017d1e`    | `send_raw_midi_byte`     | 0x00017d1e | Sends a single byte to the MIDI output port |
| `FUN_00016d0c`    | `end_of_pattern_handler` | 0x00016d0c | Handles end-of-pattern (resets, loops, or advances) |
| `FUN_00016d76`    | `pattern_advance`        | 0x00016d76 | Advances to the next arrangement entry |
| `FUN_00016d82`    | `bar_advance`            | 0x00016d82 | Advances bar counter within a pattern |
| `FUN_00014c3c`    | `reset_all_track_notes`  | 0x00014c3c | All-notes-off for tracks (up to 16 or 32 tracks) |
| `FUN_00014c8e`    | `reset_single_track`     | 0x00014c8e | Resets a single track's active note state |
| `FUN_00014d44`    | `check_loop_point`       | 0x00014d44 | Checks if playback should loop back |
| `FUN_00018aec`    | `stop_playback`          | 0x00018aec | Stops the sequencer and sends All Notes Off |
| `FUN_00018510`    | `handle_sync_clock`      | 0x00018510 | Processes MIDI clock sync messages |
| `FUN_0001851c`    | `send_sync_continue`     | 0x0001851c | Sends MIDI Continue for external sync |
| `FUN_000107c4`    | `wait_acia_ready`        | 0x000107c4 | Waits for the 68901 MFP ACIA to be ready for TX |
| `FUN_00010812`    | `nop_stub`               | 0x00010812 | Empty function (debug placeholder) |
| `FUN_0001081a`    | `flush_acia_buffer`      | 0x0001081a | Calls `wait_acia_ready` 3× to flush the MIDI UART |
| `FUN_00013ab0`    | `init_application`       | 0x00013ab0 | Main application initialization |
| `FUN_00014de8`    | `register_note_off`      | 0x00014de8 | Registers a pending Note Off for auto-duration |
| `FUN_00014e02`    | `register_note_on`       | 0x00014e02 | Registers a Note On and schedules its duration |
| `FUN_00016910`    | `get_next_bar_tick`      | 0x00016910 | Returns the tick position of the next bar line |
| `FUN_00016c06`    | `compute_pattern_offset` | 0x00016c06 | Calculates tick offset for pattern repetition |
| `FUN_00016a6a`    | `set_arrangement_index`  | 0x00016a6a | Sets the active arrangement entry index |
| `FUN_00016e54`    | `jump_to_arrangement`    | 0x00016e54 | Jumps playback to a specific arrangement entry |
| `FUN_00017ca4`    | `begin_sysex_insert`     | 0x00017ca4 | Begins inserting a SysEx event into the track stream |
| `FUN_00017cae`    | `end_sysex_insert`       | 0x00017cae | Ends SysEx insertion and resumes normal playback |
| `FUN_000148fa`    | `follow_sysex_chain`     | 0x000148fa | Follows a SysEx continuation chain (byte[6] & 0x80) |
| `FUN_000148ae`    | `read_sysex_data_byte`   | 0x000148ae | Reads the next byte from a SysEx continuation record |
| `FUN_00018d9a`    | `read_next_status_byte`  | 0x00018d9a | Peeks at the next event's status byte |
| `FUN_00018c74`    | `write_event_with_flag`  | 0x00018c74 | Writes event record and sets continuation flag in byte[5] |
| `FUN_00018c3a`    | `write_event_raw`        | 0x00018c3a | Writes event record without continuation flag |
| `FUN_00010c8e`    | `terminate_sysex_record` | 0x00010c8e | Writes SysEx terminator (0xF7) into event stream |
| `FUN_00010bd0`    | `check_track_boundary`   | 0x00010bd0 | Checks if we've reached the end of track data |

---

## Key Data Addresses (RAM)

| Address      | Name                  | Description                                |
|--------------|-----------------------|--------------------------------------------|
| `0x0001a226` | `track_write_ptr`     | Current write pointer into track data      |
| `0x0001a19a` | `song_data_base`      | Base pointer to the loaded .SON file in RAM |
| `0x0001a19e` | `track_data_end`      | End of track data region                   |
| `0x0001a1aa` | `playback_tick`       | Current absolute tick position             |
| `0x0001a1b2` | `stop_tick`           | Tick at which playback should stop         |
| `0x0001a170` | `bar_counter`         | Current bar number during playback         |
| `0x00019fce` | `timer_period`        | MFP Timer C period (controls tempo)        |
| `0x00019fd8` | `transport_state`     | Current transport status byte              |
| `0x0001a078` | `playback_flags`      | Bit 0: tempo sync done                     |
| `0x0001a074` | `recording_active`    | Non-zero when recording is active          |
| `0x0001a086` | `sysex_nesting`       | SysEx insertion depth counter              |
| `0x0001a072` | `dirty_flag`          | Track data modified flag                   |
| `0x0001a012` | `edit_mode`           | Current edit mode (step/realtime)          |
| `0x0001a0ff` | `error_flags`         | Bit 0: bar overflow                        |
| `0x0001a332` | `column_ptrs`         | Arrangement column data pointers           |
| `0x0001a6e4` | `pattern_tick_offsets` | Per-pattern tick offset array              |
| `0x0001a7f4` | `active_notes_array`  | Tracks which notes are currently sounding  |
| `0x00012eb8` | `acia_data_register`  | Pointer to MIDI UART data register         |
| `0x0001a02e` | `ticks_per_measure`   | Loaded from .SON header offset 0x0022      |
| `0x0001a038` | `precount_counter`    | Count-in (precount) bars remaining         |

---

## dispatch_event (FUN_000149dc) — Pseudocode

This is the main event processing function, called for each 6-byte event record during playback. The original spans 665 lines of decompiled C.

```c
// Address: 0x000149dc
// Input: A0 = pointer to 6-byte event record
//        A6 = pointer to track config (14-byte block)
uint dispatch_event(uint8_t* event, track_config_t* config) {
    uint8_t note     = event[0];
    uint8_t status   = event[1];
    uint8_t tick_hi  = event[2];
    uint8_t tick_lo  = event[3];
    uint8_t velocity = event[4];
    uint8_t arg      = event[5];

    // High bit of note = error/invalid marker
    if (note & 0x80) {
        set_error(6);
        return;
    }

    uint8_t status_hi = status & 0xF0;

    switch (status_hi) {

    case 0x00:  // Meta events
        uint8_t sub = arg & 0x0F;
        if (sub == 0x01 && note == 0x7E) {
            end_of_pattern_handler();
            pattern_advance();
        }
        if (sub == 0x0F) {
            // Tempo change marker
            compute_and_set_tempo();
        }
        break;

    case 0x30:  // Bar marker
        bar_counter++;
        // Update column pointers, time signature, key signature
        // Read bar-specific metadata from bytes 6-11
        // Handle bar limit (max 0x640 = 1600 bars)
        reset_all_track_notes();
        // Advance through all events up to next bar
        while (next_event_tick < bar_tick) {
            process_nested_events();
        }
        break;

    case 0x40:  // Track setup
        uint8_t setup_sub = arg & 0x0F;
        if (setup_sub == 0) {
            // Full track initialization
            reset_single_track();
            end_of_pattern_handler();
            pattern_advance();
        } else {
            // Track flag set/clear
            set_track_flag_bit(setup_sub, velocity >> 1);
            if (bit_6_set) midi_output_3bytes();
            else midi_output_2bytes();
        }
        break;

    case 0x60:  // Track config change
        uint8_t config_sub = arg & 0x0F;
        // Write new config value for this track
        track_flags[config_sub + 1] = velocity >> 1;
        if (track_flags[config_sub] & 0x40)
            midi_output_3bytes();
        else
            midi_output_2bytes();
        break;

    case 0x70:  // Notation / special
        // Extensive sub-type handling (see SON_FORMAT.md)
        switch (note) {
        case 1:  set_tempo_from_event(); break;
        case 2:  set_time_signature();   break;
        case 3:  set_filter_mask();      break;
        case 4:  clear_filter_mask();    break;
        case 5..12: load_notation_font(); break;
        // ... many more sub-types ...
        }
        break;

    case 0x80:  // Note Off
        vel_byte = 0;  // fall through to Note On handler
        // (falls through to 0x90)

    case 0x90:  // Note On
        if (!(config->filter_flags & FILTER_NOTE)) {
            if (note != 0 && tick != 0x7F) {
                // Check note range filter
                if (config->note_range_high == 0 ||
                    (note <= config->note_range_high &&
                     note >= config->note_range_low)) {

                    channel = get_midi_channel();
                    note += config->transpose;  // byte +5

                    enqueue_midi_byte(status | channel);

                    if (vel_byte == 0) {
                        register_note_off(note);
                    } else {
                        // Apply velocity curve
                        adjusted_vel = apply_velocity_curve(vel_byte, config);
                        adjusted_vel += config->velocity_offset;
                        clamp(adjusted_vel, 1, 127);
                        register_note_on(note, adjusted_vel);
                    }
                    advance_to_next_event();
                }
            }
        }
        break;

    case 0xA0:  // Aftertouch
        if (!(config->filter_flags & FILTER_AFTERTOUCH)) {
            check_note_range();
            get_midi_channel();
            get_note_value();
            get_note_value();  // pressure value
            enqueue_midi_byte();
            advance_to_next_event();
        }
        break;

    case 0xB0:  // Control Change
        if (!(config->filter_flags & FILTER_CC)) {
            channel = get_midi_channel();
            enqueue_midi_byte(0xB0 | channel);
            advance_to_next_event();
            // Special: CC7 (volume) → update volume display
            if (controller == 7) {
                volume_table[channel] = value | 0x80;
            }
        }
        break;

    case 0xC0:  // Program Change
        if (!(config->filter_flags & FILTER_PROGRAM)) {
            dirty_flag = 0;
            get_midi_channel();
            enqueue_midi_byte();
            send_program_change();
        }
        break;

    case 0xD0:  // Channel Pressure
        if (!(config->filter_flags & FILTER_CHAN_PRESSURE)) {
            get_midi_channel();
            enqueue_midi_byte();
        }
        break;

    case 0xE0:  // Pitch Wheel
        if (!(config->filter_flags & FILTER_PITCH)) {
            get_midi_channel();
            enqueue_midi_byte();
            advance_to_next_event();
        }
        break;

    case 0xF0:  // SysEx
        if (!(config->filter_flags & FILTER_SYSEX)) {
            do {
                send_raw_midi_byte();
                while (true) {
                    enqueue_midi_byte();
                    advance_to_next_event();
                    if (!(event[6] & 0x80)) return;  // end of chain

                    // Follow continuation records
                    while (event[6] & 0x80) {
                        follow_sysex_chain();
                    }
                    read_next_status_byte();
                }
            } while (is_sysex_continuation);
            enqueue_midi_byte(0xF7);  // SysEx terminator
        }
        break;

    default:
        set_error(7);
        break;
    }

    // Skip any remaining continuation records
    while (event[6] & 0x80) {
        event += 6;
    }
}
```

---

## process_incoming_midi (FUN_00010b90) — Summary

Handles incoming MIDI bytes during recording. Routes based on status byte:

- **Data bytes** (0x00–0x7F): Append to current message buffer
- **Status bytes** (0x80–0xEF): Start new message, determine expected length
  - 0xC0/0xD0: 1 data byte expected
  - Others: 2 data bytes expected
- **System messages** (0xF0–0xF7):
  - 0xF0: Start SysEx recording, accumulate until 0xF7
  - 0xF2: Song Position Pointer (2 data bytes)
  - 0xF7: End SysEx, store via `store_event_record()`
- **Realtime** (0xF8+): Ignored (passed through)

Filter check: `config->filter_flags & (1 << (status >> 4 & 7))` — if the corresponding bit is set, the event is blocked from recording.

---

## write_boundary_marker (FUN_00010ce6) — Summary

```c
void write_boundary_marker() {
    uint32_t* write_ptr = *track_pointer_table[current_entry];
    uint32_t current_offset = *write_ptr;

    // Write the boundary marker
    *(write_ptr + 6) = 0x7FFFFFFF;

    // Advance write pointer if within bounds
    if (current_offset < *track_data_end) {
        *write_ptr += 6;
    }
}
```

This is how Notator delimits track slots — each slot is separated by a 4-byte marker. The parser's `boundary.rs` scans for both `7F FF FF FF` (Type A) and `00 0F FF FF` (Type B) during parsing.

---

## Hardware Details

### MIDI Output Path

1. Events are dispatched by `dispatch_event`
2. MIDI bytes go to `enqueue_midi_byte` (ring buffer at `0x0001227e`)
3. Ring buffer is drained by the MFP Timer interrupt
4. `wait_acia_ready` polls the 68901 MFP ACIA status register at `0x00FA4001`
5. Bytes are written to the ACIA data register (pointer at `0x00012eb8`)

### Tempo / Timer

The Atari ST uses the MFP68901 Timer C for MIDI clock timing:

```
timer_period = (ticks_per_measure × tempo_bpm × 0x186A) / elapsed_time
```

Valid tempo range: 2500–25000 (internal units, roughly 25–250 BPM).

The function at `FUN_000172ac` (`update_timer_period`) reprograms the MFP timer whenever tempo changes.
