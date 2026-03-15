"use client";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

const CREDITS = [
  {
    name: "Notator SL",
    desc: "C-Lab / eMagic (Gerhard Lengeling)",
  },
  {
    name: "son2midi",
    desc: "Simon Cozens",
    url: "https://github.com/simoncozens/son2midi",
  },
  {
    name: "WebAudioFont",
    desc: "Sergey Surikov",
    url: "https://github.com/surikov/webaudiofont",
  },
  {
    name: "RetroGhidra",
    desc: "Andrew Dunstan",
    url: "https://github.com/hippietrail/RetroGhidra",
  },
  {
    name: "Atari ST Community",
    desc: "For preserving these files",
  },
];

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  if (!open) return null;

  return (
    <div
      className="notator-dialog-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="About Notator Web"
    >
      <div
        className="notator-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar — GEM style */}
        <div className="notator-dialog-titlebar">
          <span className="flex-1 text-center font-bold tracking-wider">
            About Notator Web
          </span>
          <button
            onClick={onClose}
            className="notator-dialog-close"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 text-[11px]">
          {/* Branding */}
          <div className="text-center space-y-1">
            <div className="text-lg font-bold tracking-[0.2em] text-notator-text">
              N O T A T O R
            </div>
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm font-bold text-notator-accent">3.21</span>
              <span className="text-notator-text-dim">web</span>
            </div>
            <div className="text-[10px] text-notator-text-muted mt-2">
              The Atari ST Sequencer, in your browser
            </div>
          </div>

          {/* Separator */}
          <div className="notator-menu-separator" />

          {/* Created by */}
          <div className="text-center">
            <div className="text-[10px] text-notator-text-dim uppercase tracking-widest mb-1">
              Created by
            </div>
            <div className="text-sm font-bold text-notator-text">
              William Reiske
            </div>
          </div>

          {/* Separator */}
          <div className="notator-menu-separator" />

          {/* Credits */}
          <div>
            <div className="text-[10px] text-notator-text-dim uppercase tracking-widest mb-2">
              Credits & Acknowledgments
            </div>
            <div className="space-y-1.5">
              {CREDITS.map((credit) => (
                <div key={credit.name} className="flex items-start gap-2">
                  <span className="text-notator-accent mt-0.5">▸</span>
                  <div>
                    {credit.url ? (
                      <a
                        href={credit.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-notator-accent hover:text-notator-accent-hover transition-colors"
                      >
                        {credit.name}
                      </a>
                    ) : (
                      <span className="font-bold text-notator-text">{credit.name}</span>
                    )}
                    <span className="text-notator-text-muted"> — {credit.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Separator */}
          <div className="notator-menu-separator" />

          {/* Links */}
          <div className="flex items-center justify-center gap-4 text-[10px]">
            <a
              href="https://github.com/wreiske/notator-web"
              target="_blank"
              rel="noopener noreferrer"
              className="text-notator-accent hover:text-notator-accent-hover transition-colors"
            >
              GitHub ↗
            </a>
            <span className="text-notator-border">│</span>
            <span className="text-notator-text-dim">MIT License</span>
            <span className="text-notator-border">│</span>
            <span className="text-notator-text-dim">v0.1.0</span>
          </div>
        </div>

        {/* Bottom button — close */}
        <div className="border-t border-notator-border px-5 py-3 flex justify-center">
          <button
            onClick={onClose}
            className="notator-btn rounded px-6 py-1 text-[11px] border-notator-border text-notator-text-muted hover:border-notator-accent hover:text-notator-accent"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
