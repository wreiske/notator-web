"use client";

/**
 * Community page — Browse and discover shared songs
 */

import { useState, useEffect, useCallback } from "react";
import { listSongs, type SongPublic } from "@/lib/auth/api";
import { SongCard } from "@/components/songs/SongCard";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthContext";
import { LoginModal } from "@/components/auth/LoginModal";
import { UserMenu } from "@/components/auth/UserMenu";

type SortOption = "newest" | "top-rated" | "most-liked" | "most-played";

export default function CommunityPage() {
  const { isAuthenticated } = useAuth();
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
      <header className="border-b border-notator-border bg-notator-surface px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl">🎹</span>
              <span className="text-sm font-bold text-notator-text">
                Notator
              </span>
            </Link>
            <span className="text-notator-border">|</span>
            <h1 className="text-sm font-bold text-notator-accent">Community</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/player"
              className="text-[10px] text-notator-text-dim hover:text-notator-accent"
            >
              Player
            </Link>
            {isAuthenticated && (
              <Link
                href="/files"
                className="text-[10px] text-notator-text-dim hover:text-notator-accent"
              >
                My Files
              </Link>
            )}
            <UserMenu onLoginClick={() => setShowLogin(true)} />
          </div>
        </div>
      </header>

      {/* Controls */}
      <div className="border-b border-notator-border bg-notator-panel px-6 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
          {/* Sort */}
          <div className="flex gap-1">
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setSort(opt.value);
                  setPage(1);
                }}
                className={`rounded px-2.5 py-1 text-[10px] font-bold transition-colors ${
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

          {/* Search */}
          <form onSubmit={handleSearch} className="ml-auto flex gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search songs..."
              className="rounded border border-notator-border bg-notator-bg px-3 py-1 font-mono text-[11px] text-notator-text placeholder-notator-text-dim focus:border-notator-accent focus:outline-none"
              id="community-search"
            />
            <button
              type="submit"
              className="rounded border border-notator-border px-2 py-1 text-[10px] text-notator-text-dim hover:border-notator-accent hover:text-notator-accent"
              id="community-search-btn"
            >
              🔍
            </button>
          </form>
        </div>
      </div>

      {/* Song Grid */}
      <main className="flex-1 px-6 py-6">
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
                    className="rounded border border-notator-border px-3 py-1 text-[10px] text-notator-text-dim hover:border-notator-accent disabled:opacity-30"
                  >
                    ← Prev
                  </button>
                  <span className="text-[10px] text-notator-text-dim">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded border border-notator-border px-3 py-1 text-[10px] text-notator-text-dim hover:border-notator-accent disabled:opacity-30"
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
      <footer className="border-t border-notator-border py-4 text-center text-[10px] text-notator-text-dim">
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
