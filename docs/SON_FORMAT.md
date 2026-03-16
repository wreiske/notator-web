# Notator SL .SON File Format Specification

> **Version**: Notator SL 3.21 / Creator 3.16  
> **Platform**: Atari ST (Motorola 68000, big-endian)  
> **Derived from**: Ghidra decompilation of `NOTATOR.PRG`, hex analysis of 89 `.SON` files, and [son2midi](https://github.com/simoncozens/son2midi)

## Overview

The `.SON` format is a proprietary binary file format used by C-Lab/eMagic **Notator SL** and **Creator** sequencer software on the Atari ST. It stores complete MIDI arrangements with up to 24 patterns × 16 tracks, arrangement sequencing data, and notation display information.

All multi-byte integers are stored **big-endian** (Motorola byte order).

---

## File Layout

```
Offset      Size    Region
──────────────────────────────────────────────────────────────
0x0000      2       Magic number (0x3B9E)
0x0002      4       Reserved / flags
0x0006      2       Tempo (BPM)
0x0008      8       Extended header config
0x0010     84       Reserved / display state
0x0064    144       Instrument names (16 × 9 bytes)
0x00F4    572       Reserved / UI state
0x0330     16       Channel map
0x0340     16       Program map
0x0350     16       Volume map
0x0360     16       Pan map
0x0370    402       Reserved
0x0502  5574       Track pointer table (24 patterns × 16 tracks × 4 bytes)
  └─ 0x20BE   ...    Arrangement table (up to 64 × 24-byte entries)
  └─ 0x21BE   128    Pattern name table (16 × 8 bytes)
0x5AC8      *       Track data region (boundary-delimited slots)
```

---

## Header (0x0000–0x0063)

### Core Fields

| Offset | Size | Type   | Field                | Notes                                      |
|--------|------|--------|----------------------|--------------------------------------------|
| 0x0000 | 2    | u16    | Magic                | Always `0x3B9E`                            |
| 0x0002 | 4    | —      | Reserved             |                                            |
| 0x0006 | 2    | u16    | Tempo                | BPM (20–300). 0 → default 120              |
| 0x0022 | 2    | u16    | Ticks per measure    | 768 = 4/4, 576 = 3/4, 384 = 2/4. 0 → 768  |

### Extended Header Config (0x0008–0x0010)

| Offset | Size | Type | Field              | Notes                              |
|--------|------|------|--------------------|------------------------------------|
| 0x0008 | 2    | u16  | Quantize value     | Current quantize resolution        |
| 0x000A | 1    | u8   | Flags byte         | Bit 0: loop enabled, Bit 1: auto-quantize |
| 0x000B | 1    | u8   | Click track        | 0 = off, nonzero = on              |
| 0x000C | 1    | u8   | Metronome prescale | Click division                     |
| 0x000D | 1    | u8   | Precount bars      | 0 = no precount                    |
| 0x000E | 2    | u16  | Active track mask  | Bitmask of active (recording) tracks |
| 0x0010 | 1    | u8   | Display mode       | UI display state                   |

### Ticks Per Beat (derived)

```
ticks_per_beat = ticks_per_measure / 4
```

Standard values:
- **4/4 time**: 768 ticks/measure → 192 ticks/beat
- **3/4 time**: 576 ticks/measure → 144 ticks/beat
- **2/4 time**: 384 ticks/measure → 96 ticks/beat
- **8/4 time**: 1536 ticks/measure → 384 ticks/beat (observed in ALEXA'S.SON)

Values must be positive multiples of 192.

---

## Instrument Names (0x0064–0x00F3)

16 instruments × 9 bytes each. ASCII, null-terminated, space-padded.

```
offset = 0x0064 + (instrument_index × 9)
```

---

## Channel Configuration (0x0330–0x036F)

Four 16-byte arrays, one byte per MIDI channel (0–15):

| Offset | Size | Array    | Description                      |
|--------|------|----------|----------------------------------|
| 0x0330 | 16   | Channels | MIDI channel assignments         |
| 0x0340 | 16   | Programs | Initial program (instrument) numbers |
| 0x0350 | 16   | Volumes  | Initial volume (CC7) values      |
| 0x0360 | 16   | Pans     | Initial pan (CC10) values        |

---

## Track Pointer Table (0x0502–0x5AC7)

The pointer table maps each pattern/track slot to its data in the track data region. The table stores 24 patterns × 16 tracks = 384 entries.

### Entry Format (4 bytes per entry)

The pointer encoding uses an interleaved high-word / low-word scheme inherited from the 68000's addressing:

```
Entry at offset = 0x0502 + (pattern × 16 + track) × 4

Bytes [0..1] = pointer low word (u16 BE)
Bytes [2..3] = HIGH word for the NEXT entry
```

To reconstruct a 32-bit pointer:
```
pointer = (previous_entry.high_word << 16) | this_entry.low_word
```

**Special values:**
- `0x00001D40` → empty track (no data)
- `0x00000000` → empty track

### Initial High Word

The initial high word for entry (0, 0) is stored at offset `0x0500` (2 bytes before the table).

---

## Arrangement Table (0x20BE)

Up to 64 entries, each 24 bytes. Controls playback order of patterns.

### Entry Format (24 bytes)

| Offset | Size | Type  | Field           | Notes                              |
|--------|------|-------|-----------------|------------------------------------|
| +0     | 1    | u8    | Pattern index   | 1-based. 127 = end marker, 0 = stop |
| +1     | 1    | u8    | Tick high bit   | Bit 0 = bit 16 of tick position    |
| +2     | 2    | u16   | Tick position   | Low 16 bits of absolute tick       |
| +4     | 8    | —     | Reserved        |                                    |
| +12    | 9    | ASCII | Name            | High bit stripped (& 0x7F per byte) |
| +21    | 1    | —     | Reserved        |                                    |
| +22    | 1    | u8    | Signature byte 0 | Must be `0x80`                    |
| +23    | 1    | u8    | Signature byte 1 | Must be `0xD2`                    |

**Validation**: The table is considered valid if the first 3 entries all have signature bytes `0x80 0xD2` at offsets +22 and +23.

**Absolute tick position** (20-bit):
```
tick = (byte[1] & 0x01) × 0x10000 + u16be(byte[2..3])
```

**Bar number** (derived):
```
bar = (tick - first_entry_tick) / ticks_per_bar + 1
```

---

## Pattern Name Table (0x21BE)

16 entries × 8 bytes each. ASCII pattern names, null-terminated.

```
offset = 0x21BE + (pattern_index × 8)
```

Entry 0 is a header/label (typically "Pattern:" or "Name"). Entries 1–15 correspond to patterns 1–15.

**Default detection**: If a name starts with "Pattern" or "Name", it's treated as a default placeholder.

---

## Track Data Region (0x5AC8+)

Track data begins immediately after the header region. The data is organized as **boundary-delimited slots**, each containing one track's event data.

### Boundary Markers (4 bytes)

Two types of boundary markers separate track slots:

| Marker            | Hex Bytes         | Name   |
|-------------------|-------------------|--------|
| Type A            | `7F FF FF FF`     | Standard boundary |
| Type B            | `00 0F FF FF`     | Alternate boundary |

### Track Slot Structure

Each slot begins with a 46-byte preamble, followed by variable-length event data:

```
┌──────────────────────────┐
│  Boundary Marker (4B)    │  ← 7F FF FF FF or 00 0F FF FF
├──────────────────────────┤
│  Track Header (24B)      │  Raw track state
├──────────────────────────┤
│  Track Name (8B)         │  ASCII, null-terminated
├──────────────────────────┤
│  Track Config (14B)      │  Channel, port, filters
├──────────────────────────┤
│  Event Records (N × 6B)  │  Variable count
└──────────────────────────┘
```

### Track Header (24 bytes)

The raw 24-byte track header preserves Notator's internal track state. Key known offsets:

| Offset | Size | Field         | Notes                    |
|--------|------|---------------|--------------------------|
| +5     | 1    | MIDI channel  | 1-based (1–16). 0 = use slot index |

### Track Name (8 bytes)

8 ASCII characters, null-terminated, space-padded. Maximum 8 chars (Notator SL limit).

### Track Config (14 bytes)

| Offset | Size | Field          | Notes                               |
|--------|------|----------------|---------------------------------------|
| +0     | 1    | Reserved       |                                       |
| +1     | 1    | Filter flags   | Bit field (see below)                 |
| +2     | 1    | Reserved       |                                       |
| +3     | 1    | MIDI channel   | 5 bits (& 0x1F). 0 = use header      |
| +4     | 1    | Reserved       |                                       |
| +5     | 1    | MIDI port      | Low nibble (& 0x0F)                   |
| +6     | 3    | Reserved       |                                       |
| +9     | 1    | Note range low | Lowest allowed note (0 = no filter)   |
| +10    | 1    | Note range high| Highest allowed note (0 = no filter)  |
| +11    | 3    | Reserved       |                                       |

#### Event Filter Flags (byte +1)

```
Bit 1 (0x02): Note filter       — block Note On/Off
Bit 2 (0x04): Aftertouch filter — block Aftertouch
Bit 3 (0x08): CC filter          — block Control Change
Bit 4 (0x10): Program filter     — block Program Change
Bit 5 (0x20): Channel Pressure   — block Channel Pressure
Bit 6 (0x40): Pitch Wheel filter — block Pitch Bend
Bit 7 (0x80): SysEx filter       — block System Exclusive
```

These filters correspond directly to the event dispatcher in `NOTATOR.PRG` (`FUN_000149dc`), where each MIDI event type checks `*(byte*)(A6 + 1)` before processing.

---

## Event Records (6 bytes each)

Every event in a track is stored as a fixed-size 6-byte record.

### Record Layout

```
Byte 0: note/data    — Note number, controller #, program #, etc.
Byte 1: status       — High nibble = event type, low nibble = sub-type/channel
Byte 2: position_hi  — Tick position high byte
Byte 3: position_lo  — Tick position low byte
Byte 4: velocity     — Velocity/value/pressure (encoding varies by type)
Byte 5: arg          — Sub-type, continuation flag, or unused
```

**Tick position** (16-bit, relative to pattern start):
```
tick = byte[2] × 256 + byte[3]
```

### Event Types by Status High Nibble

| Status & 0xF0 | Type              | byte[0]       | byte[4]       | byte[5]        |
|----------------|-------------------|---------------|---------------|----------------|
| `0x00`         | Meta              | —             | —             | sub_type & 0x0F |
| `0x30`         | Bar Marker        | bar_data      | —             | column_flags   |
| `0x40`         | Track Setup       | config_data   | —             | sub_type & 0x0F |
| `0x60`         | Track Config      | config_data   | —             | sub_type & 0x0F |
| `0x70`         | Notation          | sub_type      | value         | flags          |
| `0x80`         | Note Off          | note (0–127)  | —             | —              |
| `0x90`         | Note On           | note (0–127)  | velocity*     | —              |
| `0xA0`         | Aftertouch        | note (0–127)  | pressure & 0x7F | —            |
| `0xB0`         | Control Change    | controller    | value         | —              |
| `0xC0`         | Program Change    | program & 0x7F| —             | —              |
| `0xD0`         | Channel Pressure  | pressure & 0x7F | —           | —              |
| `0xE0`         | Pitch Wheel       | —             | bend_value*   | —              |
| `0xF0`         | SysEx             | data & 0x7F   | data          | continuation*  |

### Velocity Encoding (Note On — 0x90)

Notator uses an **offset velocity** encoding. The raw byte[4] value is biased by 0x80:

```
midi_velocity = byte[4] - 0x80
```

- If `midi_velocity ≤ 0`, the event is treated as a **Note Off** (velocity = 0)
- Valid range: `0x81` (vel=1) through `0xFF` (vel=127)
- `0x80` → velocity 0 → Note Off

This matches the decompiled dispatcher at `case 0x90` / `LAB_00014aea`.

### Pitch Wheel Encoding (0xE0)

```
midi_pitch_bend = (byte[4] - 128) × (8192 / 128)
```

Converts from Notator's 0–255 range to MIDI's -8192 to +8191 range.

### SysEx Continuation (0xF0)

SysEx messages can span multiple 6-byte records via a **continuation chain**:

```
byte[5] & 0x80 = 1  →  next record is a continuation
byte[5] & 0x80 = 0  →  this is the last record
```

**First record**: `0xF0` is implied. byte[0] & 0x7F is the first data byte.

**Continuation records**: bytes[0..4] contain up to 5 data bytes (non-zero bytes are appended, each & 0x7F).

**Termination**: `0xF7` is appended if not already present.

This matches the decompiled SysEx handler at `case 0xF0` which follows `byte[6] & 0x80` chains.

---

## Meta Event Sub-Types (Status 0x00)

| Sub-type (byte[5] & 0x0F) | Meaning                    |
|----------------------------|----------------------------|
| `0x01`                     | Pattern end / loop point   |
| `0x0F`                     | Tempo change marker        |

When sub-type is `0x01` and byte[0] is `0x7E`, this triggers the pattern end handler (`FUN_00016d0c` → `FUN_00016d76`).

When sub-type is `0x0F`, it reads a tempo value and updates the hardware timer period.

---

## Notation Event Sub-Types (Status 0x70)

The notation events have extensive sub-type handling for display-only data:

| byte[0] value | Meaning                        |
|---------------|--------------------------------|
| 1             | Tempo change (inline)          |
| 2             | Time signature change          |
| 3             | Set track event filter mask    |
| 4             | Clear track event filter mask  |
| 5–12          | Notation font data (8 slots)   |
| 20 (0x14)     | Set notation display pointer   |
| 21 (0x15)     | Set output port bits           |
| 22 (0x16)     | Set output port bits (alt)     |
| 23 (0x17)     | Set output port bits (alt 2)   |
| 24 (0x18)     | Direct hardware I/O            |
| 25 (0x19)     | Set global byte flag           |
| 31–34         | Arrangement jump               |
| 50 (0x32)     | Send MIDI byte                 |
| 100 (0x64)    | Send MIDI + set font flag      |
| 101 (0x65)    | Toggle extended mode           |
| 120 (0x78)    | Set timing parameter           |
| 122 (0x7A)    | Insert event into stream       |
| 125 (0x7D)    | Synchronization wait           |

---

## MIDI Channel Resolution

Channel assignment follows a priority chain:

1. **Track header byte +5** (24-byte header): if > 0 and ≤ 16, use `value - 1`
2. **Track config byte +3**: if > 0, use `value - 1`
3. **Channel config table** at 0x0330: `channels[track_index]` if ≤ 15
4. **Fallback**: use the track's slot index (0–15)

**Drums heuristic**: Channel 9 (0-indexed) is GM drums. Tracks named "drum"/"percuss" or at index 9 are forced to channel 9.

---

## Known Unknown Regions

| Offset Range    | Size  | Notes                                    |
|-----------------|-------|------------------------------------------|
| 0x0002–0x0005   | 4     | Possibly version/revision flags          |
| 0x0011–0x0021   | 17    | Extended display/UI state                |
| 0x00F4–0x032F   | 572   | Internal Notator UI state (screen positions, editor state) |
| 0x0370–0x0501   | 402   | Possibly additional config or padding    |

These regions are preserved byte-for-byte by the round-trip serializer to ensure file integrity.

---

## Cross-References to Decompilation

| Function         | Address    | Purpose                                   |
|------------------|------------|-------------------------------------------|
| `dispatch_event` | 0x000149dc | Main event processor (switch on status)   |
| `record_midi`    | 0x00010990 | Records incoming MIDI into 6-byte records |
| `process_midi`   | 0x00010b90 | Routes MIDI status bytes                  |
| `apply_filters`  | 0x000112ae | Note/velocity/channel filter matching     |
| `write_boundary` | 0x00010ce6 | Writes `0x7FFFFFFF` boundary markers      |
| `update_timer`   | 0x000172ac | Converts tempo to hardware timer period   |
| `note_range_check` | 0x00014ac8 | Validates note against range filter     |
| `bar_handler`    | case 0x30  | Updates bar counters and column pointers  |
| `sysex_handler`  | case 0xF0  | Follows continuation chains               |

See [NOTATOR_ANNOTATED.md](../st/NOTATOR_ANNOTATED.md) for detailed function annotations.
