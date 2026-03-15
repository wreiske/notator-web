"use client";

/**
 * File Manager — Drive-style interface for managing .SON files
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { LoginModal } from "@/components/auth/LoginModal";
import { UserMenu } from "@/components/auth/UserMenu";
import {
  listFiles,
  uploadFile,
  deleteFile,
  toggleFileShare,
  type FileRecord,
} from "@/lib/auth/api";
import Link from "next/link";

export default function FilesPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [currentFolder, setCurrentFolder] = useState("/");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listFiles(currentFolder);
      setFiles(data.files);
      setFolders(data.folders);
    } catch {
      // Not logged in or error
    } finally {
      setLoading(false);
    }
  }, [currentFolder]);

  useEffect(() => {
    if (isAuthenticated) loadFiles();
    else setLoading(false);
  }, [isAuthenticated, loadFiles]);

  const handleUpload = async (fileList: FileList) => {
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        await uploadFile(file, currentFolder);
      }
      await loadFiles();
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (fileId: string) => {
    if (!confirm("Delete this file?")) return;
    try {
      await deleteFile(fileId);
      await loadFiles();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleShare = async (fileId: string) => {
    try {
      const result = await toggleFileShare(fileId);
      if (result.shareUrl) {
        await navigator.clipboard.writeText(result.shareUrl);
        alert(`Share link copied to clipboard!\n${result.shareUrl}`);
      }
      await loadFiles();
    } catch (err) {
      console.error("Share failed:", err);
    }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  // Require login
  if (!isLoading && !isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-notator-bg-deep font-mono">
        <span className="text-5xl">📁</span>
        <h1 className="mt-4 text-2xl font-bold text-notator-text">My Files</h1>
        <p className="mt-2 text-sm text-notator-text-muted">
          Sign in to manage your .SON file collection
        </p>
        <button
          onClick={() => setShowLogin(true)}
          className="notator-btn mt-6 rounded border-notator-accent bg-notator-accent px-6 py-2.5 text-sm text-white hover:bg-notator-accent-hover"
          id="files-login-btn"
        >
          Sign In
        </button>
        <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
      </div>
    );
  }

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
            <h1 className="text-sm font-bold text-notator-accent">
              📁 My Files
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/community"
              className="text-[10px] text-notator-text-dim hover:text-notator-accent"
            >
              Community
            </Link>
            <Link
              href="/player"
              className="text-[10px] text-notator-text-dim hover:text-notator-accent"
            >
              Player
            </Link>
            <UserMenu onLoginClick={() => setShowLogin(true)} />
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="border-b border-notator-border bg-notator-panel px-6 py-2">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          {/* Folder breadcrumb */}
          <div className="flex-1 text-[10px] text-notator-text-dim">
            📂{" "}
            {currentFolder === "/"
              ? "Root"
              : currentFolder.split("/").filter(Boolean).join(" / ")}
          </div>

          {/* View toggle */}
          <button
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
            className="rounded border border-notator-border px-2 py-1 text-[10px] text-notator-text-dim hover:border-notator-accent"
          >
            {viewMode === "grid" ? "☰ List" : "⊞ Grid"}
          </button>

          {/* Upload button */}
          <label className="notator-btn cursor-pointer rounded border-notator-accent bg-notator-accent px-3 py-1 text-[10px] text-white hover:bg-notator-accent-hover">
            {uploading ? "Uploading..." : "📤 Upload"}
            <input
              type="file"
              accept=".son,.SON"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleUpload(e.target.files)}
              disabled={uploading}
              id="file-upload-input"
            />
          </label>
        </div>
      </div>

      {/* Drop zone + file list */}
      <main
        className={`flex-1 px-6 py-4 ${dragOver ? "ring-2 ring-inset ring-notator-accent/50" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
        }}
      >
        <div className="mx-auto max-w-6xl">
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded border border-notator-border bg-notator-surface"
                />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="py-20 text-center">
              <span className="text-5xl">📂</span>
              <h2 className="mt-4 text-lg font-bold text-notator-text">
                No files yet
              </h2>
              <p className="mt-2 text-sm text-notator-text-muted">
                Drag and drop .SON files here, or click Upload
              </p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="group rounded-lg border border-notator-border bg-notator-surface p-3 transition-all hover:border-notator-accent/50"
                  id={`file-${file.id}`}
                >
                  <div className="mb-2 text-center text-3xl">🎵</div>
                  <div className="truncate text-[11px] font-bold text-notator-text">
                    {file.filename}
                  </div>
                  <div className="text-[9px] text-notator-text-dim">
                    {formatSize(file.file_size)} · {formatDate(file.created_at)}
                  </div>
                  {file.is_shared ? (
                    <div className="mt-1 text-[9px] text-notator-green">
                      🔗 Shared
                    </div>
                  ) : null}
                  {/* Actions */}
                  <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Link
                      href={`/player?file=${file.id}`}
                      className="rounded bg-notator-accent/20 px-1.5 py-0.5 text-[9px] text-notator-accent hover:bg-notator-accent/30"
                    >
                      ▶ Play
                    </Link>
                    <button
                      onClick={() => handleShare(file.id)}
                      className="rounded bg-notator-surface-hover px-1.5 py-0.5 text-[9px] text-notator-text-dim hover:text-notator-text"
                    >
                      🔗
                    </button>
                    <button
                      onClick={() => handleDelete(file.id)}
                      className="rounded bg-notator-red/10 px-1.5 py-0.5 text-[9px] text-notator-red hover:bg-notator-red/20"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded border border-notator-border">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-notator-border bg-notator-surface text-left text-[10px] font-bold uppercase tracking-wider text-notator-text-dim">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr
                      key={file.id}
                      className="border-b border-notator-border last:border-0 hover:bg-notator-surface-hover"
                    >
                      <td className="px-3 py-2 text-notator-text">
                        🎵 {file.filename}
                      </td>
                      <td className="px-3 py-2 text-notator-text-dim">
                        {formatSize(file.file_size)}
                      </td>
                      <td className="px-3 py-2 text-notator-text-dim">
                        {formatDate(file.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        {file.is_shared ? (
                          <span className="text-notator-green">🔗 Shared</span>
                        ) : (
                          <span className="text-notator-text-dim">Private</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <Link
                            href={`/player?file=${file.id}`}
                            className="text-notator-accent hover:underline"
                          >
                            Play
                          </Link>
                          <button
                            onClick={() => handleShare(file.id)}
                            className="text-notator-text-dim hover:text-notator-accent"
                          >
                            Share
                          </button>
                          <button
                            onClick={() => handleDelete(file.id)}
                            className="text-notator-red hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Folder navigation */}
          {folders.length > 1 && (
            <div className="mt-6 border-t border-notator-border pt-4">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-notator-text-dim">
                Folders
              </h3>
              <div className="flex flex-wrap gap-2">
                {folders.map((folder) => (
                  <button
                    key={folder}
                    onClick={() => setCurrentFolder(folder)}
                    className={`rounded border px-3 py-1 text-[10px] transition-colors ${
                      currentFolder === folder
                        ? "border-notator-accent bg-notator-accent/10 text-notator-accent"
                        : "border-notator-border text-notator-text-dim hover:border-notator-accent"
                    }`}
                  >
                    📁 {folder === "/" ? "Root" : folder}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-notator-border py-4 text-center text-[10px] text-notator-text-dim">
        <p>Drag \u0026 drop .SON files to upload · 10MB max per file</p>
      </footer>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  );
}
