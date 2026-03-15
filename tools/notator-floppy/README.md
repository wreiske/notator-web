# Notator Floppy Companion Tool

Cross-platform CLI for reading Atari ST floppy disks, extracting files, and creating disk images.

## Requirements

- Python 3.8+
- No external dependencies for disk reading (Phase 1)
- `sudo` access on macOS/Linux for raw disk reading

## Quick Start

```bash
cd tools/notator-floppy

# Detect connected floppy drives
python3 notator_floppy.py detect

# List files on the floppy
sudo python3 notator_floppy.py list

# Extract all files to a directory
sudo python3 notator_floppy.py extract --output-dir ./my_files

# Create a raw disk image (.ST format)
sudo python3 notator_floppy.py image my_backup.st

# Inspect an existing disk image
python3 notator_floppy.py info my_backup.st
```

## Commands

| Command | Description |
|---------|-------------|
| `detect` | Scan for connected USB floppy drives |
| `list` | List all files on the floppy (shows boot sector info + directory listing) |
| `extract` | Extract all files to a local directory |
| `image` | Create a raw .ST disk image backup |
| `info` | Show info about an existing disk image file |

## Options

- `--device`, `-d` — Specify device path manually (e.g. `/dev/disk4`). Auto-detected if omitted.
- `--output-dir`, `-o` — Output directory for `extract` (default: `./atari_files`)

## Platform Support

| Platform | Disk Detection | Raw Reading |
|----------|---------------|-------------|
| **macOS** | `diskutil` | `dd` via subprocess |
| **Linux** | `/sys/block` scan | `dd` via subprocess |
| **Windows** | `wmic` | Raw device handle |

## Atari ST Disk Formats

The tool supports standard Atari ST floppy formats:

| Format | Size | Sectors | Tracks | Sides |
|--------|------|---------|--------|-------|
| SS/DD | 360 KB | 720 | 80 | 1 |
| DS/DD | 720 KB | 1440 | 80 | 2 |
| HD | 1.44 MB | 2880 | 80 | 2 |

## Roadmap

- [x] Floppy drive detection
- [x] Raw disk image creation
- [x] Atari ST FAT12 filesystem parsing
- [x] File extraction
- [ ] OTP-based authentication with notator.online
- [ ] Upload extracted .SON files to cloud storage
