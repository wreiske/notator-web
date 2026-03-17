/**
 * Song API endpoints
 *
 * GET  /api/songs         — list public songs (pagination, sort, filter)
 * POST /api/songs         — publish a song (auth required, JSON + file upload)
 */

import { generateId } from "../../lib/auth";
import type {
  Env,
  UserRecord,
  SongRecord,
  PublishSongBody,
} from "../../lib/types";
import { jsonResponse, errorResponse } from "../../lib/types";

const MAX_SONG_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = [".son"];

function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n\x00-\x1f]/g, "_");
}

function escapeLike(str: string): string {
  return str.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// ─── GET /api/songs ───

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);

  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get("limit") || "20")),
  );
  const sort = url.searchParams.get("sort") || "newest";
  const tag = url.searchParams.get("tag");
  const search = url.searchParams.get("q");
  const offset = (page - 1) * limit;

  // Use explicit column list to avoid leaking internal fields like r2_key
  let query = `
    SELECT s.id, s.user_id, s.title, s.description, s.year, s.tags,
      s.file_size, s.is_public, s.version, s.play_count, s.created_at, s.updated_at,
      u.display_name as author_name,
      u.avatar_url as author_avatar,
      COALESCE(AVG(r.score), 0) as avg_rating,
      COUNT(DISTINCT r.user_id) as rating_count,
      COUNT(DISTINCT l.user_id) as like_count
    FROM songs s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN ratings r ON s.id = r.song_id
    LEFT JOIN likes l ON s.id = l.song_id
    WHERE s.is_public = 1
  `;
  const params: unknown[] = [];

  if (tag) {
    query += " AND s.tags LIKE ?";
    params.push(`%${escapeLike(tag)}%`);
  }

  if (search) {
    const safeSearch = escapeLike(search);
    query += " AND (s.title LIKE ? OR s.description LIKE ?)";
    params.push(`%${safeSearch}%`, `%${safeSearch}%`);
  }

  query += " GROUP BY s.id";

  // Sorting — use allowlist to prevent injection
  switch (sort) {
    case "top-rated":
      query += " ORDER BY avg_rating DESC, s.created_at DESC";
      break;
    case "most-liked":
      query += " ORDER BY like_count DESC, s.created_at DESC";
      break;
    case "most-played":
      query += " ORDER BY s.play_count DESC, s.created_at DESC";
      break;
    default: // newest
      query += " ORDER BY s.created_at DESC";
  }

  query += " LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const { results } = await env.DB.prepare(query)
    .bind(...params)
    .all();

  // Get total count
  let countQuery = "SELECT COUNT(*) as total FROM songs WHERE is_public = 1";
  const countParams: unknown[] = [];
  if (tag) {
    countQuery += " AND tags LIKE ?";
    countParams.push(`%${escapeLike(tag)}%`);
  }
  if (search) {
    const safeSearch = escapeLike(search);
    countQuery += " AND (title LIKE ? OR description LIKE ?)";
    countParams.push(`%${safeSearch}%`, `%${safeSearch}%`);
  }

  const countResult = await env.DB.prepare(countQuery)
    .bind(...countParams)
    .first<{ total: number }>();

  return jsonResponse({
    songs: results,
    pagination: {
      page,
      limit,
      total: countResult?.total || 0,
      totalPages: Math.ceil((countResult?.total || 0) / limit),
    },
  });
};

// ─── POST /api/songs ───

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const user = context.data.user as UserRecord | null;

  if (!user) {
    return errorResponse("Authentication required", 401);
  }

  // Expect multipart/form-data with "file" and "metadata" fields
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return errorResponse("Expected multipart/form-data", 400);
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const metadataStr = formData.get("metadata") as string | null;

  if (!file) {
    return errorResponse("A .SON file is required", 400);
  }

  // Validate file size
  if (file.size > MAX_SONG_FILE_SIZE) {
    return errorResponse("File size must be under 10MB", 400);
  }

  // Validate file extension
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return errorResponse("Only .SON files are accepted", 400);
  }

  let metadata: PublishSongBody;
  try {
    metadata = metadataStr ? JSON.parse(metadataStr) : {};
  } catch {
    return errorResponse("Invalid metadata JSON", 400);
  }

  if (!metadata.title?.trim()) {
    return errorResponse("Song title is required", 400);
  }

  if (metadata.title.trim().length > 100) {
    return errorResponse("Song title must be under 100 characters", 400);
  }

  if (metadata.description && metadata.description.length > 1000) {
    return errorResponse("Description must be under 1000 characters", 400);
  }

  if (metadata.year && !/^\d{4}$/.test(metadata.year)) {
    return errorResponse("Year must be a 4-digit number", 400);
  }

  if (
    metadata.tags &&
    (!Array.isArray(metadata.tags) || metadata.tags.length > 10)
  ) {
    return errorResponse("Tags must be an array of up to 10 items", 400);
  }

  // Upload file to R2
  const songId = generateId();
  const safeName = sanitizeFilename(file.name);
  const r2Key = `songs/${user.id}/${songId}/${safeName}`;

  await env.R2.put(r2Key, file.stream(), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { originalName: safeName, userId: user.id },
  });

  // Determine version
  let version = 1;
  if (metadata.parentSongId) {
    const parent = await env.DB.prepare(
      "SELECT version FROM songs WHERE id = ? AND user_id = ?",
    )
      .bind(metadata.parentSongId, user.id)
      .first<{ version: number }>();
    if (parent) version = parent.version + 1;
  }

  // Sanitize tags
  const sanitizedTags = metadata.tags
    ? JSON.stringify(metadata.tags.map((t) => String(t).trim().slice(0, 30)))
    : null;

  // Insert song record
  await env.DB.prepare(
    `INSERT INTO songs (id, user_id, title, description, year, tags, r2_key, file_size, is_public, version, parent_song_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      songId,
      user.id,
      metadata.title.trim().slice(0, 100),
      metadata.description?.trim().slice(0, 1000) || null,
      metadata.year || null,
      sanitizedTags,
      r2Key,
      file.size,
      metadata.isPublic !== false ? 1 : 0,
      version,
      metadata.parentSongId || null,
    )
    .run();

  const song = await env.DB.prepare(
    "SELECT id, user_id, title, description, year, tags, file_size, is_public, version, parent_song_id, play_count, created_at, updated_at FROM songs WHERE id = ?",
  )
    .bind(songId)
    .first<SongRecord>();

  return jsonResponse({ song }, 201);
};
