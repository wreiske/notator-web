"""
Cross-platform raw floppy disk reader.

macOS/Linux: uses dd via subprocess
Windows: opens raw device handle
"""

import os
import sys
import platform
import subprocess
import json


def detect_floppies():
    """Detect connected floppy drives. Returns list of dicts with device info."""
    system = platform.system()

    if system == "Darwin":
        return _detect_macos()
    elif system == "Linux":
        return _detect_linux()
    elif system == "Windows":
        return _detect_windows()
    else:
        print(f"Unsupported platform: {system}")
        return []


def _detect_macos():
    """Detect floppy drives on macOS using diskutil."""
    drives = []
    try:
        result = subprocess.run(
            ["diskutil", "list", "-plist", "external"],
            capture_output=True, text=False
        )
        # Parse plist is complex, use simpler approach
        result = subprocess.run(
            ["diskutil", "list"],
            capture_output=True, text=True
        )

        # Find external physical disks
        current_disk = None
        for line in result.stdout.split("\n"):
            if line.startswith("/dev/disk") and "external" in line:
                current_disk = line.split()[0]
            elif current_disk and "0:" in line:
                # Get disk info
                info = _get_disk_info_macos(current_disk)
                if info:
                    drives.append(info)
                current_disk = None

        # If no drives found via parsing, try scanning disk2-disk9
        if not drives:
            for i in range(2, 10):
                dev = f"/dev/disk{i}"
                if os.path.exists(dev):
                    info = _get_disk_info_macos(dev)
                    if info and info.get("removable"):
                        drives.append(info)

    except FileNotFoundError:
        print("diskutil not found")
    except Exception as e:
        print(f"Error detecting drives: {e}")

    return drives


def _get_disk_info_macos(device):
    """Get detailed info for a macOS disk device."""
    try:
        result = subprocess.run(
            ["diskutil", "info", device],
            capture_output=True, text=True
        )
        info = {"device": device}
        for line in result.stdout.split("\n"):
            line = line.strip()
            if ":" in line:
                key, _, value = line.partition(":")
                key = key.strip()
                value = value.strip()

                if key == "Disk Size":
                    # Parse "737.3 KB (737280 Bytes)"
                    if "Bytes" in value:
                        bytes_str = value.split("(")[1].split()[0]
                        info["size_bytes"] = int(bytes_str)
                        info["size_display"] = value.split("(")[0].strip()
                elif key == "Device / Media Name":
                    info["name"] = value
                elif key == "Protocol":
                    info["protocol"] = value
                elif key == "Removable Media":
                    info["removable"] = value == "Removable"
                elif key == "Device Block Size":
                    info["block_size"] = int(value.split()[0])
                elif key == "Device Location":
                    info["location"] = value
                elif key == "Media Read-Only":
                    info["read_only"] = value == "Yes"

        # Filter: only floppy-sized removable media
        size = info.get("size_bytes", 0)
        is_floppy_size = size in [
            327680,   # 320 KB  (Atari ST single-sided)
            368640,   # 360 KB  (PC DD)
            655360,   # 640 KB  (Atari ST single-sided 80 track)
            737280,   # 720 KB  (Atari ST double-sided or PC DD)
            819200,   # 800 KB  (Mac 800K)
            1474560,  # 1.44 MB (HD)
        ] or (0 < size <= 2_000_000)  # Anything up to ~2MB is probably a floppy

        if info.get("removable") and is_floppy_size:
            info["is_floppy"] = True
        elif info.get("removable"):
            info["is_floppy"] = False

        return info

    except Exception as e:
        print(f"Error getting info for {device}: {e}")
        return None


def _detect_linux():
    """Detect floppy drives on Linux."""
    drives = []
    # Check /dev/fd0, /dev/fd1 and /dev/sdX for removable
    for fd in ["/dev/fd0", "/dev/fd1"]:
        if os.path.exists(fd):
            drives.append({
                "device": fd,
                "name": f"Floppy {fd}",
                "is_floppy": True,
                "removable": True,
            })

    # Also check /sys/block for removable USB devices
    try:
        for block in os.listdir("/sys/block"):
            if block.startswith("sd"):
                removable_path = f"/sys/block/{block}/removable"
                size_path = f"/sys/block/{block}/size"
                if os.path.exists(removable_path):
                    with open(removable_path) as f:
                        if f.read().strip() == "1":
                            size_sectors = 0
                            if os.path.exists(size_path):
                                with open(size_path) as sf:
                                    size_sectors = int(sf.read().strip())
                            size_bytes = size_sectors * 512
                            if 0 < size_bytes <= 2_000_000:
                                drives.append({
                                    "device": f"/dev/{block}",
                                    "name": f"Removable disk {block}",
                                    "size_bytes": size_bytes,
                                    "removable": True,
                                    "is_floppy": True,
                                })
    except Exception as e:
        print(f"Error scanning /sys/block: {e}")

    return drives


