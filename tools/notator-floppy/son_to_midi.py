#!/usr/bin/env python3
"""
Bulk Notator .SON → Standard MIDI File (.mid) Converter

Converts Notator SL .SON files into Standard MIDI Files (SMF Type 1).
Ported from the TypeScript parser (lib/son-parser/index.ts) and MIDI
exporter (lib/midi/midi-file-export.ts).

Zero external dependencies — uses only Python 3 builtins.

Usage:
    python3 son_to_midi.py floppy_archive/              # bulk convert
    python3 son_to_midi.py floppy_archive/disk_001/      # one disk
    python3 son_to_midi.py path/to/SONG.SON              # single file
"""

import struct
import sys
import os
import re
import argparse
from pathlib import Path


# ═══════════════════════════════════════════════════════════════════════
# CONSTANTS (mirrored from TypeScript parser)
# ═══════════════════════════════════════════════════════════════════════

MAGIC = 0x3B9E
TRACK_DATA_OFFSET = 0x5AC8

TEMPO_OFFSET = 0x0006
TICKS_PER_MEASURE_OFFSET = 0x0022
INSTRUMENT_NAMES_OFFSET = 0x0064
INSTRUMENT_NAME_LENGTH = 9
MAX_INSTRUMENTS = 16
CHANNEL_MAP_OFFSET = 0x0330
PROGRAM_MAP_OFFSET = 0x0340
VOLUME_MAP_OFFSET = 0x0350
PAN_MAP_OFFSET = 0x0360

TRACK_POINTER_TABLE_OFFSET = 0x0502
TRACK_POINTER_ENTRY_SIZE = 4
EMPTY_TRACK_POINTER = 0x1D40
TRACKS_PER_PATTERN = 16

TRACK_HEADER_SIZE = 24
TRACK_NAME_SIZE = 8
TRACK_CONFIG_SIZE = 14
TRACK_PREAMBLE = TRACK_HEADER_SIZE + TRACK_NAME_SIZE + TRACK_CONFIG_SIZE  # 46
EVENT_SIZE = 6

ARRANGE_TABLE_OFFSET = 0x20BE
ARRANGE_ENTRY_SIZE = 24
ARRANGE_SIG_0 = 0x80
ARRANGE_SIG_1 = 0xD2

BOUNDARY_A = bytes([0x7F, 0xFF, 0xFF, 0xFF])
BOUNDARY_B = bytes([0x00, 0x0F, 0xFF, 0xFF])

PATTERN_NAME_TABLE_OFFSET = 0x21BE
MAX_PATTERN_NAMES = 16
PATTERN_NAME_SIZE = 8
DEFAULT_PATTERN_NAMES = ["Pattern:", "Name"]


# ═══════════════════════════════════════════════════════════════════════
# DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════════════

class TrackConfig:
    __slots__ = ('midi_channel', 'midi_port', 'note_range_low', 'note_range_high')

    def __init__(self, midi_channel=0, midi_port=0, note_range_low=0, note_range_high=0):
        self.midi_channel = midi_channel
        self.midi_port = midi_port
        self.note_range_low = note_range_low
        self.note_range_high = note_range_high


class TrackSlot:
    __slots__ = ('raw_header', 'name', 'config', 'events', 'has_playable_events')

    def __init__(self, raw_header, name, config, events, has_playable_events):
        self.raw_header = raw_header
        self.name = name
        self.config = config
        self.events = events
        self.has_playable_events = has_playable_events


class ChannelCfg:
    __slots__ = ('channels', 'programs', 'volumes', 'pans')

    def __init__(self, channels, programs, volumes, pans):
        self.channels = channels
        self.programs = programs
        self.volumes = volumes
        self.pans = pans


class SonHeader:
    __slots__ = ('magic', 'tempo', 'ticks_per_measure', 'ticks_per_beat',
                 'instrument_names', 'channel_config')

    def __init__(self, magic, tempo, ticks_per_measure, ticks_per_beat,
                 instrument_names, channel_config):
        self.magic = magic
        self.tempo = tempo
        self.ticks_per_measure = ticks_per_measure
        self.ticks_per_beat = ticks_per_beat
        self.instrument_names = instrument_names
        self.channel_config = channel_config


class Pattern:
    __slots__ = ('index', 'name', 'tracks', 'total_ticks')

    def __init__(self, index, name, tracks, total_ticks):
        self.index = index
        self.name = name
        self.tracks = tracks
        self.total_ticks = total_ticks


class Track:
    __slots__ = ('name', 'channel', 'track_index', 'events')

    def __init__(self, name, channel, track_index, events):
        self.name = name
        self.channel = channel
        self.track_index = track_index
        self.events = events


