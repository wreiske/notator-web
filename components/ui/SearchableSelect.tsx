"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type KeyboardEvent,
} from "react";

export interface SearchableSelectOption {
  value: number;
  label: string;
  group?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  id?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
  id,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Current selected option label
  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  // Filter options by search
  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.group?.toLowerCase().includes(q) ||
        String(o.value).includes(q),
    );
  }, [options, search]);

  // Group filtered results
  const grouped = useMemo(() => {
    const groups: { group: string; items: SearchableSelectOption[] }[] = [];
    const groupMap = new Map<string, SearchableSelectOption[]>();

    for (const opt of filtered) {
      const g = opt.group ?? "";
      if (!groupMap.has(g)) {
        groupMap.set(g, []);
      }
      groupMap.get(g)!.push(opt);
    }

    for (const [group, items] of groupMap) {
      groups.push({ group, items });
    }
    return groups;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatFiltered = useMemo(() => filtered, [filtered]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-idx="${highlightIndex}"]`,
    ) as HTMLElement;
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex]);

  const open = useCallback(() => {
    setIsOpen(true);
    setSearch("");
    setHighlightIndex(-1);
    // Focus input after render
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const selectOption = useCallback(
    (opt: SearchableSelectOption) => {
      onChange(opt.value);
      setIsOpen(false);
      setSearch("");
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          open();
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((prev) =>
            Math.min(prev + 1, flatFiltered.length - 1),
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < flatFiltered.length) {
            selectOption(flatFiltered[highlightIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          setSearch("");
          break;
      }
    },
    [isOpen, open, highlightIndex, flatFiltered, selectOption],
  );

  return (
    <div className="searchable-select" ref={containerRef} id={id}>
      {/* Trigger / display button */}
      {!isOpen ? (
        <button
          type="button"
          className="searchable-select-trigger"
          onClick={open}
          onKeyDown={handleKeyDown}
          title={selectedOption?.label}
        >
          <span className="searchable-select-trigger-label">
            {selectedOption
              ? `${selectedOption.value}. ${selectedOption.label}`
              : placeholder}
          </span>
          <span className="searchable-select-trigger-arrow">▾</span>
        </button>
      ) : (
        <div className="searchable-select-input-wrap">
          <input
            ref={inputRef}
            type="text"
            className="searchable-select-input"
            placeholder={placeholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setHighlightIndex(0);
            }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {search && (
            <span className="searchable-select-count">{filtered.length}</span>
          )}
        </div>
      )}

      {/* Dropdown list */}
      {isOpen && (
        <div className="searchable-select-dropdown" ref={listRef}>
          {flatFiltered.length === 0 ? (
            <div className="searchable-select-empty">No matches</div>
          ) : (
            grouped.map(({ group, items }) => (
              <div key={group || "__ungrouped"}>
                {group && (
                  <div className="searchable-select-group">{group}</div>
                )}
                {items.map((opt) => {
                  const idx = flatFiltered.indexOf(opt);
                  const isHighlighted = idx === highlightIndex;
                  const isSelected = opt.value === value;
                  return (
                    <div
                      key={opt.value}
                      data-idx={idx}
                      className={`searchable-select-option ${isHighlighted ? "searchable-select-option-hl" : ""} ${isSelected ? "searchable-select-option-sel" : ""}`}
                      onClick={() => selectOption(opt)}
                      onMouseEnter={() => setHighlightIndex(idx)}
                    >
                      <span className="searchable-select-option-id">
                        {opt.value}
                      </span>
                      <span className="searchable-select-option-name">
                        {opt.label}
                      </span>
                      {isSelected && (
                        <span className="searchable-select-option-check">
                          ✓
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
