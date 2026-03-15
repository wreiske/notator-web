"use client";

/**
 * PublishModal — Publish a song to the community
 *
 * Shown from the player when a logged-in user has a song loaded.
 */

import { useState, type FormEvent } from "react";
import { publishSong } from "@/lib/auth/api";

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  songBuffer: ArrayBuffer | null;
  songFileName: string;
  onPublished?: (songId: string) => void;
}

export function PublishModal({
  isOpen,
  onClose,
  songBuffer,
  songFileName,
  onPublished,
}: PublishModalProps) {
  const [title, setTitle] = useState(songFileName.replace(/\.son$/i, ""));
  const [description, setDescription] = useState("");
  const [year, setYear] = useState("");
  const [tags, setTags] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!songBuffer) return;

    setError(null);
    setLoading(true);

    try {
      const file = new File(
        [songBuffer],
        songFileName.endsWith(".SON") || songFileName.endsWith(".son")
          ? songFileName
          : `${songFileName}.SON`,
        { type: "application/octet-stream" },
      );

      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const result = await publishSong(file, {
        title: title.trim(),
        description: description.trim() || undefined,
        year: year.trim() || undefined,
        tags: tagList.length > 0 ? tagList : undefined,
        isPublic,
      });

      onPublished?.(result.song.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="notator-dialog-overlay"
      onClick={onClose}
      id="publish-modal-overlay"
    >
      <div
        className="notator-dialog"
        style={{ width: 460 }}
        onClick={(e) => e.stopPropagation()}
        id="publish-modal"
      >
        {/* Title bar */}
        <div className="notator-dialog-titlebar">
          <span className="flex-1 font-bold">🎵 Publish to Community</span>
          <button className="notator-dialog-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="rounded border border-notator-border bg-notator-bg/50 px-3 py-2 text-[11px] text-notator-text-dim">
            📂 {songFileName}
          </div>

          {/* Title */}
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-notator-text-dim">
              Song Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={100}
              className="w-full rounded border border-notator-border bg-notator-bg px-3 py-2 font-mono text-sm text-notator-text focus:border-notator-accent focus:outline-none"
              id="publish-title"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-notator-text-dim">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Tell the community about this song..."
              className="w-full resize-none rounded border border-notator-border bg-notator-bg px-3 py-2 font-mono text-sm text-notator-text placeholder-notator-text-dim focus:border-notator-accent focus:outline-none"
              id="publish-description"
            />
          </div>

          {/* Year + Tags row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-notator-text-dim">
                Year Created
              </label>
              <input
                type="text"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="e.g. 1992"
                maxLength={4}
                className="w-full rounded border border-notator-border bg-notator-bg px-3 py-2 font-mono text-sm text-notator-text placeholder-notator-text-dim focus:border-notator-accent focus:outline-none"
                id="publish-year"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-notator-text-dim">
                Tags
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="ambient, demo, drums"
                className="w-full rounded border border-notator-border bg-notator-bg px-3 py-2 font-mono text-sm text-notator-text placeholder-notator-text-dim focus:border-notator-accent focus:outline-none"
                id="publish-tags"
              />
            </div>
          </div>

          {/* Visibility */}
          <label
            className="flex cursor-pointer items-center gap-2"
            id="publish-visibility"
          >
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="accent-notator-accent"
            />
            <span className="text-xs text-notator-text-muted">
              Share publicly with the community
            </span>
          </label>

          {error && (
            <div className="rounded border border-notator-red/30 bg-notator-red/10 px-3 py-2 text-xs text-notator-red">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="notator-btn flex-1 rounded border-notator-border px-4 py-2 text-sm text-notator-text-muted hover:text-notator-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="notator-btn flex-1 rounded border-notator-accent bg-notator-accent px-4 py-2 text-sm text-white hover:bg-notator-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              id="publish-submit"
            >
              {loading ? "Publishing..." : "Publish"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
