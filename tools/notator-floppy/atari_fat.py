"""
Atari ST FAT12 filesystem parser.

Parses boot sector, FAT tables, and directory entries from raw disk images.
Supports the Atari ST variant of FAT12, which differs slightly from PC FAT12.

Reference:
- Atari ST boot sector is similar to PC but with Atari-specific fields
- FAT12 uses 12-bit entries packed into byte pairs
- Directory entries are standard 32-byte FAT entries
"""

import struct
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class BootSector:
    """Parsed Atari ST boot sector."""
    # Standard BPB fields
    oem_name: str = ""
    bytes_per_sector: int = 512
    sectors_per_cluster: int = 2
    reserved_sectors: int = 1
    num_fats: int = 2
    root_dir_entries: int = 112
    total_sectors: int = 720
    media_descriptor: int = 0xF9
    sectors_per_fat: int = 3
    sectors_per_track: int = 9
    num_heads: int = 1
    # Atari ST specific
    serial_number: int = 0
    # Computed
    root_dir_start_sector: int = 0
    root_dir_sectors: int = 0
    data_start_sector: int = 0
    total_clusters: int = 0

    def __str__(self):
        return (
            f"=== Boot Sector ===\n"
            f"  OEM Name:            {self.oem_name!r}\n"
            f"  Bytes/Sector:        {self.bytes_per_sector}\n"
            f"  Sectors/Cluster:     {self.sectors_per_cluster}\n"
            f"  Reserved Sectors:    {self.reserved_sectors}\n"
            f"  Number of FATs:      {self.num_fats}\n"
            f"  Root Dir Entries:    {self.root_dir_entries}\n"
            f"  Total Sectors:       {self.total_sectors}\n"
            f"  Media Descriptor:    0x{self.media_descriptor:02X}\n"
            f"  Sectors/FAT:         {self.sectors_per_fat}\n"
            f"  Sectors/Track:       {self.sectors_per_track}\n"
            f"  Heads:               {self.num_heads}\n"
            f"  Serial:              0x{self.serial_number:08X}\n"
            f"  Root Dir Start:      sector {self.root_dir_start_sector}\n"
            f"  Root Dir Sectors:    {self.root_dir_sectors}\n"
            f"  Data Start:          sector {self.data_start_sector}\n"
            f"  Total Clusters:      {self.total_clusters}\n"
            f"  Disk Size:           {self.total_sectors * self.bytes_per_sector:,} bytes\n"
        )


@dataclass
class DirEntry:
    """A parsed directory entry."""
    name: str           # 8.3 format filename
    extension: str      # File extension
    full_name: str      # Combined name.ext
    attributes: int     # Attribute byte
    start_cluster: int  # First cluster
    file_size: int      # Size in bytes
    # Derived
    is_directory: bool = False
    is_volume_label: bool = False
    is_hidden: bool = False
    is_system: bool = False
    is_read_only: bool = False
    # Path context
    path: str = "/"


@dataclass
class AtariFile:
    """An extracted file from the disk."""
    name: str           # Filename (8.3)
    path: str           # Full path including directories
    data: bytes         # File content
    size: int           # Size in bytes
    attributes: int     # FAT attributes


