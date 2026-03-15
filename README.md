# Notator Web 🎹

> The Atari ST Sequencer, in your browser

A fully static, browser-based player that emulates **Notator SL 3.21** `.SON` files using modern Web MIDI and Web Audio APIs. A tribute to the legendary C-Lab/eMagic Notator sequencer for the Atari ST.

## 🎯 Project Goals

**Phase 1 (Current): Playback**
- Parse and play `.SON` files from Notator SL / Creator
- Web MIDI output to connected hardware
- Built-in Web Audio synthesizer fallback
- Transport controls, track muting/soloing

**Phase 2 (Future): Recording & Editing**
- MIDI input recording
- Pattern editing
- Score notation view

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 15** (App Router, static export) |
| UI | **React 19** + **Tailwind CSS 4** |
| Audio | **Web MIDI API** + **Web Audio API** fallback |
| Parser | TypeScript (future: Rust/WASM) |
| Hosting | **Cloudflare Pages** (static) |

## 📁 Project Structure

```
notator/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout + metadata
│   ├── page.tsx                # Landing page
│   ├── player/page.tsx         # Main player view
│   └── globals.css             # Notator theme
├── components/
│   ├── ui/FileDropZone.tsx     # Drag-and-drop .SON upload
│   ├── transport/TransportBar.tsx  # Play/stop/pause controls
│   └── tracks/TrackList.tsx    # Track display + mute/solo
├── lib/
│   ├── son-parser/             # .SON file parser
│   │   ├── index.ts            # Binary format parser
│   │   └── types.ts            # TypeScript types
│   ├── midi/
│   │   ├── web-midi.ts         # Web MIDI API wrapper
│   │   └── synth-fallback.ts   # Web Audio oscillator synth
│   └── playback/
│       └── engine.ts           # Lookahead playback scheduler
├── public/demos/               # Bundled .SON demo files
├── st/                         # Original Atari ST files (git-ignored)
└── next.config.ts              # Static export + WASM config
```

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

Open [http://localhost:3000](http://localhost:3000) to see the app.

## 📄 .SON File Format

The `.SON` format is a binary file format used by Notator SL on the Atari ST. Key characteristics:

- **768 ticks per measure** (192 ticks per beat in 4/4 time)
- **6-byte events**: `[note, status, posHi, posLo, velocity, arg3]`
- **Track boundaries**: separated by `7F FF FF FF` or `00 0F FF FF` markers
- **Track data offset**: starts at `0x5AC8` in the file
- **Status bytes**: `144` = note, `145` = extended position, `224` = pitch wheel

Based on the reverse-engineering work by [Simon Cozens (son2midi)](https://github.com/simoncozens/son2midi).

## 🎹 Usage

1. Open the player at `/player`
2. Drag & drop a `.SON` file or click one of the demo files
3. Press **Play** — audio will play through:
   - Connected MIDI devices (via Web MIDI API)
   - Built-in oscillator synth (fallback)
4. Use **Mute (M)** and **Solo (S)** buttons on individual tracks

## 📝 License

MIT

## 🙏 Credits

- **Notator SL** — C-Lab / eMagic (Gerhard Lengeling)
- **son2midi** — [Simon Cozens](https://github.com/simoncozens/son2midi) for reverse-engineering the .SON format
- **Atari ST** community for preserving these files
