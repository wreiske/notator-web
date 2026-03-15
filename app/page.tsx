import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-notator-bg-deep font-mono">
      {/* Hero section */}
      <main className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="max-w-2xl text-center">
          {/* Logo / Branding */}
          <div className="mb-8 inline-flex items-center gap-3 rounded border border-notator-border-bright bg-notator-surface px-6 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-notator-highlight/20 text-2xl">
              🎹
            </div>
            <div className="text-left">
              <h1 className="text-lg font-bold tracking-tight text-notator-text">
                Notator Web
              </h1>
              <p className="text-[10px] uppercase tracking-widest text-notator-text-dim">
                v0.1.0 — Phase 1
              </p>
            </div>
          </div>

          {/* Tagline */}
          <h2 className="mb-4 text-4xl font-bold tracking-tight text-notator-text sm:text-5xl">
            The Atari ST Sequencer,{" "}
            <span className="text-notator-accent">
              in your browser
            </span>
          </h2>

          <p className="mx-auto mb-8 max-w-lg text-base text-notator-text-muted">
            Play and explore Notator SL{" "}
            <code className="rounded border border-notator-border bg-notator-surface px-1.5 py-0.5 text-sm text-notator-accent">
              .SON
            </code>{" "}
            files directly in your browser using Web MIDI and Web Audio.
          </p>

          {/* CTA */}
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/player"
              className="notator-btn inline-flex h-12 items-center justify-center gap-2 rounded border-notator-accent bg-notator-accent px-8 text-base text-white transition-all hover:bg-notator-accent-hover hover:scale-105 active:scale-95"
              id="cta-open-player"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                <path d="M5 3.5L14.5 9L5 14.5V3.5Z" />
              </svg>
              START
            </Link>
            <a
              href="https://github.com/wreiske/notator"
              target="_blank"
              rel="noopener noreferrer"
              className="notator-btn inline-flex h-12 items-center justify-center gap-2 rounded border-notator-border px-8 text-base text-notator-text-muted transition-colors hover:border-notator-accent hover:text-notator-text"
              id="cta-github"
            >
              GitHub
            </a>
          </div>
        </div>

        {/* Feature cards */}
        <div className="mt-16 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
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
              icon: "⚡",
              title: "Fully Static",
              desc: "No server needed. Runs entirely in your browser — perfect for offline use.",
            },
          ].map(({ icon, title, desc }) => (
            <div
              key={title}
              className="rounded border border-notator-border bg-notator-surface p-5 transition-colors hover:border-notator-border-bright"
            >
              <div className="mb-3 text-2xl">{icon}</div>
              <h3 className="mb-1 text-sm font-bold text-notator-text">
                {title}
              </h3>
              <p className="text-[11px] leading-relaxed text-notator-text-dim">
                {desc}
              </p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-notator-border py-6 text-center text-[10px] text-notator-text-dim">
        <p>
          Notator Web — A modern tribute to{" "}
          <span className="text-notator-text-muted">Notator SL</span> by
          C-Lab/eMagic for the Atari ST
        </p>
        <p className="mt-1">
          Phase 1: Playback Only · Built with Next.js, React 19, Tailwind CSS 4
        </p>
      </footer>
    </div>
  );
}