class AtariFATParser:
    """Parser for Atari ST FAT12 filesystems."""

    def __init__(self, disk_data: bytes):
        self.data = disk_data
        self.boot = self._parse_boot_sector()
        self.fat = self._read_fat()

    def _parse_boot_sector(self) -> BootSector:
        """Parse the boot sector (first 512 bytes)."""
        if len(self.data) < 512:
            raise ValueError(f"Disk image too small: {len(self.data)} bytes")

        bs = self.data[:512]
        boot = BootSector()

        # Bytes 0-2:  Branch instruction (skip)
        # Bytes 3-10: OEM name
        boot.oem_name = bs[3:11].decode("ascii", errors="replace").strip()

        # BPB (BIOS Parameter Block) starts at offset 11
        (
            boot.bytes_per_sector,    # 11-12
            boot.sectors_per_cluster, # 13
            boot.reserved_sectors,    # 14-15
            boot.num_fats,            # 16
            boot.root_dir_entries,    # 17-18
            boot.total_sectors,       # 19-20
            boot.media_descriptor,    # 21
            boot.sectors_per_fat,     # 22-23
            boot.sectors_per_track,   # 24-25
            boot.num_heads,           # 26-27
        ) = struct.unpack_from("<HBHBHHBHHH", bs, 11)

        # Atari ST serial number at offset 8 (sometimes overlaps OEM)
        boot.serial_number = struct.unpack_from(">I", bs, 8)[0]

        # Sanity checks and defaults
        if boot.bytes_per_sector == 0:
            boot.bytes_per_sector = 512
        if boot.sectors_per_cluster == 0:
            boot.sectors_per_cluster = 2
        if boot.reserved_sectors == 0:
            boot.reserved_sectors = 1
        if boot.num_fats == 0:
            boot.num_fats = 2
        if boot.root_dir_entries == 0:
            boot.root_dir_entries = 112
        if boot.total_sectors == 0:
            boot.total_sectors = len(self.data) // boot.bytes_per_sector
        if boot.sectors_per_fat == 0:
            boot.sectors_per_fat = 3

        # Computed values
        boot.root_dir_start_sector = (
            boot.reserved_sectors + boot.num_fats * boot.sectors_per_fat
        )
        boot.root_dir_sectors = (
            (boot.root_dir_entries * 32 + boot.bytes_per_sector - 1)
            // boot.bytes_per_sector
        )
        boot.data_start_sector = boot.root_dir_start_sector + boot.root_dir_sectors
        boot.total_clusters = (
            (boot.total_sectors - boot.data_start_sector) // boot.sectors_per_cluster
        )

        return boot

    def _read_fat(self) -> list:
        """Read and decode the FAT12 table.

        FAT12 packs two 12-bit entries into every 3 bytes:
          byte0 | byte1 | byte2
          Entry0 = byte0 | (byte1 & 0x0F) << 8
          Entry1 = (byte1 >> 4) | byte2 << 4
        """
        fat_start = self.boot.reserved_sectors * self.boot.bytes_per_sector
        fat_size = self.boot.sectors_per_fat * self.boot.bytes_per_sector
        fat_data = self.data[fat_start:fat_start + fat_size]

        entries = []
        num_entries = (self.boot.total_clusters + 2)  # +2 for reserved entries 0,1

        for i in range(num_entries):
            # Each pair of entries occupies 3 bytes
            byte_offset = (i * 3) // 2

            if byte_offset + 1 >= len(fat_data):
                entries.append(0)
                continue

            if i % 2 == 0:
                # Even entry
                val = fat_data[byte_offset] | ((fat_data[byte_offset + 1] & 0x0F) << 8)
            else:
                # Odd entry
                if byte_offset + 2 > len(fat_data):
                    val = fat_data[byte_offset] >> 4
                else:
                    val = (fat_data[byte_offset] >> 4) | (fat_data[byte_offset + 1] << 4)

            entries.append(val & 0xFFF)

        return entries

    def _get_cluster_chain(self, start_cluster: int) -> List[int]:
        """Follow the FAT chain from a starting cluster."""
        chain = []
        cluster = start_cluster

        # Safety limit to prevent infinite loops
        max_clusters = self.boot.total_clusters + 10
        visited = set()

        while cluster >= 2 and cluster < 0xFF8 and len(chain) < max_clusters:
            if cluster in visited:
                print(f"  WARNING: FAT chain loop detected at cluster {cluster}")
                break
            visited.add(cluster)
            chain.append(cluster)

            if cluster >= len(self.fat):
                break
            cluster = self.fat[cluster]

        return chain

    def _read_cluster(self, cluster: int) -> bytes:
        """Read the data for a single cluster."""
        sector = (
            self.boot.data_start_sector
            + (cluster - 2) * self.boot.sectors_per_cluster
        )
        offset = sector * self.boot.bytes_per_sector
        size = self.boot.sectors_per_cluster * self.boot.bytes_per_sector
        return self.data[offset:offset + size]

    def _read_cluster_chain(self, start_cluster: int, file_size: int = 0) -> bytes:
        """Read all data from a cluster chain."""
        chain = self._get_cluster_chain(start_cluster)
        data = b""
        for cluster in chain:
            data += self._read_cluster(cluster)

        # Trim to actual file size if known
        if file_size > 0:
            data = data[:file_size]

        return data

    def _parse_directory(self, dir_data: bytes, parent_path: str = "/") -> List[DirEntry]:
        """Parse directory entries from raw directory data."""
        entries = []

        for i in range(0, len(dir_data), 32):
            entry_data = dir_data[i:i + 32]
            if len(entry_data) < 32:
                break

            first_byte = entry_data[0]

            # 0x00 = end of directory
            if first_byte == 0x00:
                break

            # 0xE5 = deleted entry
            if first_byte == 0xE5:
                continue

            # 0x2E = '.' or '..' entry — skip
            if first_byte == 0x2E:
                continue

            # Parse the entry
            name_raw = entry_data[0:8].decode("ascii", errors="replace").strip()
            ext_raw = entry_data[8:11].decode("ascii", errors="replace").strip()
            attributes = entry_data[11]
            start_cluster = struct.unpack_from("<H", entry_data, 26)[0]
            file_size = struct.unpack_from("<I", entry_data, 28)[0]

            # Build full name
            if ext_raw:
                full_name = f"{name_raw}.{ext_raw}"
            else:
                full_name = name_raw

            entry = DirEntry(
                name=name_raw,
                extension=ext_raw,
                full_name=full_name,
                attributes=attributes,
                start_cluster=start_cluster,
                file_size=file_size,
                is_directory=bool(attributes & 0x10),
                is_volume_label=bool(attributes & 0x08),
                is_hidden=bool(attributes & 0x02),
                is_system=bool(attributes & 0x04),
                is_read_only=bool(attributes & 0x01),
                path=parent_path,
            )

            # Skip volume labels
            if entry.is_volume_label:
                continue

            entries.append(entry)

        return entries

    def list_root_directory(self) -> List[DirEntry]:
        """List entries in the root directory."""
        root_offset = self.boot.root_dir_start_sector * self.boot.bytes_per_sector
        root_size = self.boot.root_dir_entries * 32
        root_data = self.data[root_offset:root_offset + root_size]
        return self._parse_directory(root_data, "/")

    def list_all_files(self, path: str = "/", entries: Optional[List[DirEntry]] = None) -> List[DirEntry]:
        """Recursively list all files and directories."""
        if entries is None:
            entries = self.list_root_directory()

        all_files = []

        for entry in entries:
            full_path = (path.rstrip("/") + "/" + entry.full_name)
            entry.path = full_path

            if entry.is_directory and entry.start_cluster >= 2:
                all_files.append(entry)
                # Read subdirectory
                subdir_data = self._read_cluster_chain(entry.start_cluster)
                subdir_entries = self._parse_directory(subdir_data, full_path)
                all_files.extend(self.list_all_files(full_path, subdir_entries))
            else:
                all_files.append(entry)

        return all_files

    def extract_file(self, entry: DirEntry) -> bytes:
        """Extract file data from disk image."""
        if entry.is_directory:
            return b""
        if entry.start_cluster < 2:
            return b""
        return self._read_cluster_chain(entry.start_cluster, entry.file_size)

    def extract_all_files(self) -> List[AtariFile]:
        """Extract all files from the disk image."""
        all_entries = self.list_all_files()
        files = []

        for entry in all_entries:
            if entry.is_directory:
                continue

            try:
                data = self.extract_file(entry)
                files.append(AtariFile(
                    name=entry.full_name,
                    path=entry.path,
                    data=data,
                    size=entry.file_size,
                    attributes=entry.attributes,
                ))
            except Exception as e:
                print(f"  WARNING: Failed to extract {entry.path}: {e}")

        return files

    def print_directory_listing(self):
        """Print a formatted directory listing."""
        entries = self.list_all_files()

        print(f"\n{'Type':<5} {'Size':>8}  {'Cluster':>7}  Path")
        print("-" * 60)

        total_size = 0
        file_count = 0
        dir_count = 0

        for entry in entries:
            if entry.is_directory:
                type_str = "<DIR>"
                size_str = ""
                dir_count += 1
            else:
                type_str = ""
                size_str = f"{entry.file_size:,}"
                total_size += entry.file_size
                file_count += 1

            cluster_str = f"#{entry.start_cluster}" if entry.start_cluster >= 2 else ""
            flags = ""
            if entry.is_hidden:
                flags += "H"
            if entry.is_system:
                flags += "S"
            if entry.is_read_only:
                flags += "R"

            print(f"{type_str:<5} {size_str:>8}  {cluster_str:>7}  {entry.path} {flags}")

        print("-" * 60)
        print(f"  {file_count} file(s), {dir_count} dir(s), {total_size:,} bytes total")
