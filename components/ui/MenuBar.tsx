"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  /** If set, item opens this URL in a new tab */
  href?: string;
  /** Callback when clicked */
  onClick?: () => void;
  /** Render as a separator line */
  separator?: boolean;
  /** Show item as disabled/grayed out */
  disabled?: boolean;
  /** Suffix shown right-aligned (e.g. keyboard shortcut) */
  suffix?: string;
}

export interface MenuDefinition {
  label: string;
  /** Custom class for the top-level label (e.g. bold for MIDI) */
  className?: string;
  items: MenuItem[];
}

interface MenuBarProps {
  menus: MenuDefinition[];
}

// ─── Component ───────────────────────────────────────────────────

export function MenuBar({ menus }: MenuBarProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (openIndex === null) return;

    function handleClickOutside(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenIndex(null);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenIndex(null);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openIndex]);

  const handleTopClick = useCallback((idx: number) => {
    setOpenIndex((prev) => (prev === idx ? null : idx));
  }, []);

  const handleTopEnter = useCallback(
    (idx: number) => {
      // Only switch on hover if a menu is already open
      if (openIndex !== null) setOpenIndex(idx);
    },
    [openIndex]
  );

  const handleItemClick = useCallback(
    (item: MenuItem) => {
      if (item.disabled || item.separator) return;

      if (item.href) {
        window.open(item.href, "_blank", "noopener,noreferrer");
      }

      item.onClick?.();
      setOpenIndex(null);
    },
    []
  );

  return (
    <div ref={barRef} className="flex items-center gap-0 relative">
      {menus.map((menu, idx) => (
        <div key={menu.label} className="relative">
          {/* Top-level menu label */}
          <button
            className={`notator-menu-trigger ${
              openIndex === idx ? "notator-menu-trigger-active" : ""
            } ${menu.className || ""}`}
            onClick={() => handleTopClick(idx)}
            onMouseEnter={() => handleTopEnter(idx)}
            id={`menu-${menu.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {menu.label}
          </button>

          {/* Dropdown */}
          {openIndex === idx && menu.items.length > 0 && (
            <div className="notator-menu-dropdown">
              {menu.items.map((item, itemIdx) =>
                item.separator ? (
                  <div key={`sep-${itemIdx}`} className="notator-menu-separator" />
                ) : (
                  <button
                    key={item.label}
                    className={`notator-menu-item ${
                      item.disabled ? "notator-menu-item-disabled" : ""
                    }`}
                    onClick={() => handleItemClick(item)}
                    disabled={item.disabled}
                    id={`menuitem-${item.label
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/-+$/, "")}`}
                  >
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.suffix && (
                      <span className="text-notator-text-dim ml-4 text-[9px]">
                        {item.suffix}
                      </span>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
