"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { getCommunityStats, listSongs, type SongPublic } from "@/lib/auth/api";
import { SongCard } from "@/components/songs/SongCard";
import { useAuth } from "@/lib/auth/AuthContext";
import { LoginModal } from "@/components/auth/LoginModal";
import { MobileNav } from "@/components/ui/MobileNav";

export default function HomePage() {
  const { isAuthenticated } = useAuth();
  const [stats, setStats] = useState({
    users: 0,
    songs: 0,
    plays: 0,
    comments: 0,
  });
  const [featuredSongs, setFeaturedSongs] = useState<SongPublic[]>([]);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    getCommunityStats()
      .then(setStats)
      .catch(() => {});
    listSongs({ sort: "top-rated", limit: 6 })
      .then((data) => setFeaturedSongs(data.songs))
      .catch(() => {});
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-notator-bg-deep font-mono">
      <MobileNav onLoginClick={() => setShowLogin(true)} activePage="home" />

      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="flex flex-col items-center justify-center px-4 py-12 sm:py-20">
          <div className="max-w-2xl text-center">
            <div className="mb-6 inline-flex items-center gap-3 rounded border border-notator-border-bright bg-notator-surface px-5 py-2.5 sm:mb-8 sm:px-6 sm:py-3">
              <div className="flex h-10 w-10 items-center justify-center rounded bg-notator-highlight/20 text-2xl">
                🎹
              </div>
              <div className="text-left">
                <h1 className="text-base font-bold tracking-tight text-notator-text sm:text-lg">
                  Notator Web
                </h1>
                <p className="text-[9px] uppercase tracking-widest text-notator-text-dim sm:text-[10px]">
                  Community Edition
                </p>
              </div>
            </div>

            <h2 className="mb-4 text-3xl font-bold tracking-tight text-notator-text sm:text-4xl md:text-5xl">
              Archive, Play &amp; Share{" "}
              <span className="text-notator-accent">Atari ST Music</span>
            </h2>

            <p className="mx-auto mb-6 max-w-lg text-sm text-notator-text-muted sm:mb-8 sm:text-base">
              The home for Notator SL{" "}
              <code className="rounded border border-notator-border bg-notator-surface px-1.5 py-0.5 text-xs text-notator-accent sm:text-sm">
                .SON
              </code>{" "}
              files. Play in your browser, upload your collection, and share
              with the community.
            </p>

            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-3">
              <Link
                href="/player"
                className="inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-notator-accent px-6 text-sm font-bold text-white transition-all hover:bg-notator-accent-hover hover:scale-105 active:scale-95 sm:w-auto"
                id="cta-open-player"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 18 18"
                  fill="currentColor"
                >
                  <path d="M5 3.5L14.5 9L5 14.5V3.5Z" />
                </svg>
                Open Player
              </Link>
              <Link
                href="/community"
                className="inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md border border-notator-border bg-notator-surface px-6 text-sm font-bold text-notator-text-muted transition-colors hover:border-notator-accent hover:text-notator-text sm:w-auto"
                id="cta-community"
              >
                🎵 Browse Songs
              </Link>
              {!isAuthenticated && (
                <button
                  onClick={() => setShowLogin(true)}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md border border-notator-green/30 bg-notator-green/5 px-6 text-sm font-bold text-notator-green transition-colors hover:border-notator-green hover:bg-notator-green/10 sm:w-auto"
                  id="cta-join"
                >
                  ✨ Join the Community
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Community Stats */}
        <section className="border-y border-notator-border bg-notator-surface/30 px-4 py-6 sm:py-8">
          <div className="mx-auto grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { value: stats.users, label: "Members", icon: "👤" },
              { value: stats.songs, label: "Songs Shared", icon: "🎵" },
              { value: stats.plays, label: "Total Plays", icon: "▶" },
              { value: stats.comments, label: "Comments", icon: "💬" },
            ].map(({ value, label, icon }) => (
              <div key={label} className="text-center">
                <div className="text-lg">{icon}</div>
                <div className="text-xl font-bold text-notator-accent sm:text-2xl">
                  {value.toLocaleString()}
                </div>
                <div className="text-[9px] uppercase tracking-widest text-notator-text-dim sm:text-[10px]">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section className="px-4 py-12 sm:py-16">
          <div className="mx-auto max-w-3xl">
            <h3 className="mb-6 text-center text-xs font-bold uppercase tracking-widest text-notator-text-dim sm:mb-8">
              How It Works
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                {
                  step: "1",
                  icon: "📂",
                  title: "Open or Upload",
                  desc: "Load .SON files from your computer or upload them to your personal drive for cloud storage.",
                },
                {
                  step: "2",
                  icon: "🎵",
                  title: "Play & Explore",
                  desc: "Full playback with GM synthesis or Web MIDI output. Edit tracks, view notation, export to MIDI.",
                },
                {
                  step: "3",
                  icon: "🌍",
                  title: "Share & Archive",
                  desc: "Publish songs to the community. Rate, comment, and help preserve Atari ST music history.",
                },
              ].map(({ step, icon, title, desc }) => (
                <div
                  key={step}
                  className="rounded border border-notator-border bg-notator-surface p-4 transition-colors hover:border-notator-border-bright sm:p-5"
                >
                  <div className="mb-1 text-[10px] font-bold text-notator-accent">
                    STEP {step}
                  </div>
                  <div className="mb-2 text-2xl sm:mb-3">{icon}</div>
                  <h4 className="mb-1 text-sm font-bold text-notator-text">
                    {title}
                  </h4>
                  <p className="text-xs leading-relaxed text-notator-text-dim">
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Feature Cards */}
        <section className="border-t border-notator-border bg-notator-surface/20 px-4 py-12 sm:py-16">
          <div className="mx-auto max-w-3xl">
            <h3 className="mb-6 text-center text-xs font-bold uppercase tracking-widest text-notator-text-dim sm:mb-8">
              Features
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {[
                {
                  icon: "📂",
                  title: ".SON File Support",
                  desc: "Parse and play original Notator SL & Creator song files directly in the browser.",
                },
                {
                  icon: "🎵",
                  title: "Web MIDI Output",
                  desc: "Send MIDI to connected devices via Web MIDI API, with built-in synth fallback.",
                },
                {
                  icon: "☁️",
                  title: "Cloud Storage",
                  desc: "Upload and organize your .SON files. Access them from any device, share with a link.",
                },
                {
                  icon: "👥",
                  title: "Community",
                  desc: "Share songs, discover music from other Notator users, rate, comment, and connect.",
                },
                {
                  icon: "🎼",
                  title: "MIDI Export",
                  desc: "Export any song or individual track to Standard MIDI File format.",
                },
                {
                  icon: "🔒",
                  title: "No Account Required",
                  desc: "All playback features work without signing up. Create an account only when you want to share.",
                },
              ].map(({ icon, title, desc }) => (
                <div
                  key={title}
                  className="rounded border border-notator-border bg-notator-surface p-4 transition-colors hover:border-notator-border-bright sm:p-5"
                >
                  <div className="mb-2 text-2xl sm:mb-3">{icon}</div>
                  <h4 className="mb-1 text-sm font-bold text-notator-text">
                    {title}
                  </h4>
                  <p className="text-xs leading-relaxed text-notator-text-dim">
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Featured Songs */}
        {featuredSongs.length > 0 && (
          <section className="border-t border-notator-border px-4 py-12 sm:py-16">
            <div className="mx-auto max-w-5xl">
              <div className="mb-6 flex items-center justify-between sm:mb-8">
                <h3 className="text-xs font-bold uppercase tracking-widest text-notator-text-dim">
                  Featured Songs
                </h3>
                <Link
                  href="/community"
                  className="text-xs text-notator-accent hover:underline"
                >
                  View all →
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featuredSongs.map((song) => (
                  <SongCard key={song.id} song={song} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Join CTA */}
        {!isAuthenticated && (
          <section className="border-t border-notator-border bg-notator-surface/30 px-4 py-12 sm:py-16">
            <div className="mx-auto max-w-xl text-center">
              <span className="text-4xl">🎹</span>
              <h3 className="mt-4 text-xl font-bold text-notator-text sm:text-2xl">
                Join the Notator Community
              </h3>
              <p className="mt-2 text-sm text-notator-text-muted">
                Help us archive and preserve Atari ST music. Share your .SON
                files, discover songs from other users, and keep the Notator
                legacy alive.
              </p>
              <button
                onClick={() => setShowLogin(true)}
                className="notator-btn mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded border-notator-accent bg-notator-accent px-8 text-sm text-white transition-all hover:bg-notator-accent-hover hover:scale-105 sm:w-auto sm:text-base"
                id="cta-join-bottom"
              >
                ✨ Sign Up with Email
              </button>
              <p className="mt-2 text-xs text-notator-text-dim">
                No password needed — we&apos;ll send you a verification code
              </p>
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-notator-border px-4 py-6 text-center text-xs text-notator-text-dim">
        <div className="mx-auto max-w-3xl space-y-2">
          <div className="flex items-center justify-center gap-4">
            <Link href="/player" className="hover:text-notator-accent">
              Player
            </Link>
            <Link href="/community" className="hover:text-notator-accent">
              Community
            </Link>
            <a
              href="https://github.com/wreiske/notator"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-notator-accent"
            >
              GitHub
            </a>
          </div>
          <p>
            Notator Web — A modern tribute to{" "}
            <span className="text-notator-text-muted">Notator SL</span> by
            C-Lab/eMagic for the Atari ST
          </p>
          <p className="text-[10px]">
            Built with Next.js, React 19, Tailwind CSS 4
          </p>
        </div>
      </footer>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  );
}
