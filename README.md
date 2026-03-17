# Notator Online 🎹

> The Atari ST Sequencer, in your browser

**🌐 Live Demo: [notator.online](https://notator.online)**

A browser-based player and parser for **Notator SL 3.21** `.SON` files, built with modern Web Audio and Web MIDI APIs. A tribute to the legendary C-Lab/eMagic Notator sequencer for the Atari ST.

## ✨ Features

- **Complete `.SON` parser** — all 14+ event types (confirmed via Ghidra decompilation of `NOTATOR.PRG`)
- **General MIDI playback** — realistic instrument sounds via [WebAudioFont](https://github.com/surikov/webaudiofont) (FluidR3 GM SoundFont)
- **Full GM drum kit** on channel 10 with real kick, snare, hi-hat, cymbal samples
- **Program Change** support — songs that specify instruments switch sounds correctly
- **Arrangement playback** — automatic pattern sequencing (auto-advance to next pattern)
- **Web MIDI output** — route audio to connected hardware synths/modules
- **Round-trip serializer** — parse → edit → write back byte-identical `.SON` files
- **SysEx chain support** — multi-record System Exclusive messages via continuation bit
- **Transport controls** — play, pause, stop, tempo adjustment
- **Track mute/solo** — per-track audio control
- **Demo files included** — 4 bundled `.SON` files from Notator tutorials

## 🛠 Tech Stack

| Layer     | Technology                                         |
| --------- | -------------------------------------------------- |
| Framework | **Next.js 16** (App Router, static export)         |
| UI        | **React 19** + **Tailwind CSS 4**                  |
| Audio     | **WebAudioFont** (GM SoundFont) + **Web MIDI API** |
| Parser    | TypeScript — complete round-trip `.SON` format     |
| Hosting   | **Cloudflare Pages** (static)                      |

## 📁 Project Structure

```
notator-web/
├── app/                           # Next.js App Router
│   ├── layout.tsx                 # Root layout + metadata
│   ├── page.tsx                   # Landing page
│   ├── player/page.tsx            # Main player view
│   └── globals.css                # Notator dark theme
├── components/
│   ├── ui/FileDropZone.tsx        # Drag-and-drop .SON upload
│   ├── transport/TransportBar.tsx # Play/stop/pause/tempo controls
│   └── tracks/TrackList.tsx       # Track display + mute/solo
├── lib/
│   ├── son-parser/
│   │   ├── index.ts               # Full .SON parser (all event types)
│   │   ├── types.ts               # SonFile, TrackSlot, 14+ event types
│   │   └── serializer.ts          # Write .SON files back to binary
│   ├── midi/
│   │   ├── web-midi.ts            # Web MIDI API wrapper
│   │   └── synth-fallback.ts      # WebAudioFont GM synth engine
│   └── playback/
│       └── engine.ts              # Lookahead scheduler + pattern sequencing
├── public/
│   ├── demos/                     # Bundled .SON demo files
│   └── webaudiofont/              # Vendored WebAudioFont player
├── tools/
│   └── notator-floppy/               # Floppy disk reader tool
│       ├── notator_floppy.py          # CLI for disk detection/extraction
│       ├── notator_floppy_gui.py      # GUI for bulk transfers
│       ├── disk_reader.py             # Raw disk reading (macOS/Linux/Win)
│       └── atari_fat.py               # Atari ST FAT12 filesystem parser
├── types/
│   └── webaudiofont.d.ts          # TypeScript declarations
└── next.config.ts                 # Static export config
```

## 💾 Floppy Disk Companion Tool

A Python-based CLI and GUI for reading Atari ST floppy disks, extracting `.SON` files, and creating disk images. Perfect for bulk-transferring an entire collection of Notator floppies.

### Requirements

- Python 3.8+
- USB floppy drive
- `sudo` access on macOS/Linux for raw disk reading

### Quick Start

```bash
cd tools/notator-floppy

# CLI: Detect connected floppy drives
python3 notator_floppy.py detect

# CLI: Extract all files from a floppy
sudo python3 notator_floppy.py extract --output-dir ./my_songs

# CLI: Create a raw disk image backup (.ST format)
sudo python3 notator_floppy.py image my_backup.st

# GUI: Launch the bulk transfer interface
python3 notator_floppy_gui.py
```

### Bulk Transfer Workflow

The GUI automates the process of archiving a large floppy collection:

1. **Insert** an Atari ST floppy disk
2. The tool **reads** the disk, **extracts** all files, and **saves** a raw `.ST` disk image
3. A completion sound plays and the disk is **auto-ejected**
4. **Insert** the next disk — the tool auto-detects it and repeats

All extracted files and disk images are saved to `tools/notator-floppy/floppy_archive/` (gitignored).

## 🚀 Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production (static export)
npm run build

# Preview the static build
npx serve out
```

Open [http://localhost:3000](http://localhost:3000) to see the app, or visit the live version at [notator.online](https://notator.online).

## 🎹 Usage

1. Open the player at [notator.online/player](https://notator.online/player) (or `/player` locally)
2. Drag & drop a `.SON` file or click one of the demo files
3. Press **Start** — audio plays through:
   - **WebAudioFont GM synth** — realistic instrument sounds (default)
   - **Connected MIDI devices** — via Web MIDI API (if available)
4. Songs automatically advance through patterns in the arrangement
5. Use **Mute (M)** and **Solo (S)** buttons on individual tracks
6. Adjust tempo with the tempo input field

## 📄 .SON File Format

The `.SON` format is a proprietary binary format used by Notator SL/Creator on the Atari ST. This parser supports the complete format, verified against Ghidra decompilation of `NOTATOR.PRG 3.21`:

### File Layout

| Region         | Offset   | Description                                       |
| -------------- | -------- | ------------------------------------------------- |
| Header         | `0x0000` | Magic, tempo, ticks/measure, instrument names     |
| Channel Config | `0x0330` | MIDI channels, programs, volumes, pans (16 slots) |
| Arrangement    | `0x0370` | Pattern sequencing data                           |
| Track Data     | `0x5AC8` | Boundary-separated track slots                    |

### Event Types (6 bytes each)

| Status (& 0xF0) | Type             | Description                             |
| --------------- | ---------------- | --------------------------------------- |
| `0x00`          | Meta             | Pattern end markers, system events      |
| `0x30`          | Bar Marker       | Bar/pattern boundary markers            |
| `0x40`          | Track Setup      | Track initialization data               |
| `0x60`          | Track Config     | Filter flags, channel/port assignment   |
| `0x70`          | Notation         | Display-only notation data              |
| `0x80`          | Note Off         | MIDI note release                       |
| `0x90`          | Note On          | MIDI note with velocity                 |
| `0xA0`          | Aftertouch       | Polyphonic key pressure                 |
| `0xB0`          | Control Change   | CC messages (sustain, modulation, etc.) |
| `0xC0`          | Program Change   | GM instrument selection                 |
| `0xD0`          | Channel Pressure | Monophonic aftertouch                   |
| `0xE0`          | Pitch Wheel      | Pitch bend data                         |
| `0xF0`          | SysEx            | System Exclusive (multi-record chains)  |

### Key Details

- **768 ticks per measure** (192 ticks per beat in 4/4)
- **Track boundaries**: `7F FF FF FF` (type A) or `00 0F FF FF` (type B)
- **SysEx continuation**: `byte[5] & 0x80` chains records into single messages
- **Track preamble**: 24-byte header + 8-byte name + 14-byte config = 46 bytes per slot

## 🔧 Round-Trip Serialization

The parser preserves all raw data for byte-exact reconstruction:

```typescript
import { parseSonFile } from "./lib/son-parser";
import { serializeSonFile } from "./lib/son-parser/serializer";

const buffer = await file.arrayBuffer();
const sonFile = parseSonFile(buffer);

// Modify sonFile.header, events, etc.

const output = serializeSonFile(sonFile);
// output is byte-identical to input if no edits were made
```

## 🔬 Reverse Engineering

The `.SON` format specification was derived from:

1. **Hex analysis** of 15 `.SON` files from Notator tutorials
2. **Ghidra decompilation** of `NOTATOR.PRG 3.21` using a custom [RetroGhidra](https://github.com/hippietrail/RetroGhidra) Atari ST loader (ported to Ghidra 12 API)
3. **`FUN_000149dc`** — the 666-line main event dispatcher (`switch(status & 0xF0)`)
4. Prior work by [Simon Cozens (son2midi)](https://github.com/simoncozens/son2midi)

## 📝 License

MIT

## 🙏 Credits

- **Notator SL** — C-Lab / eMagic (Gerhard Lengeling)
- **son2midi** — [Simon Cozens](https://github.com/simoncozens/son2midi) for initial .SON reverse engineering
- **WebAudioFont** — [Sergey Surikov](https://github.com/surikov/webaudiofont) for GM SoundFont samples
- **RetroGhidra** — [Andrew Dunstan](https://github.com/hippietrail/RetroGhidra) for the Atari ST Ghidra loader
- **Atari ST** community for preserving these files
