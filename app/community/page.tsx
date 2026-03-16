"use client";

/**
 * Community page — Browse and discover shared songs
 */

import { useState, useEffect, useCallback } from "react";
import { listSongs, type SongPublic } from "@/lib/auth/api";
import { SongCard } from "@/components/songs/SongCard";
import Link from "next/link";
import { LoginModal } from "@/components/auth/LoginModal";
import { MobileNav } from "@/components/ui/MobileNav";

type SortOption = "newest" | "top-rated" | "most-liked" | "most-played";

export default function CommunityPage() {
  const [songs, setSongs] = useState<SongPublic[]>([]);
  const [sort, setSort] = useState<SortOption>("newest");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);

  const loadSongs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listSongs({
        page,
        sort,
        q: search || undefined,
        limit: 12,
      });
      setSongs(data.songs);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      console.error("Failed to load songs:", err);
    } finally {
      setLoading(false);
    }
  }, [page, sort, search]);

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadSongs();
  };

  const sortOptions: { value: SortOption; label: string; icon: string }[] = [
    { value: "newest", label: "Newest", icon: "🕐" },
    { value: "top-rated", label: "Top Rated", icon: "⭐" },
    { value: "most-liked", label: "Most Liked", icon: "❤️" },
    { value: "most-played", label: "Most Played", icon: "▶" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-notator-bg-deep font-mono">
      {/* Header */}
      <MobileNav
        onLoginClick={() => setShowLogin(true)}
        activePage="community"
      />

      {/* Controls */}
      <div className="border-b border-notator-border bg-notator-panel px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center">
          {/* Sort — scrollable on mobile */}
          <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0">
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setSort(opt.value);
                  setPage(1);
                }}
                className={`flex-shrink-0 rounded px-3 py-2 text-xs font-bold transition-colors sm:px-2.5 sm:py-1 sm:text-[10px] ${
                  sort === opt.value
                    ? "bg-notator-accent text-white"
                    : "text-notator-text-dim hover:text-notator-text hover:bg-notator-surface-hover"
                }`}
                id={`sort-${opt.value}`}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>

          {/* Search — full width on mobile */}
          <form
            onSubmit={handleSearch}
            className="flex w-full gap-2 sm:ml-auto sm:w-auto"
          >
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search songs..."
              className="min-w-0 flex-1 rounded border border-notator-border bg-notator-bg px-3 py-2 font-mono text-xs text-notator-text placeholder-notator-text-dim focus:border-notator-accent focus:outline-none sm:py-1 sm:text-[11px]"
              id="community-search"
            />
            <button
              type="submit"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded border border-notator-border text-sm text-notator-text-dim hover:border-notator-accent hover:text-notator-accent sm:h-auto sm:w-auto sm:px-2 sm:py-1 sm:text-[10px]"
              id="community-search-btn"
            >
              🔍
            </button>
          </form>
        </div>
      </div>

      {/* Song Grid */}
      <main className="flex-1 px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-6xl">
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-40 animate-pulse rounded-lg border border-notator-border bg-notator-surface"
                />
              ))}
            </div>
          ) : songs.length === 0 ? (
            <div className="py-20 text-center">
              <span className="text-4xl">🎵</span>
              <h2 className="mt-4 text-lg font-bold text-notator-text">
                No songs yet
              </h2>
              <p className="mt-2 text-sm text-notator-text-muted">
                Be the first to share a song with the community!
              </p>
              <Link
                href="/player"
                className="notator-btn mt-4 inline-block rounded border-notator-accent bg-notator-accent px-6 py-2 text-sm text-white hover:bg-notator-accent-hover"
              >
                Open Player
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {songs.map((song) => (
                  <SongCard key={song.id} song={song} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded border border-notator-border px-4 py-2 text-xs text-notator-text-dim hover:border-notator-accent disabled:opacity-30 sm:px-3 sm:py-1 sm:text-[10px]"
                  >
                    ← Prev
                  </button>
                  <span className="text-xs text-notator-text-dim sm:text-[10px]">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded border border-notator-border px-4 py-2 text-xs text-notator-text-dim hover:border-notator-accent disabled:opacity-30 sm:px-3 sm:py-1 sm:text-[10px]"
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-notator-border py-4 text-center text-xs text-notator-text-dim">
        <p>
          Notator Web — The Atari ST Sequencer Community at{" "}
          <a href="https://notator.online" className="text-notator-accent">
            notator.online
          </a>
        </p>
      </footer>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  );
}