class ArrangementEntry:
    __slots__ = ('pattern_index', 'bar', 'length', 'name')

    def __init__(self, pattern_index, bar, length, name):
        self.pattern_index = pattern_index
        self.bar = bar
        self.length = length
        self.name = name


class SongData:
    __slots__ = ('tracks', 'patterns', 'arrangement', 'ticks_per_beat',
                 'ticks_per_measure', 'total_ticks', 'tempo', 'channel_config')

    def __init__(self, tracks, patterns, arrangement, ticks_per_beat,
                 ticks_per_measure, total_ticks, tempo, channel_config):
        self.tracks = tracks
        self.patterns = patterns
        self.arrangement = arrangement
        self.ticks_per_beat = ticks_per_beat
        self.ticks_per_measure = ticks_per_measure
        self.total_ticks = total_ticks
        self.tempo = tempo
        self.channel_config = channel_config


# ═══════════════════════════════════════════════════════════════════════
# HEADER PARSING
# ═══════════════════════════════════════════════════════════════════════

def u16be(data, offset):
    """Read a big-endian uint16."""
    return (data[offset] << 8) | data[offset + 1]


def decode_ascii(data, offset, length):
    """Decode ASCII bytes, stopping at null."""
    chars = []
    for i in range(length):
        b = data[offset + i]
        if b == 0:
            break
        chars.append(chr(b) if 32 <= b < 127 else ' ')
    return ''.join(chars).strip()


def parse_header(data):
    """Parse the .SON file header."""
    magic = u16be(data, 0)
    tempo = u16be(data, TEMPO_OFFSET) or 120
    ticks_per_measure = u16be(data, TICKS_PER_MEASURE_OFFSET) or 768
    ticks_per_beat = ticks_per_measure // 4

    instrument_names = []
    for i in range(MAX_INSTRUMENTS):
        offset = INSTRUMENT_NAMES_OFFSET + i * INSTRUMENT_NAME_LENGTH
        if offset + INSTRUMENT_NAME_LENGTH > len(data):
            break
        instrument_names.append(decode_ascii(data, offset, INSTRUMENT_NAME_LENGTH))

    channel_config = ChannelCfg(
        channels=list(data[CHANNEL_MAP_OFFSET:CHANNEL_MAP_OFFSET + MAX_INSTRUMENTS]),
        programs=list(data[PROGRAM_MAP_OFFSET:PROGRAM_MAP_OFFSET + MAX_INSTRUMENTS]),
        volumes=list(data[VOLUME_MAP_OFFSET:VOLUME_MAP_OFFSET + MAX_INSTRUMENTS]),
        pans=list(data[PAN_MAP_OFFSET:PAN_MAP_OFFSET + MAX_INSTRUMENTS]),
    )

    return SonHeader(
        magic=magic,
        tempo=tempo,
        ticks_per_measure=ticks_per_measure,
        ticks_per_beat=ticks_per_beat,
        instrument_names=instrument_names,
        channel_config=channel_config,
    )


# ═══════════════════════════════════════════════════════════════════════
# TRACK CONFIG PARSING
# ═══════════════════════════════════════════════════════════════════════

def parse_track_config(raw):
    """Parse the 14-byte track config block."""
    channel_byte = raw[3] if len(raw) > 3 else 0
    port_byte = raw[5] if len(raw) > 5 else 0
    return TrackConfig(
        midi_channel=channel_byte & 0x1F,
        midi_port=port_byte & 0x0F,
        note_range_low=raw[9] if len(raw) > 9 else 0,
        note_range_high=raw[10] if len(raw) > 10 else 0,
    )


# ═══════════════════════════════════════════════════════════════════════
# EVENT PARSING
# ═══════════════════════════════════════════════════════════════════════

# Event is a dict with at least 'type' and 'tick' keys

PLAYABLE_TYPES = frozenset([
    'note_on', 'note_off', 'aftertouch', 'control_change',
    'program_change', 'channel_pressure', 'pitch_wheel', 'sysex'
])


