#!/usr/bin/env python3
"""
Notator Floppy Reader — GUI

Bulk-transfer Atari ST floppy disks with a visual workflow:
  detect → read → extract → chime → eject → repeat

Usage:
  sudo python3 notator_floppy_gui.py
  sudo python3 notator_floppy_gui.py --output-dir ~/floppy_archive
"""

import argparse
import os
import platform
import queue
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import filedialog, ttk
from datetime import datetime

from disk_reader import detect_floppies, read_disk_image, save_disk_image
from atari_fat import AtariFATParser


# ════════════════════════════════════════════════════════════════════════
# PLATFORM HELPERS
# ════════════════════════════════════════════════════════════════════════

def play_completion_sound():
    """Play a system chime on completion."""
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.Popen(
                ["afplay", "/System/Library/Sounds/Glass.aiff"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        elif system == "Linux":
            # Try paplay (PulseAudio), then aplay (ALSA)
            for cmd in [
                ["paplay", "/usr/share/sounds/freedesktop/stereo/complete.oga"],
                ["aplay", "/usr/share/sounds/sound-icons/xylofon.wav"],
            ]:
                try:
                    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    break
                except FileNotFoundError:
                    continue
        elif system == "Windows":
            import winsound
            winsound.MessageBeep(winsound.MB_OK)
    except Exception:
        pass  # Sound is non-critical


def eject_disk(device):
    """Safely eject a disk."""
    system = platform.system()
    try:
        if system == "Darwin":
            result = subprocess.run(
                ["diskutil", "eject", device],
                capture_output=True, text=True,
            )
            return result.returncode == 0, result.stdout.strip()
        elif system == "Linux":
            result = subprocess.run(
                ["eject", device],
                capture_output=True, text=True,
            )
            return result.returncode == 0, result.stdout.strip()
        elif system == "Windows":
            # Windows doesn't have a simple eject command for raw devices
            return False, "Manual eject required on Windows"
    except Exception as e:
        return False, str(e)
    return False, "Unsupported platform"


# ════════════════════════════════════════════════════════════════════════
# COLORS / THEME
# ════════════════════════════════════════════════════════════════════════

COLORS = {
    "bg": "#0c0c2d",
    "bg_light": "#12124a",
    "bg_card": "#161650",
    "accent": "#4488ff",
    "accent_dim": "#2a4488",
    "green": "#44cc88",
    "yellow": "#ffbb44",
    "red": "#ff5566",
    "text": "#d0d8f0",
    "text_dim": "#6678aa",
    "text_bright": "#ffffff",
    "border": "#2a3f99",
    "progress_bg": "#1a1a5a",
    "progress_fill": "#44cc88",
}

FONT_FAMILY = "Menlo" if platform.system() == "Darwin" else "Consolas"


# ════════════════════════════════════════════════════════════════════════
# MESSAGE TYPES (thread → UI communication)
# ════════════════════════════════════════════════════════════════════════

class Msg:
    """Messages sent from worker thread to UI."""
    pass

class MsgStatus(Msg):
    def __init__(self, text, color=None):
        self.text = text
        self.color = color

class MsgProgress(Msg):
    def __init__(self, value, maximum=100):
        self.value = value
        self.maximum = maximum

class MsgFileFound(Msg):
    def __init__(self, name, size, status="extracting"):
        self.name = name
        self.size = size
        self.status = status

class MsgFileComplete(Msg):
    def __init__(self, name):
        self.name = name

class MsgDiskComplete(Msg):
    def __init__(self, disk_number, image_path, files, total_size):
        self.disk_number = disk_number
        self.image_path = image_path
        self.files = files
        self.total_size = total_size

class MsgBootSector(Msg):
    def __init__(self, info_text):
        self.info_text = info_text

class MsgError(Msg):
    def __init__(self, text):
        self.text = text

class MsgEjected(Msg):
    def __init__(self, success, message=""):
        self.success = success
        self.message = message


# ════════════════════════════════════════════════════════════════════════
# MAIN GUI
# ════════════════════════════════════════════════════════════════════════

class FloppyReaderApp:
    def __init__(self, output_dir="./floppy_archive"):
        self.output_dir = os.path.abspath(output_dir)
        os.makedirs(self.output_dir, exist_ok=True)

        self.msg_queue = queue.Queue()
        self.disk_count = self._count_existing_images()
        self.bulk_mode = False
        self.is_reading = False
        self.current_device = None

        # ── Build the window ──────────────────────────────────────────
        self.root = tk.Tk()
        self.root.title("Notator Floppy Reader")
        self.root.configure(bg=COLORS["bg"])
        self.root.minsize(600, 700)
        self.root.geometry("640x780")

        # Try to set a dark title bar on macOS
        try:
            self.root.tk.call("::tk::unsupported::MacWindowStyle", "style",
                              self.root._w, "moveableModal", "")
        except Exception:
            pass

        self._build_ui()
        self._poll_messages()

    def _count_existing_images(self):
        """Count existing disk_NNN.st files to resume numbering."""
        count = 0
        if os.path.isdir(self.output_dir):
            for f in os.listdir(self.output_dir):
                if f.startswith("disk_") and f.endswith(".st"):
                    try:
                        n = int(f[5:8])
                        count = max(count, n)
                    except ValueError:
                        pass
        return count

    # ── UI Construction ────────────────────────────────────────────────

    def _build_ui(self):
        root = self.root

        # ── Header ────────────────────────────────────────────────────
        header = tk.Frame(root, bg=COLORS["bg_light"], pady=12, padx=16)
        header.pack(fill="x")

        tk.Label(
            header, text="🖴  Notator Floppy Reader",
            font=(FONT_FAMILY, 16, "bold"),
            bg=COLORS["bg_light"], fg=COLORS["text_bright"],
        ).pack(side="left")

        self.disk_count_label = tk.Label(
            header, text=f"{self.disk_count} disk(s) archived",
            font=(FONT_FAMILY, 10),
            bg=COLORS["bg_light"], fg=COLORS["text_dim"],
        )
        self.disk_count_label.pack(side="right")

        # ── Status bar ────────────────────────────────────────────────
        status_frame = tk.Frame(root, bg=COLORS["bg"], padx=16, pady=8)
        status_frame.pack(fill="x")

        self.status_dot = tk.Label(
            status_frame, text="●", font=(FONT_FAMILY, 14),
            bg=COLORS["bg"], fg=COLORS["text_dim"],
        )
        self.status_dot.pack(side="left")

        self.status_label = tk.Label(
            status_frame, text="Ready",
            font=(FONT_FAMILY, 12),
            bg=COLORS["bg"], fg=COLORS["text"],
            anchor="w",
        )
        self.status_label.pack(side="left", padx=(6, 0), fill="x", expand=True)

        # ── Output directory ──────────────────────────────────────────
        dir_frame = tk.Frame(root, bg=COLORS["bg"], padx=16, pady=4)
        dir_frame.pack(fill="x")

        tk.Label(
            dir_frame, text="Output:",
            font=(FONT_FAMILY, 10),
            bg=COLORS["bg"], fg=COLORS["text_dim"],
        ).pack(side="left")

        self.dir_label = tk.Label(
            dir_frame, text=self.output_dir,
            font=(FONT_FAMILY, 10),
            bg=COLORS["bg"], fg=COLORS["accent"],
            anchor="w",
        )
        self.dir_label.pack(side="left", padx=(6, 0), fill="x", expand=True)

        browse_btn = tk.Button(
            dir_frame, text="Browse",
            font=(FONT_FAMILY, 9),
            bg=COLORS["bg_card"], fg=COLORS["text_dim"],
            activebackground=COLORS["bg_light"], activeforeground=COLORS["text"],
            highlightthickness=0, bd=1, relief="solid",
            command=self._browse_output,
        )
        browse_btn.pack(side="right")

        # ── Progress bar ──────────────────────────────────────────────
        prog_frame = tk.Frame(root, bg=COLORS["bg"], padx=16, pady=8)
        prog_frame.pack(fill="x")

        style = ttk.Style()
        style.theme_use("default")
        style.configure(
            "Floppy.Horizontal.TProgressbar",
            troughcolor=COLORS["progress_bg"],
            background=COLORS["progress_fill"],
            thickness=16,
            borderwidth=0,
        )
        self.progress = ttk.Progressbar(
            prog_frame, style="Floppy.Horizontal.TProgressbar",
            mode="determinate", maximum=100,
        )
        self.progress.pack(fill="x")

        # ── Current disk panel ────────────────────────────────────────
        panel_frame = tk.Frame(root, bg=COLORS["bg"], padx=16, pady=4)
        panel_frame.pack(fill="x")

        tk.Label(
            panel_frame, text="Current Disk",
            font=(FONT_FAMILY, 10, "bold"),
            bg=COLORS["bg"], fg=COLORS["text_dim"],
            anchor="w",
        ).pack(fill="x")

        # File list (scrollable text widget styled like a terminal)
        self.file_list = tk.Text(
            panel_frame, height=10,
            font=(FONT_FAMILY, 11),
            bg=COLORS["bg_card"], fg=COLORS["text"],
            insertbackground=COLORS["text"],
            selectbackground=COLORS["accent_dim"],
            highlightthickness=1, highlightbackground=COLORS["border"],
            bd=0, padx=10, pady=8,
            wrap="none", state="disabled",
        )
        self.file_list.pack(fill="both", expand=True, pady=(4, 0))

        # Configure text tags for colors
        self.file_list.tag_configure("success", foreground=COLORS["green"])
        self.file_list.tag_configure("info", foreground=COLORS["accent"])
        self.file_list.tag_configure("warn", foreground=COLORS["yellow"])
        self.file_list.tag_configure("error", foreground=COLORS["red"])
        self.file_list.tag_configure("dim", foreground=COLORS["text_dim"])
        self.file_list.tag_configure("bright", foreground=COLORS["text_bright"])
        self.file_list.tag_configure("son", foreground=COLORS["yellow"], font=(FONT_FAMILY, 11, "bold"))

        # ── History panel ─────────────────────────────────────────────
        hist_frame = tk.Frame(root, bg=COLORS["bg"], padx=16, pady=8)
        hist_frame.pack(fill="both", expand=True)

        tk.Label(
            hist_frame, text="History",
            font=(FONT_FAMILY, 10, "bold"),
            bg=COLORS["bg"], fg=COLORS["text_dim"],
            anchor="w",
        ).pack(fill="x")

        self.history_list = tk.Text(
            hist_frame, height=6,
            font=(FONT_FAMILY, 10),
            bg=COLORS["bg_card"], fg=COLORS["text_dim"],
            highlightthickness=1, highlightbackground=COLORS["border"],
            bd=0, padx=10, pady=8,
            wrap="none", state="disabled",
        )
        self.history_list.pack(fill="both", expand=True, pady=(4, 0))
        self.history_list.tag_configure("success", foreground=COLORS["green"])
        self.history_list.tag_configure("bright", foreground=COLORS["text_bright"])
        self.history_list.tag_configure("son", foreground=COLORS["yellow"])

        # ── Button bar ────────────────────────────────────────────────
        btn_frame = tk.Frame(root, bg=COLORS["bg_light"], padx=16, pady=12)
        btn_frame.pack(fill="x", side="bottom")

        self.bulk_btn = tk.Button(
            btn_frame, text="▶  Start Bulk Mode",
            font=(FONT_FAMILY, 11, "bold"),
            bg=COLORS["green"], fg="#000000",
            activebackground="#33bb77", activeforeground="#000000",
            highlightthickness=0, bd=0, relief="flat",
            padx=16, pady=6,
            command=self._toggle_bulk_mode,
        )
        self.bulk_btn.pack(side="left")

        self.read_once_btn = tk.Button(
            btn_frame, text="Read Once",
            font=(FONT_FAMILY, 11),
            bg=COLORS["bg_card"], fg=COLORS["text"],
            activebackground=COLORS["bg_light"], activeforeground=COLORS["text_bright"],
            highlightthickness=0, bd=1, relief="solid",
            padx=16, pady=6,
            command=self._read_once,
        )
        self.read_once_btn.pack(side="left", padx=(8, 0))

        quit_btn = tk.Button(
            btn_frame, text="Quit",
            font=(FONT_FAMILY, 11),
            bg=COLORS["bg_card"], fg=COLORS["text_dim"],
            activebackground=COLORS["red"], activeforeground="#fff",
            highlightthickness=0, bd=1, relief="solid",
            padx=16, pady=6,
            command=self._quit,
        )
        quit_btn.pack(side="right")

        self._set_status("Ready — plug in a floppy drive", COLORS["text_dim"])

    # ── UI Helpers ─────────────────────────────────────────────────────

    def _set_status(self, text, color=None):
        color = color or COLORS["text"]
        self.status_label.config(text=text, fg=color)
        self.status_dot.config(fg=color)

    def _log(self, text, tag=None):
        self.file_list.config(state="normal")
        if tag:
            self.file_list.insert("end", text + "\n", tag)
        else:
            self.file_list.insert("end", text + "\n")
        self.file_list.see("end")
        self.file_list.config(state="disabled")

    def _log_history(self, text, tag=None):
        self.history_list.config(state="normal")
        if tag:
            self.history_list.insert("1.0", text + "\n", tag)
        else:
            self.history_list.insert("1.0", text + "\n")
        self.history_list.config(state="disabled")

    def _clear_log(self):
        self.file_list.config(state="normal")
        self.file_list.delete("1.0", "end")
        self.file_list.config(state="disabled")

    def _browse_output(self):
        d = filedialog.askdirectory(initialdir=self.output_dir, title="Select output directory")
        if d:
            self.output_dir = d
            self.dir_label.config(text=d)
            os.makedirs(d, exist_ok=True)

    def _quit(self):
        self.bulk_mode = False
        self.root.quit()

    # ── Button handlers ────────────────────────────────────────────────

    def _toggle_bulk_mode(self):
        if self.bulk_mode:
            self.bulk_mode = False
            self.bulk_btn.config(text="▶  Start Bulk Mode", bg=COLORS["green"])
            self._set_status("Bulk mode stopped", COLORS["text_dim"])
        else:
            self.bulk_mode = True
            self.bulk_btn.config(text="■  Stop Bulk Mode", bg=COLORS["red"])
            self._set_status("Bulk mode — scanning for floppy...", COLORS["yellow"])
            self._start_polling()

    def _read_once(self):
        if self.is_reading:
            return
        self._start_read()

    # ── Polling for floppy insertion ───────────────────────────────────

    def _start_polling(self):
        if not self.bulk_mode or self.is_reading:
            return
        self._check_for_floppy()

    def _check_for_floppy(self):
        if not self.bulk_mode or self.is_reading:
            return

        drives = detect_floppies()
        floppy = next((d for d in drives if d.get("is_floppy")), None)

        if floppy:
            self.current_device = floppy["device"]
            self._start_read()
        else:
            self._set_status("Waiting for floppy... insert a disk", COLORS["yellow"])
            # Poll again in 2 seconds
            self.root.after(2000, self._check_for_floppy)

    # ── Disk reading (runs in a separate thread) ───────────────────────

    def _start_read(self):
        if self.is_reading:
            return

        # Auto-detect if no device set
        if not self.current_device:
            drives = detect_floppies()
            floppy = next((d for d in drives if d.get("is_floppy")), None)
            if not floppy:
                self._set_status("No floppy drive found!", COLORS["red"])
                return
            self.current_device = floppy["device"]

        self.is_reading = True
        self.read_once_btn.config(state="disabled")
        self._clear_log()
        self.progress["value"] = 0

        thread = threading.Thread(target=self._read_worker, daemon=True)
        thread.start()

    def _read_worker(self):
        """Worker thread: reads disk, extracts files, saves image."""
        q = self.msg_queue
        device = self.current_device
        disk_num = self.disk_count + 1

        try:
            q.put(MsgStatus(f"Reading {device}...", COLORS["accent"]))
            q.put(MsgProgress(10))

            # Read raw disk
            data = read_disk_image(device)
            q.put(MsgProgress(40))
            q.put(MsgStatus("Parsing filesystem...", COLORS["accent"]))

            # Parse Atari ST filesystem
            parser = AtariFATParser(data)
            q.put(MsgBootSector(str(parser.boot)))
            q.put(MsgProgress(50))

            # Save disk image
            image_name = f"disk_{disk_num:03d}.st"
            image_path = os.path.join(self.output_dir, image_name)
            save_disk_image(data, image_path)
            q.put(MsgFileFound(f"💾 {image_name}", len(data), "saved"))
            q.put(MsgFileComplete(f"💾 {image_name}"))
            q.put(MsgProgress(60))

            # Extract files
            q.put(MsgStatus("Extracting files...", COLORS["accent"]))
            files = parser.extract_all_files()

            disk_dir = os.path.join(self.output_dir, f"disk_{disk_num:03d}")
            os.makedirs(disk_dir, exist_ok=True)

            extracted_files = []
            total = len(files) if files else 1

            for i, f in enumerate(files):
                rel_path = f.path.lstrip("/")
                full_path = os.path.join(disk_dir, rel_path)
                parent = os.path.dirname(full_path)
                if parent:
                    os.makedirs(parent, exist_ok=True)

                with open(full_path, "wb") as fp:
                    fp.write(f.data)

                is_son = f.name.upper().endswith(".SON")
                q.put(MsgFileFound(f.name, f.size, "extracting"))
                q.put(MsgFileComplete(f.name))
                extracted_files.append(f)

                prog = 60 + int(35 * (i + 1) / total)
                q.put(MsgProgress(prog))

            q.put(MsgProgress(95))

            # Summary
            total_size = sum(f.size for f in extracted_files)
            q.put(MsgDiskComplete(disk_num, image_path, extracted_files, total_size))

            # Eject
            q.put(MsgStatus("Ejecting disk...", COLORS["yellow"]))
            success, msg = eject_disk(device)
            q.put(MsgEjected(success, msg))
            q.put(MsgProgress(100))

        except PermissionError as e:
            q.put(MsgError(f"Permission denied: {e}\n\nRun with: sudo python3 notator_floppy_gui.py"))
        except Exception as e:
            q.put(MsgError(f"Error: {e}"))

    # ── Message polling (UI thread) ────────────────────────────────────

    def _poll_messages(self):
        try:
            while True:
                msg = self.msg_queue.get_nowait()
                self._handle_message(msg)
        except queue.Empty:
            pass

        self.root.after(50, self._poll_messages)

    def _handle_message(self, msg):
        if isinstance(msg, MsgStatus):
            self._set_status(msg.text, msg.color)

        elif isinstance(msg, MsgProgress):
            self.progress["maximum"] = msg.maximum
            self.progress["value"] = msg.value

        elif isinstance(msg, MsgBootSector):
            for line in msg.info_text.strip().split("\n"):
                self._log(line, "dim")

        elif isinstance(msg, MsgFileFound):
            is_son = msg.name.upper().endswith(".SON")
            size_str = f"{msg.size:,} bytes"
            tag = "son" if is_son else "info"
            self._log(f"  ⟳ {msg.name:<20s} {size_str:>12s}", tag)

        elif isinstance(msg, MsgFileComplete):
            # Update the last line to show checkmark
            self.file_list.config(state="normal")
            # Find and replace the spinner on the last occurrence
            content = self.file_list.get("1.0", "end")
            # Replace the last ⟳ for this file with ✓
            last_pos = content.rfind(f"⟳ {msg.name}")
            if last_pos >= 0:
                # Convert character offset to line.col
                before = content[:last_pos]
                line_num = before.count("\n") + 1
                col = last_pos - before.rfind("\n") - 1
                start_idx = f"{line_num}.{col}"
                end_idx = f"{line_num}.{col + 1}"
                self.file_list.delete(start_idx, end_idx)
                self.file_list.insert(start_idx, "✓", "success")
            self.file_list.config(state="disabled")

        elif isinstance(msg, MsgDiskComplete):
            self.disk_count = msg.disk_number
            self.disk_count_label.config(text=f"{self.disk_count} disk(s) archived")

            son_files = [f for f in msg.files if f.name.upper().endswith(".SON")]
            self._log("")
            self._log(f"  ════════════════════════════════════", "dim")
            self._log(f"  ✓ Disk #{msg.disk_number} complete!", "success")
            self._log(f"    {len(msg.files)} file(s), {msg.total_size:,} bytes", "bright")
            if son_files:
                self._log(f"    🎵 {len(son_files)} .SON file(s) found!", "son")

            # Add to history
            timestamp = datetime.now().strftime("%H:%M:%S")
            son_str = f"  🎵 {len(son_files)} .SON" if son_files else ""
            self._log_history(
                f"  [{timestamp}]  Disk #{msg.disk_number:03d}  "
                f"{len(msg.files)} files  {msg.total_size:,} bytes{son_str}",
                "success"
            )

            play_completion_sound()

        elif isinstance(msg, MsgEjected):
            if msg.success:
                self._log(f"  ⏏ Disk ejected safely", "success")
                self._set_status(
                    "✓ Complete — insert next disk!" if self.bulk_mode else "✓ Complete!",
                    COLORS["green"],
                )
            else:
                self._log(f"  ⚠ Eject: {msg.message}", "warn")
                self._set_status("Done (manual eject needed)", COLORS["yellow"])

            # Reset for next disk
            self.is_reading = False
            self.current_device = None
            self.read_once_btn.config(state="normal")

            # In bulk mode, start polling again after a brief delay
            if self.bulk_mode:
                self.root.after(3000, self._start_polling)

        elif isinstance(msg, MsgError):
            self._log(f"\n  ✖ {msg.text}", "error")
            self._set_status("Error!", COLORS["red"])
            self.is_reading = False
            self.current_device = None
            self.read_once_btn.config(state="normal")

            if self.bulk_mode:
                self.root.after(5000, self._start_polling)

    # ── Run ────────────────────────────────────────────────────────────

    def run(self):
        self.root.mainloop()


# ════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Notator Floppy Reader GUI")
    parser.add_argument(
        "--output-dir", "-o",
        default="./floppy_archive",
        help="Output directory for disk images and extracted files",
    )
    args = parser.parse_args()

    # Check for sudo on macOS/Linux
    if platform.system() in ("Darwin", "Linux") and os.geteuid() != 0:
        print("⚠  Warning: Raw disk access requires root privileges.")
        print("   Run with: sudo python3 notator_floppy_gui.py")
        print("   Continuing anyway (detection will work, reading may fail)...\n")

    app = FloppyReaderApp(output_dir=args.output_dir)
    app.run()


if __name__ == "__main__":
    main()
