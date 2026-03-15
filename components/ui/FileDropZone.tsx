"use client";

import { useCallback, useRef, useState } from "react";

interface FileDropZoneProps {
  onFileLoad: (buffer: ArrayBuffer, fileName: string) => void;
}

export function FileDropZone({ onFileLoad }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith(".son")) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          onFileLoad(reader.result, file.name);
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [onFileLoad],
  );

  return (
    <div
      className={`
        group relative flex cursor-pointer flex-col items-center justify-center
        rounded border-2 border-dashed p-12 transition-all
        ${
          isDragging
            ? "border-notator-accent bg-notator-accent/10"
            : "border-notator-border hover:border-notator-border-bright hover:bg-notator-surface/50"
        }
      `}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
      onClick={() => inputRef.current?.click()}
      id="file-drop-zone"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".son,.SON"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {/* Floppy disk icon */}
      <div className="mb-3 text-3xl text-notator-text-dim group-hover:text-notator-accent transition-colors">
        💾
      </div>

      <p className="text-sm font-bold text-notator-text">
        {isDragging ? "Drop .SON file here" : "Load a .SON file"}
      </p>
      <p className="mt-1 text-[11px] text-notator-text-dim">
        Drag & drop or click to browse
      </p>
      <p className="mt-0.5 text-[10px] text-notator-text-dim/60">
        Notator SL / Creator .SON format
      </p>
    </div>
  );
}