def parse_all_events(data):
    """Parse all 6-byte event records from track event data."""
    events = []
    num_records = len(data) // EVENT_SIZE
    i = 0

    while i < num_records:
        offset = i * EVENT_SIZE
        note = data[offset]
        status = data[offset + 1]
        pos_hi = data[offset + 2]
        pos_lo = data[offset + 3]
        vel = data[offset + 4]
        arg = data[offset + 5]
        tick = pos_hi * 256 + pos_lo
        status_hi = status & 0xF0

        if status_hi == 0x90:
            adjusted_vel = vel - 0x80
            if adjusted_vel <= 0:
                events.append({'type': 'note_off', 'tick': tick, 'note': note})
            else:
                events.append({
                    'type': 'note_on', 'tick': tick, 'note': note,
                    'velocity': min(127, max(1, adjusted_vel))
                })

        elif status_hi == 0x80:
            events.append({'type': 'note_off', 'tick': tick, 'note': note})

        elif status_hi == 0xA0:
            events.append({'type': 'aftertouch', 'tick': tick, 'note': note, 'pressure': vel & 0x7F})

        elif status_hi == 0xB0:
            events.append({'type': 'control_change', 'tick': tick, 'controller': note, 'value': vel})

        elif status_hi == 0xC0:
            events.append({'type': 'program_change', 'tick': tick, 'program': note & 0x7F})

        elif status_hi == 0xD0:
            events.append({'type': 'channel_pressure', 'tick': tick, 'pressure': note & 0x7F})

        elif status_hi == 0xE0:
            events.append({
                'type': 'pitch_wheel', 'tick': tick,
                'value': round((vel - 0x80) * (8192 / 128))
            })

        elif status_hi == 0xF0:
            # SysEx with continuation chain
            sysex_bytes = [0xF0, note & 0x7F]
            if vel != 0:
                sysex_bytes.append(vel & 0x7F)
            ci = i
            while ci < num_records - 1 and (data[ci * EVENT_SIZE + 5] & 0x80) != 0:
                ci += 1
                c_offset = ci * EVENT_SIZE
                for b in range(5):
                    if data[c_offset + b] != 0:
                        sysex_bytes.append(data[c_offset + b] & 0x7F)
            if sysex_bytes[-1] != 0xF7:
                sysex_bytes.append(0xF7)
            events.append({'type': 'sysex', 'tick': tick, 'data': bytes(sysex_bytes)})
            i = ci

        # Non-MIDI types (0x00, 0x30, 0x40, 0x60, 0x70) — skip for MIDI export

        i += 1

    return events


# ═══════════════════════════════════════════════════════════════════════
# BOUNDARY SPLITTING
# ═══════════════════════════════════════════════════════════════════════

def matches_boundary(data, pos):
    """Check if pos has a boundary marker. Returns 'A', 'B', or None."""
    if pos + 4 > len(data):
        return None
    seg = bytes(data[pos:pos + 4])
    if seg == BOUNDARY_A:
        return 'A'
    if seg == BOUNDARY_B:
        return 'B'
    return None


def split_on_boundaries(data, start_offset):
    """Split the data region into chunks delimited by boundary markers.
    Returns list of (chunk_bytes, absolute_file_offset_of_boundary)."""
    region = data[start_offset:]
    positions = []
    for i in range(len(region) - 3):
        btype = matches_boundary(region, i)
        if btype:
            positions.append((i, btype))

    results = []
    for idx, (pos, btype) in enumerate(positions):
        abs_offset = start_offset + pos
        start = pos + 4
        end = positions[idx + 1][0] if idx + 1 < len(positions) else len(region)
        chunk = region[start:end] if end > start else b''
        results.append((bytes(chunk), abs_offset))

    return results


# ═══════════════════════════════════════════════════════════════════════
# TRACK SLOT PARSING
# ═══════════════════════════════════════════════════════════════════════

def parse_track_slot(chunk):
    """Parse a track data chunk into a TrackSlot."""
    if len(chunk) < TRACK_PREAMBLE:
        return TrackSlot(
            raw_header=chunk[:min(TRACK_HEADER_SIZE, len(chunk))],
            name='', config=TrackConfig(), events=[], has_playable_events=False
        )

    raw_header = chunk[:TRACK_HEADER_SIZE]
    raw_name = chunk[TRACK_HEADER_SIZE:TRACK_HEADER_SIZE + TRACK_NAME_SIZE]
    raw_config = chunk[TRACK_HEADER_SIZE + TRACK_NAME_SIZE:TRACK_PREAMBLE]
    event_data = chunk[TRACK_PREAMBLE:]

    name = decode_ascii(raw_name, 0, len(raw_name))
    config = parse_track_config(raw_config)
    events = parse_all_events(event_data)
    has_playable = any(e['type'] in PLAYABLE_TYPES for e in events)

    return TrackSlot(
        raw_header=raw_header, name=name, config=config,
        events=events, has_playable_events=has_playable
    )


# ═══════════════════════════════════════════════════════════════════════
# PATTERN NAME TABLE
# ═══════════════════════════════════════════════════════════════════════

def parse_pattern_names(data):
    """Parse the pattern name table at 0x21BE."""
    off = PATTERN_NAME_TABLE_OFFSET
    if off + PATTERN_NAME_SIZE > len(data):
        return []

    # Validate entry[0] is printable ASCII
    for j in range(PATTERN_NAME_SIZE):
        b = data[off + j]
        if b == 0:
            break
        if b < 0x20 or b >= 0x7F:
            return []

    first_entry = decode_ascii(data, off, PATTERN_NAME_SIZE)
    valid = any(first_entry == d or first_entry.startswith(d.rstrip(':'))
                for d in DEFAULT_PATTERN_NAMES)
    if not valid:
        return []

    names = []
    for i in range(MAX_PATTERN_NAMES):
        name_off = off + i * PATTERN_NAME_SIZE
        if name_off + PATTERN_NAME_SIZE > len(data):
            break
        names.append(decode_ascii(data, name_off, PATTERN_NAME_SIZE))
    return names


