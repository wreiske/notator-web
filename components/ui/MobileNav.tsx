"use client";

/**
 * MobileNav — Shared responsive navigation for marketing pages
 *
 * - Desktop (≥640px): Inline links
 * - Mobile (<640px): Hamburger drawer
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthContext";
import { UserMenu } from "@/components/auth/UserMenu";

interface MobileNavProps {
  onLoginClick: () => void;
  /** Active page for highlight */
  activePage?: "home" | "player" | "community" | "files";
}

export function MobileNav({ onLoginClick, activePage }: MobileNavProps) {
  const { isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  // Close on escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    if (isOpen) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen]);

  // Prevent body scroll when menu open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const navLinks = [
    { href: "/player", label: "Player", icon: "▶", page: "player" as const },
    {
      href: "/community",
      label: "Community",
      icon: "🎵",
      page: "community" as const,
    },
    ...(isAuthenticated
      ? [
          {
            href: "/files",
            label: "My Files",
            icon: "📁",
            page: "files" as const,
          },
        ]
      : []),
    {
      href: "https://github.com/wreiske/notator",
      label: "GitHub",
      icon: "⌨",
      page: undefined,
      external: true,
    },
  ];

  return (
    <nav className="border-b border-notator-border bg-notator-surface/50 px-4 py-2 sm:px-6">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl">🎹</span>
          <span className="text-sm font-bold text-notator-text">
            Notator Online
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-4 sm:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-xs transition-colors hover:text-notator-accent ${
                activePage === link.page
                  ? "text-notator-accent"
                  : "text-notator-text-dim"
              }`}
              {...(link.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {link.label}
            </Link>
          ))}
          <UserMenu onLoginClick={onLoginClick} />
        </div>

        {/* Mobile hamburger */}
        <div className="flex items-center gap-3 sm:hidden">
          <UserMenu onLoginClick={onLoginClick} />
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex h-10 w-10 items-center justify-center rounded border border-notator-border text-notator-text-dim transition-colors hover:border-notator-accent hover:text-notator-text"
            aria-label="Toggle menu"
            id="mobile-menu-toggle"
          >
            {isOpen ? (
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M5.293 5.293a1 1 0 011.414 0L10 8.586l3.293-3.293a1 1 0 111.414 1.414L11.414 10l3.293 3.293a1 1 0 01-1.414 1.414L10 11.414l-3.293 3.293a1 1 0 01-1.414-1.414L8.586 10 5.293 6.707a1 1 0 010-1.414z" />
              </svg>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M3 5h14a1 1 0 110 2H3a1 1 0 010-2zm0 4h14a1 1 0 110 2H3a1 1 0 010-2zm0 4h14a1 1 0 110 2H3a1 1 0 010-2z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 sm:hidden"
            onClick={() => setIsOpen(false)}
          />
          {/* Drawer */}
          <div
            className="fixed inset-x-0 top-[45px] z-50 border-b border-notator-border bg-notator-panel p-4 sm:hidden"
            style={{ animation: "notator-fade-in 0.15s ease" }}
          >
            <div className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className={`flex items-center gap-3 rounded px-4 py-3 text-sm font-bold transition-colors hover:bg-notator-surface-hover ${
                    activePage === link.page
                      ? "bg-notator-accent/10 text-notator-accent"
                      : "text-notator-text-muted"
                  }`}
                  {...(link.external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  <span className="text-base">{link.icon}</span>
                  {link.label}
                </Link>
              ))}

              {!isAuthenticated && (
                <>
                  <div className="my-2 h-px bg-notator-border" />
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      onLoginClick();
                    }}
                    className="notator-btn flex items-center justify-center gap-2 rounded border-notator-accent bg-notator-accent px-4 py-3 text-sm text-white transition-all hover:bg-notator-accent-hover"
                    id="mobile-nav-signin"
                  >
                    ✨ Sign In / Register
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
