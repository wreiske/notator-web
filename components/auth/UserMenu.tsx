"use client";

/**
 * UserMenu — Dropdown menu showing logged-in user info and navigation links
 */

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import Link from "next/link";

interface UserMenuProps {
  onLoginClick: () => void;
}

export function UserMenu({ onLoginClick }: UserMenuProps) {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  if (isLoading) {
    return (
      <div className="h-7 w-7 animate-pulse rounded-full bg-notator-surface" />
    );
  }

  if (!isAuthenticated) {
    return (
      <button
        onClick={onLoginClick}
        className="notator-btn rounded border-notator-border px-3 py-1 text-[10px] text-notator-text-muted transition-colors hover:border-notator-accent hover:text-notator-text"
        id="login-trigger-btn"
      >
        Sign In
      </button>
    );
  }

  const initials = (user?.display_name || user?.email || "?")
    .substring(0, 2)
    .toUpperCase();

  return (
    <div ref={menuRef} className="relative" id="user-menu">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-notator-border bg-notator-accent/20 text-[10px] font-bold text-notator-accent transition-colors hover:bg-notator-accent/30"
        id="user-menu-trigger"
        title={user?.display_name || user?.email || "Account"}
      >
        {initials}
      </button>

      {isOpen && (
        <div
          className="notator-menu-dropdown"
          style={{ right: 0, left: "auto", minWidth: 220 }}
        >
          {/* User info */}
          <div className="border-b border-notator-border px-4 py-3">
            <div className="text-xs font-bold text-notator-text">
              {user?.display_name || "Notator User"}
            </div>
            <div className="text-[10px] text-notator-text-dim">
              {user?.email}
            </div>
          </div>

          {/* Menu items */}
          <Link
            href={`/profile?id=${user?.id}`}
            className="notator-menu-item"
            onClick={() => setIsOpen(false)}
            id="user-menu-profile"
          >
            <span className="mr-2">👤</span> My Profile
          </Link>
          <Link
            href="/files"
            className="notator-menu-item"
            onClick={() => setIsOpen(false)}
            id="user-menu-files"
          >
            <span className="mr-2">📁</span> My Files
          </Link>
          <Link
            href="/community"
            className="notator-menu-item"
            onClick={() => setIsOpen(false)}
            id="user-menu-community"
          >
            <span className="mr-2">🎵</span> Community
          </Link>

          <div className="notator-menu-separator" />

          <button
            className="notator-menu-item text-notator-red"
            onClick={() => {
              logout();
              setIsOpen(false);
            }}
            id="user-menu-logout"
          >
            <span className="mr-2">🚪</span> Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
