#!/usr/bin/env python3
"""
Notator Floppy Companion Tool

Read Atari ST floppy disks, extract files, create disk images,
and upload to notator.online.

Usage:
  python3 notator_floppy.py detect                    - Find connected floppy drives
  python3 notator_floppy.py list [--device DEV]       - List files on floppy
  python3 notator_floppy.py image OUTPUT.st [--device DEV]  - Create raw disk image
  python3 notator_floppy.py extract [--output-dir DIR] [--device DEV]  - Extract files
  python3 notator_floppy.py info IMAGE.st             - Show disk image info

For reading from a physical floppy on macOS/Linux, you may need sudo.
"""

import argparse
import os
import sys

from disk_reader import detect_floppies, read_disk_image, save_disk_image, load_disk_image
from atari_fat import AtariFATParser


def cmd_detect(args):
    """Detect connected floppy drives."""
    print("Scanning for floppy drives...\n")
    drives = detect_floppies()

    if not drives:
        print("No floppy drives detected.")
        print("\nTips:")
        print("  - Make sure the USB floppy drive is connected")
        print("  - Insert a floppy disk into the drive")
        print("  - On macOS, check System Information > USB")
        return 1

    print(f"Found {len(drives)} drive(s):\n")
    for i, drive in enumerate(drives):
        floppy_str = " [FLOPPY]" if drive.get("is_floppy") else ""
        print(f"  [{i + 1}] {drive['device']}{floppy_str}")
        if "name" in drive:
            print(f"      Name:     {drive['name']}")
        if "size_bytes" in drive:
            size_kb = drive['size_bytes'] / 1024
            print(f"      Size:     {drive['size_bytes']:,} bytes ({size_kb:.1f} KB)")
        if "protocol" in drive:
            print(f"      Protocol: {drive['protocol']}")
        if "location" in drive:
            print(f"      Location: {drive['location']}")
        print()

    return 0


def _get_disk_data(args):
    """Get disk data from either a device or an image file."""
    if hasattr(args, "image") and args.image:
        return load_disk_image(args.image)

    # Auto-detect or use specified device
    device = getattr(args, "device", None)
    if not device:
        drives = detect_floppies()
        floppy_drives = [d for d in drives if d.get("is_floppy")]

        if not floppy_drives:
            print("No floppy drive detected. Use --device to specify manually.")
            print("Or provide a disk image file with the 'info' command.")
            sys.exit(1)

        if len(floppy_drives) > 1:
            print("Multiple floppy drives found:")
            for i, d in enumerate(floppy_drives):
                print(f"  [{i + 1}] {d['device']} - {d.get('name', 'Unknown')}")
            print("\nUse --device to specify which one to use.")
            sys.exit(1)

        device = floppy_drives[0]["device"]
        print(f"Auto-detected floppy: {device}")

    return read_disk_image(device)


def cmd_list(args):
    """List files on a floppy disk."""
    data = _get_disk_data(args)
    parser = AtariFATParser(data)

    print(parser.boot)
    parser.print_directory_listing()
    return 0


def cmd_image(args):
    """Create a raw disk image from a floppy."""
    data = _get_disk_data(args)
    output = args.output

    # Add .st extension if not present
    if not output.lower().endswith((".st", ".img", ".raw")):
        output += ".st"

    save_disk_image(data, output)

    # Also show what's on the disk
    try:
        parser = AtariFATParser(data)
        print(f"\nDisk contains:")
        entries = parser.list_all_files()
        file_count = sum(1 for e in entries if not e.is_directory)
        print(f"  {file_count} file(s)")
        for entry in entries:
            if not entry.is_directory:
                print(f"    {entry.path} ({entry.file_size:,} bytes)")
    except Exception as e:
        print(f"\nNote: Could not parse filesystem ({e})")

    return 0


def cmd_extract(args):
    """Extract all files from a floppy disk."""
    data = _get_disk_data(args)
    parser = AtariFATParser(data)

    output_dir = args.output_dir or "./atari_files"
    os.makedirs(output_dir, exist_ok=True)

    print(parser.boot)
    print(f"\nExtracting files to: {output_dir}/\n")

    files = parser.extract_all_files()

    if not files:
        print("No files found on disk.")
        return 1

    extracted = 0
    for f in files:
        # Create subdirectories if needed
        rel_path = f.path.lstrip("/")
        full_path = os.path.join(output_dir, rel_path)
        parent_dir = os.path.dirname(full_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)

        with open(full_path, "wb") as fp:
            fp.write(f.data)

        extracted += 1
        print(f"  ✓ {rel_path} ({f.size:,} bytes)")

    print(f"\nExtracted {extracted} file(s) to {output_dir}/")

    # Check for .SON files specifically
    son_files = [f for f in files if f.name.upper().endswith(".SON")]
    if son_files:
        print(f"\n🎵 Found {len(son_files)} Notator .SON file(s):")
        for f in son_files:
            print(f"    {f.path} ({f.size:,} bytes)")
        print(f"\n  These can be loaded in Notator Web at https://notator.online")

    return 0


def cmd_info(args):
    """Show info about a disk image file."""
    data = load_disk_image(args.image)
    parser = AtariFATParser(data)

    print(parser.boot)
    parser.print_directory_listing()
    return 0


def main():
    ap = argparse.ArgumentParser(
        prog="notator-floppy",
        description="Notator Floppy Companion — Read Atari ST floppy disks",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  %(prog)s detect\n"
            "  %(prog)s list\n"
            "  %(prog)s image backup.st\n"
            "  %(prog)s extract --output-dir ./my_files\n"
            "  %(prog)s info backup.st\n"
            "\n"
            "For physical floppy access on macOS/Linux, you may need sudo."
        ),
    )

    sub = ap.add_subparsers(dest="command", help="Command to run")

    # detect
    sub.add_parser("detect", help="Find connected floppy drives")

    # list
    p_list = sub.add_parser("list", help="List files on a floppy disk")
    p_list.add_argument("--device", "-d", help="Device path (auto-detected if omitted)")

    # image
    p_image = sub.add_parser("image", help="Create a raw disk image")
    p_image.add_argument("output", help="Output file path (e.g. backup.st)")
    p_image.add_argument("--device", "-d", help="Device path")

    # extract
    p_extract = sub.add_parser("extract", help="Extract all files from floppy")
    p_extract.add_argument("--output-dir", "-o", default="./atari_files",
                           help="Output directory (default: ./atari_files)")
    p_extract.add_argument("--device", "-d", help="Device path")

    # info
    p_info = sub.add_parser("info", help="Show info about a disk image file")
    p_info.add_argument("image", help="Disk image file (.st, .img)")

    args = ap.parse_args()

    if not args.command:
        ap.print_help()
        return 1

    commands = {
        "detect": cmd_detect,
        "list": cmd_list,
        "image": cmd_image,
        "extract": cmd_extract,
        "info": cmd_info,
    }

    return commands[args.command](args)


if __name__ == "__main__":
    sys.exit(main() or 0)
