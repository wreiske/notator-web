"use client";

/**
 * SongCard — Card component for song listings
 */

import Link from "next/link";
import type { SongPublic } from "@/lib/auth/api";

interface SongCardProps {
  song: SongPublic;
}

export function SongCard({ song }: SongCardProps) {
  const avgRating = song.avg_rating || 0;
  const likeCount = song.like_count || 0;
  const tags: string[] = song.tags ? JSON.parse(song.tags) : [];
  const dateStr = new Date(song.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <Link
      href={`/songs/${song.id}`}
      className="group block rounded-lg border border-notator-border bg-notator-surface p-4 transition-all hover:border-notator-accent/50 hover:bg-notator-surface-hover"
      id={`song-card-${song.id}`}
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="truncate text-sm font-bold text-notator-text group-hover:text-notator-accent">
            {song.title}
          </h3>
          <p className="text-[10px] text-notator-text-dim">
            by {song.author_name || "Unknown"} {song.year && `· ${song.year}`}
          </p>
        </div>
        <div className="ml-2 flex-shrink-0 text-lg">🎹</div>
      </div>

      {/* Description */}
      {song.description && (
        <p className="mb-3 line-clamp-2 text-[11px] leading-relaxed text-notator-text-muted">
          {song.description}
        </p>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded border border-notator-border bg-notator-bg px-1.5 py-0.5 text-[9px] text-notator-text-dim"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats footer */}
      <div className="flex items-center gap-3 text-[10px] text-notator-text-dim">
        {/* Rating */}
        <span title={`${avgRating.toFixed(1)} average rating`}>
          ⭐ {avgRating > 0 ? avgRating.toFixed(1) : "—"}
        </span>
        {/* Likes */}
        <span title={`${likeCount} likes`}>❤️ {likeCount}</span>
        {/* Plays */}
        <span title={`${song.play_count} plays`}>▶ {song.play_count}</span>
        {/* Date */}
        <span className="ml-auto">{dateStr}</span>
      </div>
    </Link>
  );
}