# ═══════════════════════════════════════════════════════════════════════
# POINTER TABLE & SONG DATA
# ═══════════════════════════════════════════════════════════════════════

def read_track_pointer(data, p, t):
    """Read the full 32-bit track pointer for pattern p, track t."""
    entry_offset = (TRACK_POINTER_TABLE_OFFSET
                    + p * TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE
                    + t * TRACK_POINTER_ENTRY_SIZE)
    if entry_offset + 4 > len(data):
        return 0
    ptr_low = u16be(data, entry_offset)

    ptr_high = 0
    if t > 0:
        prev_offset = entry_offset - TRACK_POINTER_ENTRY_SIZE
        ptr_high = u16be(data, prev_offset + 2)
    elif p > 0:
        prev_row_last = (TRACK_POINTER_TABLE_OFFSET
                         + (p - 1) * TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE
                         + (TRACKS_PER_PATTERN - 1) * TRACK_POINTER_ENTRY_SIZE)
        if prev_row_last + 4 <= len(data):
            ptr_high = u16be(data, prev_row_last + 2)
    else:
        init_high_offset = TRACK_POINTER_TABLE_OFFSET - 2
        if 0 <= init_high_offset and init_high_offset + 2 <= len(data):
            ptr_high = u16be(data, init_high_offset)

    return (ptr_high << 16) | ptr_low


def is_empty_pointer(ptr):
    return ptr == EMPTY_TRACK_POINTER or ptr == 0


def slot_to_track(slot, track_index, header):
    """Convert a TrackSlot to a playable Track (or None)."""
    if not slot.has_playable_events:
        return None

    midi_events = [e for e in slot.events if e['type'] in PLAYABLE_TYPES]
    if not midi_events:
        return None

    # Resolve MIDI channel
    channel = track_index
    header_ch_byte = slot.raw_header[5] if len(slot.raw_header) > 5 else 0
    if 0 < header_ch_byte <= 16:
        channel = header_ch_byte - 1
    elif slot.config.midi_channel > 0:
        channel = slot.config.midi_channel - 1
    else:
        ch_cfg = header.channel_config.channels
        if track_index < len(ch_cfg) and ch_cfg[track_index] <= 15:
            channel = ch_cfg[track_index]

    # Drums detection
    is_drums = (channel == 9
                or bool(re.search(r'drum|percuss', slot.name, re.IGNORECASE))
                or track_index == 9)
    if is_drums:
        channel = 9

    return Track(name=slot.name, channel=channel, track_index=track_index, events=midi_events)


# ═══════════════════════════════════════════════════════════════════════
# ARRANGEMENT PARSING
# ═══════════════════════════════════════════════════════════════════════

