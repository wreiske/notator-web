//! son_to_midi CLI — Bulk convert Notator .SON files to Standard MIDI (.mid).
//!
//! Usage:
//!   son_to_midi [OPTIONS] <PATH>
//!
//!   -o, --output-dir <DIR>    Write .mid files to this directory
//!   -n, --dry-run             Preview only
//!   -f, --force               Overwrite existing .mid files
//!   -v, --verbose             Detailed output

use son_parser::{export_to_midi, parse_song_data};
use std::path::{Path, PathBuf};
use std::process;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (path, output_dir, dry_run, force, verbose) = parse_args(&args);

    let target = Path::new(&path);
    if !target.exists() {
        eprintln!("Error: {} does not exist", path);
        process::exit(1);
    }

    // Collect .SON files
    let son_files = if target.is_file() {
        vec![target.to_path_buf()]
    } else {
        collect_son_files(target)
    };

    if son_files.is_empty() {
        println!("No .SON files found in {}", path);
        process::exit(0);
    }

    println!("Found {} .SON file(s)\n", son_files.len());

    let mut converted = 0u32;
    let mut skipped = 0u32;
    let mut errors = 0u32;

    for sf in &son_files {
        let rel = if target.is_dir() {
            sf.strip_prefix(target)
                .unwrap_or(sf)
                .to_string_lossy()
                .to_string()
        } else {
            sf.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        };

        // Determine output path
        let out_path = if let Some(ref out_dir) = output_dir {
            let rel_mid = if target.is_dir() {
                sf.strip_prefix(target).unwrap_or(sf).with_extension("mid")
            } else {
                PathBuf::from(sf.file_name().unwrap_or_default()).with_extension("mid")
            };
            let full_path = Path::new(out_dir).join(&rel_mid);
            if let Some(parent) = full_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            full_path
        } else {
            sf.with_extension("mid")
        };

        if out_path.exists() && !force {
            if verbose {
                println!("  SKIP  {} (already exists)", rel);
            }
            skipped += 1;
            continue;
        }

        if dry_run {
            println!(
                "  [DRY] {} → {}",
                rel,
                out_path.file_name().unwrap_or_default().to_string_lossy()
            );
            continue;
        }

        match convert_file(sf, &out_path) {
            Ok(msg) => {
                converted += 1;
                println!(
                    "  ✓ {} → {}  ({})",
                    rel,
                    out_path.file_name().unwrap_or_default().to_string_lossy(),
                    msg
                );
            }
            Err(msg) => {
                if msg.contains("Empty file")
                    || msg.contains("Too small")
                    || msg.contains("Bad magic")
                {
                    skipped += 1;
                    println!("  SKIP  {}: {}", rel, msg);
                } else {
                    errors += 1;
                    println!("  ✗ {}: {}", rel, msg);
                }
            }
        }
    }

    // Summary
    let bar = "─".repeat(60);
    println!("\n{}", bar);
    println!("  Converted: {}", converted);
    println!("  Skipped:   {}", skipped);
    println!("  Errors:    {}", errors);
    println!("  Total:     {}", son_files.len());
    println!("{}", bar);

    process::exit(if errors > 0 { 1 } else { 0 });
}

fn convert_file(son_path: &Path, mid_path: &Path) -> Result<String, String> {
    let raw = std::fs::read(son_path).map_err(|e| format!("Read error: {}", e))?;

    if raw.is_empty() {
        return Err("Empty file (0 bytes)".to_string());
    }

    if raw.len() < 0x5AC8 {
        let magic = if raw.len() >= 2 {
            ((raw[0] as u16) << 8) | (raw[1] as u16)
        } else {
            0
        };
        if magic != 0x3B9E {
            return Err(format!(
                "Too small ({} bytes) and Bad magic 0x{:04X}",
                raw.len(),
                magic
            ));
        }
        return Err(format!("Too small ({} bytes, need {})", raw.len(), 0x5AC8));
    }

    let song = parse_song_data(&raw).map_err(|e| format!("Parse error: {}", e))?;

    // Count notes across all patterns
    let total_notes: usize = song
        .patterns
        .iter()
        .flat_map(|p| &p.tracks)
        .flat_map(|t| &t.events)
        .filter(|e| matches!(e, son_parser::types::TrackEvent::NoteOn(_)))
        .count();

    let total_midi_events: usize = song
        .patterns
        .iter()
        .flat_map(|p| &p.tracks)
        .map(|t| t.events.len())
        .sum();

    if total_notes == 0 && total_midi_events == 0 {
        return Err("No MIDI events found".to_string());
    }

    let song_name = son_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let midi_data = export_to_midi(&song, &song_name);

    std::fs::write(mid_path, &midi_data).map_err(|e| format!("Write error: {}", e))?;

    Ok(format!(
        "{} bytes, {} pattern(s), {} arrangement entries, {} notes, {} BPM",
        midi_data.len(),
        song.patterns.len(),
        song.arrangement.len(),
        total_notes,
        song.tempo
    ))
}

fn collect_son_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = walkdir(dir) {
        for entry in entries {
            if let Some(ext) = entry.extension() {
                if ext.eq_ignore_ascii_case("son") {
                    files.push(entry);
                }
            }
        }
    }
    files.sort();
    files
}

fn walkdir(dir: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut result = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            result.extend(walkdir(&path)?);
        } else {
            result.push(path);
        }
    }
    Ok(result)
}

fn parse_args(args: &[String]) -> (String, Option<String>, bool, bool, bool) {
    let mut path = String::new();
    let mut output_dir: Option<String> = None;
    let mut dry_run = false;
    let mut force = false;
    let mut verbose = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-o" | "--output-dir" => {
                i += 1;
                if i < args.len() {
                    output_dir = Some(args[i].clone());
                }
            }
            "-n" | "--dry-run" => dry_run = true,
            "-f" | "--force" => force = true,
            "-v" | "--verbose" => verbose = true,
            "-h" | "--help" => {
                println!("Usage: son_to_midi [OPTIONS] <PATH>");
                println!();
                println!("Bulk convert Notator .SON files to Standard MIDI (.mid)");
                println!();
                println!("Options:");
                println!("  -o, --output-dir <DIR>  Write .mid files to this directory");
                println!("  -n, --dry-run           Preview only");
                println!("  -f, --force             Overwrite existing .mid files");
                println!("  -v, --verbose           Detailed output");
                println!("  -h, --help              Show this help");
                process::exit(0);
            }
            _ => {
                if path.is_empty() {
                    path = args[i].clone();
                }
            }
        }
        i += 1;
    }

    if path.is_empty() {
        eprintln!("Error: no path specified. Use --help for usage.");
        process::exit(1);
    }

    (path, output_dir, dry_run, force, verbose)
}
