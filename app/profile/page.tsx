"use client";

/**
 * Profile page — View a user's public profile and published songs
 */

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  getUserProfile,
  updateProfile,
  type UserPublic,
  type SongPublic,
} from "@/lib/auth/api";
import { useAuth } from "@/lib/auth/AuthContext";
import { SongCard } from "@/components/songs/SongCard";
import Link from "next/link";
import { MobileNav } from "@/components/ui/MobileNav";
import { LoginModal } from "@/components/auth/LoginModal";

function ProfileContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") || "";
  const { user: currentUser, isAuthenticated } = useAuth();

  const [user, setUser] = useState<UserPublic | null>(null);
  const [songs, setSongs] = useState<SongPublic[]>([]);
  const [stats, setStats] = useState<{ songCount: number; totalPlays: number }>(
    { songCount: 0, totalPlays: 0 },
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  // Edit mode
  const isOwnProfile = isAuthenticated && currentUser?.id === id;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [saving, setSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getUserProfile(id);
      setUser(data.user);
      setSongs(data.songs);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleStartEdit = () => {
    if (!user) return;
    setEditName(user.display_name || "");
    setEditBio(user.bio || "");
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const result = await updateProfile(id, {
        display_name: editName,
        bio: editBio,
      });
      setUser(result.user);
      setEditing(false);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const joinDate = user
    ? new Date(user.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  const initials = (user?.display_name || "?").substring(0, 2).toUpperCase();

  if (!id) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-notator-bg-deep font-mono px-4">
        <span className="text-5xl">👤</span>
        <h1 className="mt-4 text-xl font-bold text-notator-text">
          No Profile ID
        </h1>
        <Link
          href="/community"
          className="notator-btn mt-6 rounded border-notator-accent bg-notator-accent px-6 py-2.5 text-sm text-white hover:bg-notator-accent-hover"
        >
          Back to Community
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-notator-bg-deep font-mono">
        <MobileNav onLoginClick={() => setShowLogin(true)} />
        <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
          <div className="animate-pulse space-y-6">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-notator-surface" />
              <div className="space-y-2">
                <div className="h-5 w-40 rounded bg-notator-surface" />
                <div className="h-3 w-24 rounded bg-notator-surface" />
              </div>
            </div>
            <div className="h-20 rounded bg-notator-surface" />
          </div>
        </div>
        <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-notator-bg-deep font-mono px-4">
        <span className="text-5xl">👤</span>
        <h1 className="mt-4 text-xl font-bold text-notator-text">
          User Not Found
        </h1>
        <p className="mt-2 text-sm text-notator-text-muted">
          {error || "This profile doesn't exist."}
        </p>
        <Link
          href="/community"
          className="notator-btn mt-6 rounded border-notator-accent bg-notator-accent px-6 py-2.5 text-sm text-white hover:bg-notator-accent-hover"
        >
          Back to Community
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-notator-bg-deep font-mono">
      <MobileNav onLoginClick={() => setShowLogin(true)} />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        {/* Profile header */}
        <div className="rounded-lg border border-notator-border bg-notator-surface p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {/* Avatar */}
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full border-2 border-notator-accent/40 bg-notator-accent/20 text-xl font-bold text-notator-accent">
              {initials}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={50}
                    placeholder="Display name"
                    className="w-full rounded border border-notator-border bg-notator-bg px-3 py-2 font-mono text-sm text-notator-text focus:border-notator-accent focus:outline-none"
                    id="profile-edit-name"
                  />
                  <textarea
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="Tell us about yourself..."
                    className="w-full resize-none rounded border border-notator-border bg-notator-bg px-3 py-2 font-mono text-xs text-notator-text focus:border-notator-accent focus:outline-none"
                    id="profile-edit-bio"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving}
                      className="notator-btn rounded border-notator-accent bg-notator-accent px-4 py-1.5 text-xs text-white hover:bg-notator-accent-hover disabled:opacity-50"
                      id="profile-save-btn"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="rounded border border-notator-border px-4 py-1.5 text-xs text-notator-text-dim hover:border-notator-accent"
                      id="profile-cancel-btn"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <h1 className="text-xl font-bold text-notator-text">
                      {user.display_name || "Notator User"}
                    </h1>
                    {isOwnProfile && (
                      <button
                        onClick={handleStartEdit}
                        className="rounded border border-notator-border px-2 py-0.5 text-[10px] text-notator-text-dim hover:border-notator-accent hover:text-notator-accent"
                        id="profile-edit-btn"
                      >
                        ✏️ Edit
                      </button>
                    )}
                  </div>
                  {user.bio && (
                    <p className="mt-2 text-xs leading-relaxed text-notator-text-muted">
                      {user.bio}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-notator-text-dim">
                    <span>📅 Joined {joinDate}</span>
                    <span>🎵 {stats.songCount} songs</span>
                    <span>▶ {stats.totalPlays} plays</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Published songs */}
        <div className="mt-8">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-notator-text-dim">
            Published Songs
          </h2>

          {songs.length === 0 ? (
            <div className="rounded-lg border border-notator-border bg-notator-surface py-12 text-center">
              <span className="text-3xl">🎵</span>
              <p className="mt-2 text-sm text-notator-text-muted">
                No published songs yet
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {songs.map((song) => (
                <SongCard key={song.id} song={song} />
              ))}
            </div>
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

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-notator-bg-deep">
          <div className="animate-pulse text-notator-text-muted text-sm">
            Loading profile…
          </div>
        </div>
      }
    >
      <ProfileContent />
    </Suspense>
  );
}