def parse_arrangement(data, patterns, ticks_per_measure):
    """Parse the arrangement table (24-byte entries at 0x20BE)."""
    entries = []

    # Check if the arrangement table exists
    off = ARRANGE_TABLE_OFFSET
    has_table = False
    if off + ARRANGE_ENTRY_SIZE * 3 <= len(data):
        has_table = True
        for e in range(3):
            e_off = off + e * ARRANGE_ENTRY_SIZE
            if data[e_off + 22] != ARRANGE_SIG_0 or data[e_off + 23] != ARRANGE_SIG_1:
                has_table = False
                break

    if has_table:
        # Read tick positions for bar-length detection
        tick_positions = []
        for e in range(64):
            e_off = off + e * ARRANGE_ENTRY_SIZE
            if e_off + ARRANGE_ENTRY_SIZE > len(data):
                break
            ac = data[e_off]
            if ac == 127 or ac == 0:
                break
            b1 = data[e_off + 1]
            tp16 = u16be(data, e_off + 2)
            tick_positions.append((b1 & 0x01) * 0x10000 + tp16)

        ticks_per_bar = ticks_per_measure if ticks_per_measure > 0 else 768
        if len(tick_positions) >= 2:
            min_delta = float('inf')
            for i in range(1, len(tick_positions)):
                d = tick_positions[i] - tick_positions[i - 1]
                if 0 < d < min_delta:
                    min_delta = d
            if min_delta < float('inf') and min_delta >= 48:
                ticks_per_bar = min_delta

        base_tick = -1
        for e in range(64):
            e_off = off + e * ARRANGE_ENTRY_SIZE
            if e_off + ARRANGE_ENTRY_SIZE > len(data):
                break

            a_col = data[e_off]
            byte1 = data[e_off + 1]
            tick_pos16 = u16be(data, e_off + 2)
            page_bit = byte1 & 0x01
            tick_pos = page_bit * 0x10000 + tick_pos16

            # Read name (bytes 12-20)
            name_chars = []
            for j in range(12, 21):
                b = data[e_off + j] & 0x7F
                if 32 <= b < 127:
                    name_chars.append(chr(b))
            name = ''.join(name_chars).strip()

            if a_col == 127:
                break
            if a_col == 0 and (name == 'stop' or name == ''):
                break

            if base_tick < 0:
                base_tick = tick_pos
            bar = (tick_pos - base_tick) // ticks_per_bar + 1

            pat = None
            for p in patterns:
                if p.index == a_col - 1:
                    pat = p
                    break

            is_default = any(name.startswith(d.rstrip(':')) for d in DEFAULT_PATTERN_NAMES)
            display_name = name if name and not is_default else (pat.name if pat else f'Pattern {a_col}')

            entries.append(ArrangementEntry(
                pattern_index=a_col - 1, bar=bar, length=1, name=display_name
            ))

        # Compute bar lengths
        for i in range(len(entries) - 1):
            entries[i].length = entries[i + 1].bar - entries[i].bar
        if entries:
            entries[-1].length = max(1, entries[-2].length if len(entries) > 1 else 4)

    if not entries:
        # Fallback: one entry per pattern
        bar = 1
        for pat in patterns:
            if not pat.tracks:
                continue
            bar_length = max(1, -(-pat.total_ticks // ticks_per_measure))  # ceil div
            entries.append(ArrangementEntry(
                pattern_index=pat.index, bar=bar, length=bar_length, name=pat.name
            ))
            bar += bar_length

    return entries


# ═══════════════════════════════════════════════════════════════════════
# MAIN PARSER
# ═══════════════════════════════════════════════════════════════════════

def parse_son_file(data):
    """Parse a .SON file into a SongData structure."""
    if len(data) < TRACK_DATA_OFFSET:
        # Check magic before rejecting — might just be a small/corrupt file
        if len(data) >= 2:
            magic = u16be(data, 0)
            if magic != MAGIC:
                raise ValueError(f'Bad magic: 0x{magic:04X} (expected 0x{MAGIC:04X})')
        raise ValueError(f'File too small ({len(data)} bytes, need {TRACK_DATA_OFFSET})')

    header = parse_header(data)
    if header.magic != MAGIC:
        raise ValueError(f'Bad magic: 0x{header.magic:04X} (expected 0x{MAGIC:04X})')

    # Split on track boundaries
    boundary_scan_start = (TRACK_POINTER_TABLE_OFFSET
                           + 24 * TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE)
    boundary_results = split_on_boundaries(data, boundary_scan_start)

    track_slots = [parse_track_slot(chunk) for chunk, _ in boundary_results]

    # Build offset → slot map
    slot_by_offset = {}
    for idx, (_, abs_offset) in enumerate(boundary_results):
        if idx < len(track_slots):
            data_start = abs_offset + 4
            slot_by_offset[data_start + 2] = track_slots[idx]

    # Pattern names
    pattern_names = parse_pattern_names(data)

    # Determine number of patterns from pointer table
    max_table_patterns = ((TRACK_DATA_OFFSET - TRACK_POINTER_TABLE_OFFSET)
                          // (TRACKS_PER_PATTERN * TRACK_POINTER_ENTRY_SIZE))
    num_patterns = 0
    # Also check if pointer table entries actually resolve to known slots
    pointer_table_resolves = False
    for p in range(max_table_patterns):
        has_entry = False
        for t in range(TRACKS_PER_PATTERN):
            ptr = read_track_pointer(data, p, t)
            if not is_empty_pointer(ptr):
                has_entry = True
                if ptr in slot_by_offset:
                    pointer_table_resolves = True
                break
        if has_entry:
            num_patterns = p + 1

    if num_patterns == 0:
        num_patterns = max(1, -(-len(track_slots) // TRACKS_PER_PATTERN))  # ceil div

    # Use pointer table only if at least one entry actually resolves to a slot
    has_pointer_table = pointer_table_resolves

    # Build patterns
    patterns = []
    for p in range(num_patterns):
        pattern_tracks = []
        pattern_slots_list = []

        for t in range(TRACKS_PER_PATTERN):
            slot = None
            if has_pointer_table:
                ptr = read_track_pointer(data, p, t)
                if not is_empty_pointer(ptr):
                    slot = slot_by_offset.get(ptr)
            else:
                slot_idx = p * TRACKS_PER_PATTERN + t
                slot = track_slots[slot_idx] if slot_idx < len(track_slots) else None

            pattern_slots_list.append(slot)

            if slot:
                track = slot_to_track(slot, t, header)
                if track:
                    pattern_tracks.append(track)
                else:
                    pattern_tracks.append(Track(name=slot.name or '', channel=t,
                                                track_index=t, events=[]))
            else:
                pattern_tracks.append(Track(name='', channel=t, track_index=t, events=[]))

        # Pattern naming
        table_name_idx = p + 1
        table_name = pattern_names[table_name_idx] if table_name_idx < len(pattern_names) else None
        is_default = (not table_name or
                      any(table_name.startswith(d.rstrip(':')) for d in DEFAULT_PATTERN_NAMES))

        if not is_default and table_name:
            pat_name = table_name
        else:
            pat_name = f'Pattern {p + 1}'
            for slot in pattern_slots_list:
                if slot and slot.name and slot.name.strip() and slot.name.strip() != 'Name':
                    pat_name = slot.name.strip()
                    break

        total_ticks = 0
        for tr in pattern_tracks:
            if tr.events:
                last_tick = tr.events[-1]['tick']
                if last_tick > total_ticks:
                    total_ticks = last_tick

        has_any_events = any(len(tr.events) > 0 for tr in pattern_tracks)
        if has_any_events:
            patterns.append(Pattern(index=p, name=pat_name, tracks=pattern_tracks,
                                    total_ticks=total_ticks))

    # Arrangement
    arrangement = parse_arrangement(data, patterns, header.ticks_per_measure)

    active_pattern = patterns[0] if patterns else None
    active_tracks = active_pattern.tracks if active_pattern else []
    total_ticks = active_pattern.total_ticks if active_pattern else 0

    return SongData(
        tracks=active_tracks,
        patterns=patterns,
        arrangement=arrangement,
        ticks_per_beat=header.ticks_per_beat,
        ticks_per_measure=header.ticks_per_measure,
        total_ticks=total_ticks,
        tempo=header.tempo,
        channel_config=header.channel_config,
    )


# ═══════════════════════════════════════════════════════════════════════
# MIDI FILE EXPORT
# ═══════════════════════════════════════════════════════════════════════

def vlq(value):
    """Encode a non-negative integer as a MIDI variable-length quantity."""
    if value < 0:
        value = 0
    if value < 0x80:
        return bytes([value])
    out = []
    out.insert(0, value & 0x7F)
    value >>= 7
    while value > 0:
        out.insert(0, (value & 0x7F) | 0x80)
        value >>= 7
    return bytes(out)


def encode_text(text):
    """Encode a string as ASCII bytes."""
    return bytes(b if b < 128 else 0x3F for b in text.encode('ascii', errors='replace'))


def build_conductor_track(song, song_name=None):
    """Build SMF Track 0 (tempo, time sig, song name)."""
    events = bytearray()

    # Song name meta-event (FF 03)
    name = song_name or 'Notator Export'
    name_bytes = encode_text(name)
    events += vlq(0)
    events += bytes([0xFF, 0x03])
    events += vlq(len(name_bytes))
    events += name_bytes

    # Tempo meta-event (FF 51 03)
    tempo = song.tempo or 120
    us_per_beat = round(60_000_000 / tempo)
    events += vlq(0)
    events += bytes([0xFF, 0x51, 0x03])
    events += bytes([
        (us_per_beat >> 16) & 0xFF,
        (us_per_beat >> 8) & 0xFF,
        us_per_beat & 0xFF,
    ])

    # Time signature meta-event (FF 58 04)
    ticks_per_measure = song.ticks_per_measure or 768
    ticks_per_beat = song.ticks_per_beat or 192
    beats_per_bar = round(ticks_per_measure / ticks_per_beat)
    events += vlq(0)
    events += bytes([0xFF, 0x58, 0x04])
    events += bytes([beats_per_bar, 2, 24, 8])  # denominator=2 (quarter), 24 clocks, 8 32nds

    # End of track
    events += vlq(0)
    events += bytes([0xFF, 0x2F, 0x00])

    return wrap_track_chunk(bytes(events))


def build_midi_track(track_events, channel, track_name, song):
    """Build an SMF track chunk from a list of events."""
    events = bytearray()
    ch = channel & 0x0F

    # Track name
    if track_name:
        name_bytes = encode_text(track_name)
        events += vlq(0)
        events += bytes([0xFF, 0x03])
        events += vlq(len(name_bytes))
        events += name_bytes

    # Initial channel setup
    program = song.channel_config.programs[ch] if ch < len(song.channel_config.programs) else 0
    if program > 0:
        events += vlq(0)
        events += bytes([0xC0 | ch, program & 0x7F])

    volume = song.channel_config.volumes[ch] if ch < len(song.channel_config.volumes) else 0
    if volume > 0:
        events += vlq(0)
        events += bytes([0xB0 | ch, 0x07, volume & 0x7F])

    pan = song.channel_config.pans[ch] if ch < len(song.channel_config.pans) else 0
    if pan > 0:
        events += vlq(0)
        events += bytes([0xB0 | ch, 0x0A, pan & 0x7F])

    # Events with delta times
    last_tick = 0
    for event in track_events:
        delta = max(0, event['tick'] - last_tick)
        last_tick = event['tick']
        etype = event['type']

        if etype == 'note_on':
            events += vlq(delta)
            events += bytes([0x90 | ch, event['note'] & 0x7F, event['velocity'] & 0x7F])

        elif etype == 'note_off':
            events += vlq(delta)
            events += bytes([0x80 | ch, event['note'] & 0x7F, 0x00])

        elif etype == 'control_change':
            events += vlq(delta)
            events += bytes([0xB0 | ch, event['controller'] & 0x7F, event['value'] & 0x7F])

        elif etype == 'program_change':
            events += vlq(delta)
            events += bytes([0xC0 | ch, event['program'] & 0x7F])

        elif etype == 'channel_pressure':
            events += vlq(delta)
            events += bytes([0xD0 | ch, event['pressure'] & 0x7F])

        elif etype == 'aftertouch':
            events += vlq(delta)
            events += bytes([0xA0 | ch, event['note'] & 0x7F, event['pressure'] & 0x7F])

        elif etype == 'pitch_wheel':
            events += vlq(delta)
            midi_val = max(0, min(16383, event['value'] + 8192))
            lsb = midi_val & 0x7F
            msb = (midi_val >> 7) & 0x7F
            events += bytes([0xE0 | ch, lsb, msb])

        elif etype == 'sysex':
            events += vlq(delta)
            sysex_data = event['data']
            if len(sysex_data) > 1:
                events += bytes([0xF0])
                body = sysex_data[1:]  # skip leading F0
                events += vlq(len(body))
                events += body

    # End of track
    events += vlq(0)
    events += bytes([0xFF, 0x2F, 0x00])

    return wrap_track_chunk(bytes(events))


def wrap_track_chunk(data):
    """Wrap track data in an MTrk chunk."""
    chunk = bytearray(b'MTrk')
    chunk += struct.pack('>I', len(data))
    chunk += data
    return bytes(chunk)


def flatten_arrangement(song):
    """Flatten the arrangement into merged tracks by channel."""
    ticks_per_measure = song.ticks_per_measure or 768
    channel_map = {}  # key -> {events, channel, name}
    tick_offset = 0

    for entry in song.arrangement:
        pattern = None
        for p in song.patterns:
            if p.index == entry.pattern_index:
                pattern = p
                break
        if not pattern:
            continue

        entry_duration_ticks = entry.length * ticks_per_measure

        for track in pattern.tracks:
            key = f'{track.channel}:{track.name}'
            if key not in channel_map:
                channel_map[key] = {
                    'events': [], 'channel': track.channel, 'name': track.name
                }
            merged = channel_map[key]
            for event in track.events:
                if event['tick'] >= entry_duration_ticks:
                    continue
                new_event = dict(event)
                new_event['tick'] = event['tick'] + tick_offset
                merged['events'].append(new_event)

        tick_offset += entry_duration_ticks

    # Sort events by tick
    for mt in channel_map.values():
        mt['events'].sort(key=lambda e: e['tick'])

    return list(channel_map.values())


def export_song_to_midi(song, song_name=None):
    """Export SongData to a Standard MIDI File (Type 1) byte array."""
    ppqn = song.ticks_per_beat or 192
    track_chunks = [build_conductor_track(song, song_name)]

    if song.arrangement:
        merged_tracks = flatten_arrangement(song)
        for mt in merged_tracks:
            track_chunks.append(
                build_midi_track(mt['events'], mt['channel'], mt['name'], song)
            )
    else:
        for track in song.tracks:
            track_chunks.append(
                build_midi_track(track.events, track.channel, track.name, song)
            )

    return build_smf_file(ppqn, track_chunks)


def build_smf_file(ppqn, track_chunks):
    """Assemble the complete SMF file: MThd + MTrk chunks."""
    header = bytearray(b'MThd')
    header += struct.pack('>I', 6)               # chunk length
    header += struct.pack('>H', 1)               # format 1
    header += struct.pack('>H', len(track_chunks))
    header += struct.pack('>H', ppqn & 0x7FFF)

    output = bytearray(header)
    for chunk in track_chunks:
        output += chunk

    return bytes(output)


# ═══════════════════════════════════════════════════════════════════════
# SINGLE FILE CONVERSION
# ═══════════════════════════════════════════════════════════════════════

def convert_file(son_path, output_dir=None, verbose=True):
    """Convert a single .SON file to .mid. Returns (success, message)."""
    son_path = Path(son_path)
    if output_dir:
        mid_path = Path(output_dir) / son_path.with_suffix('.mid').name
    else:
        mid_path = son_path.with_suffix('.mid')

    try:
        raw = son_path.read_bytes()
    except OSError as e:
        return False, f'Read error: {e}'

    if len(raw) == 0:
        return False, 'Empty file (0 bytes)'

    if len(raw) < TRACK_DATA_OFFSET:
        magic = raw[0] << 8 | raw[1] if len(raw) >= 2 else 0
        if magic != MAGIC:
            return False, f'Too small ({len(raw)} bytes) and bad magic 0x{magic:04X}'
        return False, f'Too small ({len(raw)} bytes, need {TRACK_DATA_OFFSET})'

    try:
        song = parse_son_file(raw)
    except Exception as e:
        return False, f'Parse error: {e}'

    # Count useful data across ALL patterns (not just active)
    total_notes = sum(
        1 for p in song.patterns for t in p.tracks
        for e in t.events if e['type'] == 'note_on'
    )
    # Also count events that aren't notes but are still musically relevant
    total_midi_events = sum(
        len(t.events) for p in song.patterns for t in p.tracks
    )

    if total_notes == 0 and total_midi_events == 0:
        return False, 'No MIDI events found'

    try:
        midi_data = export_song_to_midi(song, son_path.stem)
    except Exception as e:
        return False, f'MIDI export error: {e}'

    try:
        mid_path.write_bytes(midi_data)
    except OSError as e:
        return False, f'Write error: {e}'

    info = (f'{len(midi_data):,} bytes, '
            f'{len(song.patterns)} pattern(s), '
            f'{len(song.arrangement)} arrangement entries, '
            f'{total_notes} notes, '
            f'{song.tempo} BPM')

    return True, info


# ═══════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='Bulk convert Notator .SON files to Standard MIDI (.mid)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  python3 son_to_midi.py floppy_archive/              # convert all (writes next to source)
  python3 son_to_midi.py floppy_archive/ -o midi_out/ # write to separate directory
  python3 son_to_midi.py floppy_archive/disk_001/     # one disk
  python3 son_to_midi.py path/to/SONG.SON             # single file
  python3 son_to_midi.py floppy_archive/ --dry-run    # preview only
""")
    parser.add_argument('path', help='Path to a .SON file or directory to scan')
    parser.add_argument('-o', '--output-dir',
                        help='Write .mid files to this directory (preserving disk subdirectory structure)')
    parser.add_argument('-n', '--dry-run', action='store_true',
                        help='Show what would be converted without writing files')
    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Show detailed per-file output')
    parser.add_argument('-f', '--force', action='store_true',
                        help='Overwrite existing .mid files')
    args = parser.parse_args()

    target = Path(args.path)
    if not target.exists():
        print(f'Error: {target} does not exist', file=sys.stderr)
        sys.exit(1)

    # Collect .SON files
    if target.is_file():
        son_files = [target]
    else:
        son_files = sorted(target.rglob('*.[sS][oO][nN]'))

    if not son_files:
        print(f'No .SON files found in {target}')
        sys.exit(0)

    print(f'Found {len(son_files)} .SON file(s)\n')

    converted = 0
    skipped = 0
    errors = 0

    for sf in son_files:
        rel = sf.relative_to(target) if target.is_dir() else sf.name

        # Determine output path
        if args.output_dir:
            # Preserve subdirectory structure (e.g. disk_001/SONG.mid)
            if target.is_dir():
                out_path = Path(args.output_dir) / rel.with_suffix('.mid')
            else:
                out_path = Path(args.output_dir) / sf.with_suffix('.mid').name
            out_path.parent.mkdir(parents=True, exist_ok=True)
        else:
            out_path = sf.with_suffix('.mid')

        if out_path.exists() and not args.force:
            if args.verbose:
                print(f'  SKIP  {rel} (already exists)')
            skipped += 1
            continue

        if args.dry_run:
            print(f'  [DRY] {rel} → {out_path.name}')
            continue

        ok, msg = convert_file(sf, output_dir=out_path.parent if args.output_dir else None)
        if ok:
            converted += 1
            print(f'  ✓ {rel} → {out_path.name}  ({msg})')
        else:
            if 'Empty file' in msg or 'Too small' in msg or 'bad magic' in msg:
                skipped += 1
                print(f'  SKIP  {rel}: {msg}')
            else:
                errors += 1
                print(f'  ✗ {rel}: {msg}')

    # Summary
    print(f'\n{"─" * 60}')
    print(f'  Converted: {converted}')
    print(f'  Skipped:   {skipped}')
    print(f'  Errors:    {errors}')
    print(f'  Total:     {len(son_files)}')
    print(f'{"─" * 60}')

    sys.exit(1 if errors > 0 else 0)


if __name__ == '__main__':
    main()