def _detect_windows():
    """Detect floppy drives on Windows."""
    drives = []
    try:
        result = subprocess.run(
            ["wmic", "logicaldisk", "where", "DriveType=2", "get",
             "DeviceID,Size,VolumeName", "/format:csv"],
            capture_output=True, text=True
        )
        for line in result.stdout.strip().split("\n"):
            parts = line.split(",")
            if len(parts) >= 3 and parts[1].endswith(":"):
                drive_letter = parts[1]
                size = int(parts[2]) if parts[2].strip() else 0
                drives.append({
                    "device": f"\\\\.\\{drive_letter}",
                    "name": f"Drive {drive_letter}",
                    "size_bytes": size,
                    "removable": True,
                    "is_floppy": 0 < size <= 2_000_000,
                })
    except Exception as e:
        print(f"Error detecting Windows drives: {e}")

    return drives


def read_disk_image(device, size_bytes=None):
    """Read entire disk as raw bytes.

    Args:
        device: Device path (e.g. /dev/disk4, \\\\.\\A:)
        size_bytes: Expected size in bytes (auto-detected if None)

    Returns:
        bytes: Raw disk image data
    """
    system = platform.system()

    if system in ("Darwin", "Linux"):
        return _read_unix(device, size_bytes)
    elif system == "Windows":
        return _read_windows(device, size_bytes)
    else:
        raise RuntimeError(f"Unsupported platform: {system}")


def _read_unix(device, size_bytes=None):
    """Read raw disk on macOS/Linux using dd."""
    # Determine block size and count
    block_size = 512

    if size_bytes:
        count = size_bytes // block_size
    else:
        # Auto-detect from diskutil (macOS) or /sys (Linux)
        if platform.system() == "Darwin":
            info = _get_disk_info_macos(device)
            if info and "size_bytes" in info:
                size_bytes = info["size_bytes"]
                count = size_bytes // block_size
            else:
                raise RuntimeError(f"Cannot determine size of {device}")
        else:
            # Linux: read /sys/block/sdX/size
            block_name = device.split("/")[-1]
            size_path = f"/sys/block/{block_name}/size"
            if os.path.exists(size_path):
                with open(size_path) as f:
                    count = int(f.read().strip())
                size_bytes = count * block_size
            else:
                raise RuntimeError(f"Cannot determine size of {device}")

    print(f"Reading {size_bytes:,} bytes ({count} sectors) from {device}...")

    result = subprocess.run(
        ["dd", f"if={device}", f"bs={block_size}", f"count={count}"],
        capture_output=True
    )

    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        if "Permission denied" in stderr or "Operation not permitted" in stderr:
            raise PermissionError(
                f"Permission denied reading {device}.\n"
                f"Try running with sudo: sudo python3 notator_floppy.py ..."
            )
        raise RuntimeError(f"dd failed: {stderr}")

    data = result.stdout
    print(f"Read {len(data):,} bytes successfully.")

    if len(data) != size_bytes:
        print(f"WARNING: Expected {size_bytes} bytes but got {len(data)}")

    return data


def _read_windows(device, size_bytes=None):
    """Read raw disk on Windows using direct file handle."""
    try:
        with open(device, "rb") as f:
            data = f.read()
            print(f"Read {len(data):,} bytes from {device}")
            return data
    except PermissionError:
        raise PermissionError(
            f"Permission denied reading {device}.\n"
            f"Try running as Administrator."
        )


def save_disk_image(data, output_path):
    """Save raw disk image to a file."""
    with open(output_path, "wb") as f:
        f.write(data)
    print(f"Saved disk image: {output_path} ({len(data):,} bytes)")


def load_disk_image(image_path):
    """Load a previously saved disk image file."""
    with open(image_path, "rb") as f:
        data = f.read()
    print(f"Loaded disk image: {image_path} ({len(data):,} bytes)")
    return data
