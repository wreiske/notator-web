/**
 * User files API (private drive)
 *
 * GET    /api/files         — list user's files (auth required)
 * POST   /api/files         — upload file to R2 (auth required)
 * DELETE /api/files/:id     — delete file (auth required, via query param)
 */

import { generateId } from "../../lib/auth";
import type { Env, UserRecord, UserFileRecord } from "../../lib/types";
import { jsonResponse, errorResponse } from "../../lib/types";

// ─── GET /api/files ───

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const user = context.data.user as UserRecord | null;

  if (!user) {
    return errorResponse("Authentication required", 401);
  }

  const url = new URL(request.url);
  const folder = url.searchParams.get("folder") || "/";

  const { results } = await env.DB.prepare(
    "SELECT * FROM user_files WHERE user_id = ? AND folder = ? ORDER BY filename ASC"
  )
    .bind(user.id, folder)
    .all<UserFileRecord>();

  // Get all distinct folders for navigation
  const { results: folders } = await env.DB.prepare(
    "SELECT DISTINCT folder FROM user_files WHERE user_id = ? ORDER BY folder ASC"
  )
    .bind(user.id)
    .all<{ folder: string }>();

  return jsonResponse({ files: results, folders: folders.map((f) => f.folder) });
};

// ─── POST /api/files ───

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const user = context.data.user as UserRecord | null;

  if (!user) {
    return errorResponse("Authentication required", 401);
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const folder = (formData.get("folder") as string) || "/";

  if (!file) {
    return errorResponse("A file is required", 400);
  }

  // 10MB limit
  if (file.size > 10 * 1024 * 1024) {
    return errorResponse("File size must be under 10MB", 400);
  }

  const fileId = generateId();
  const r2Key = `files/${user.id}/${fileId}/${file.name}`;

  // Upload to R2
  await env.R2.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { originalName: file.name, userId: user.id },
  });

  // Store record
  await env.DB.prepare(
    "INSERT INTO user_files (id, user_id, filename, folder, r2_key, file_size) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(fileId, user.id, file.name, folder, r2Key, file.size)
    .run();

  const record = await env.DB.prepare(
    "SELECT * FROM user_files WHERE id = ?"
  )
    .bind(fileId)
    .first<UserFileRecord>();

  return jsonResponse({ file: record }, 201);
};

// ─── DELETE /api/files (with ?id=...) ───

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const user = context.data.user as UserRecord | null;

  if (!user) {
    return errorResponse("Authentication required", 401);
  }

  const url = new URL(request.url);
  const fileId = url.searchParams.get("id");

  if (!fileId) {
    return errorResponse("File ID is required", 400);
  }

  const file = await env.DB.prepare(
    "SELECT * FROM user_files WHERE id = ? AND user_id = ?"
  )
    .bind(fileId, user.id)
    .first<UserFileRecord>();

  if (!file) {
    return errorResponse("File not found", 404);
  }

  // Delete from R2
  await env.R2.delete(file.r2_key);

  // Delete record
  await env.DB.prepare("DELETE FROM user_files WHERE id = ?")
    .bind(fileId)
    .run();

  return jsonResponse({ success: true });
};
