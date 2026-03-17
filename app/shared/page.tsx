"use client";

/**
 * Shared file page — Displays a shared .SON file with download/play options
 */

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { parseSonFileWasm } from "@/lib/son-parser/wasm-adapter";
import Link from "next/link";

function SharedContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("Unknown.SON");
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [songInfo, setSongInfo] = useState<{
    tempo: number;
    trackCount: number;
    patternCount: number;
  } | null>(null);

  const loadSharedFile = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/files/shared/${token}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError("This shared file was not found or is no longer shared.");
        } else {
          setError("Failed to load shared file.");
        }
        return;
      }

      const disposition = response.headers.get("Content-Disposition");
      if (disposition) {
        const match = disposition.match(/filename="?([^";\n]+)"?/);
        if (match) setFilename(match[1]);
      }

      const buffer = await response.arrayBuffer();
      setFileBuffer(buffer);

      try {
        const parsed = await parseSonFileWasm(buffer);
        setSongInfo({
          tempo: parsed.songData.tempo,
          trackCount: parsed.songData.tracks.length,
          patternCount: parsed.songData.patterns.length,
        });
      } catch {
        // File may not parse — that's ok, still allow download
      }
    } catch {
      setError("Network error — could not fetch file.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSharedFile();
  }, [loadSharedFile]);

  const handleDownload = () => {
    if (!fileBuffer) return;
    const blob = new Blob([fileBuffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenInPlayer = () => {
    if (!fileBuffer) return;
    const uint8 = new Uint8Array(fileBuffer);
    const base64 = btoa(String.fromCharCode(...uint8));
    sessionStorage.setItem("notator_shared_file", base64);
    sessionStorage.setItem("notator_shared_filename", filename);
    router.push("/player?source=shared");
  };

  if (!token) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-notator-bg-deep font-mono px-4">
        <span className="text-5xl">🔗</span>
        <h1 className="mt-4 text-xl font-bold text-notator-text">
          Invalid Share Link
        </h1>
        <Link
          href="/"
          className="notator-btn mt-6 rounded border-notator-accent bg-notator-accent px-6 py-2.5 text-sm text-white hover:bg-notator-accent-hover"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-notator-bg-deep font-mono px-4">
        <div className="animate-pulse space-y-4 text-center">
          <span className="text-5xl">🔗</span>
          <p className="text-sm text-notator-text-muted">
            Loading shared file…
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-notator-bg-deep font-mono px-4">
        <span className="text-5xl">🔗</span>
        <h1 className="mt-4 text-xl font-bold text-notator-text">
          Shared File
        </h1>
        <p className="mt-2 text-sm text-notator-red">{error}</p>
        <Link
          href="/"
          className="notator-btn mt-6 rounded border-notator-accent bg-notator-accent px-6 py-2.5 text-sm text-white hover:bg-notator-accent-hover"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-notator-bg-deep font-mono px-4">
      <div className="w-full max-w-md rounded-lg border border-notator-border-bright bg-notator-surface p-8">
        <div className="mb-4 text-center text-5xl">🎵</div>

        <h1 className="text-center text-lg font-bold text-notator-text">
          {filename}
        </h1>
        <p className="mt-1 text-center text-[11px] text-notator-text-dim">
          Shared Notator .SON file
        </p>

        {songInfo && (
          <div className="mt-4 flex justify-center gap-4 text-[10px] text-notator-text-dim">
            <span>🎵 {songInfo.trackCount} tracks</span>
            <span>📋 {songInfo.patternCount} patterns</span>
            <span>♩ {songInfo.tempo} BPM</span>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={handleOpenInPlayer}
            className="notator-btn w-full rounded border-notator-accent bg-notator-accent py-3 text-sm text-white hover:bg-notator-accent-hover"
            id="shared-open-player"
          >
            ▶ Open in Player
          </button>
          <button
            onClick={handleDownload}
            className="notator-btn w-full rounded border border-notator-border py-3 text-sm text-notator-text-muted hover:border-notator-accent hover:text-notator-text"
            id="shared-download"
          >
            📥 Download File
          </button>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/community"
            className="text-[10px] text-notator-text-dim hover:text-notator-accent"
          >
            Browse more songs on the community →
          </Link>
        </div>
      </div>

      <p className="mt-8 text-[10px] text-notator-text-dim">
        Notator Online — The Atari ST Sequencer Community at{" "}
        <a href="https://notator.online" className="text-notator-accent">
          notator.online
        </a>
      </p>
    </div>
  );
}

export default function SharedFilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-notator-bg-deep">
          <div className="animate-pulse text-notator-text-muted text-sm">
            Loading…
          </div>
        </div>
      }
    >
      <SharedContent />
    </Suspense>
  );
}
