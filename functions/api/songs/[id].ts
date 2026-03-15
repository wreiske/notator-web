/**
 * Single song API endpoints
 *
 * GET    /api/songs/:id   — song details with author, rating, likes
 * PATCH  /api/songs/:id   — update song metadata (owner only)
 * DELETE /api/songs/:id   — delete/unpublish song (owner only)
 */

import type { Env, UserRecord, SongRecord } from "../../../lib/types";
import { jsonResponse, errorResponse } from "../../../lib/types";

// ─── GET /api/songs/:id ───

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const songId = params.id as string;
  const user = context.data.user as UserRecord | null;

  // Only return public songs, or the owner's own private songs
  const song = await env.DB.prepare(`
    SELECT s.id, s.user_id, s.title, s.description, s.year, s.tags,
      s.file_size, s.is_public, s.version, s.parent_song_id, s.play_count,
      s.created_at, s.updated_at,
      u.display_name as author_name,
      u.avatar_url as author_avatar,
      COALESCE(AVG(r.score), 0) as avg_rating,
      COUNT(DISTINCT r.user_id) as rating_count,
      COUNT(DISTINCT l.user_id) as like_count
    FROM songs s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN ratings r ON s.id = r.song_id
    LEFT JOIN likes l ON s.id = l.song_id
    WHERE s.id = ? AND (s.is_public = 1 OR s.user_id = ?)
    GROUP BY s.id
  `)
    .bind(songId, user?.id || "")
    .first();

  if (!song) {
    return errorResponse("Song not found", 404);
  }

  // Check if requesting user has liked/rated
  let userLiked = false;
  let userRating = 0;

  if (user) {
    const like = await env.DB.prepare(
      "SELECT 1 FROM likes WHERE song_id = ? AND user_id = ?"
    )
      .bind(songId, user.id)
      .first();
    userLiked = !!like;

    const rating = await env.DB.prepare(
      "SELECT score FROM ratings WHERE song_id = ? AND user_id = ?"
    )
      .bind(songId, user.id)
      .first<{ score: number }>();
    userRating = rating?.score || 0;
  }

  // Increment play count (only for public songs, not the owner viewing their own)
  if ((song as Record<string, unknown>).is_public === 1 && user?.id !== (song as Record<string, unknown>).user_id) {
    await env.DB.prepare(
      "UPDATE songs SET play_count = play_count + 1 WHERE id = ?"
    )
      .bind(songId)
      .run();
  }

  return jsonResponse({ song, userLiked, userRating });
};

// ─── PATCH /api/songs/:id ───

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const { env, params, request } = context;
  const user = context.data.user as UserRecord | null;
  const songId = params.id as string;

  if (!user) {
    return errorResponse("Authentication required", 401);
  }

  // Verify ownership
  const song = await env.DB.prepare(
    "SELECT * FROM songs WHERE id = ? AND user_id = ?"
  )
    .bind(songId, user.id)
    .first<SongRecord>();

  if (!song) {
    return errorResponse("Song not found or not authorized", 404);
  }

  const body = await request.json() as Partial<{
    title: string;
    description: string;
    year: string;
    tags: string[];
    isPublic: boolean;
  }>;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) {
    const title = body.title.trim();
    if (title.length === 0 || title.length > 100) {
      return errorResponse("Title must be 1-100 characters", 400);
    }
    updates.push("title = ?");
    values.push(title);
  }
  if (body.description !== undefined) {
    if (body.description.length > 1000) {
      return errorResponse("Description must be under 1000 characters", 400);
    }
    updates.push("description = ?");
    values.push(body.description.trim() || null);
  }
  if (body.year !== undefined) {
    if (body.year && !/^\d{4}$/.test(body.year)) {
      return errorResponse("Year must be a 4-digit number", 400);
    }
    updates.push("year = ?");
    values.push(body.year || null);
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 10) {
      return errorResponse("Tags must be an array of up to 10 items", 400);
    }
    updates.push("tags = ?");
    values.push(JSON.stringify(body.tags.map(t => String(t).trim().slice(0, 30))));
  }
  if (body.isPublic !== undefined) {
    updates.push("is_public = ?");
    values.push(body.isPublic ? 1 : 0);
  }

  if (updates.length === 0) {
    return errorResponse("No fields to update", 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(songId);

  await env.DB.prepare(
    `UPDATE songs SET ${updates.join(", ")} WHERE id = ?`
  )
    .bind(...values)
    .run();

  const updated = await env.DB.prepare(
    "SELECT id, user_id, title, description, year, tags, file_size, is_public, version, parent_song_id, play_count, created_at, updated_at FROM songs WHERE id = ?"
  )
    .bind(songId)
    .first<SongRecord>();

  return jsonResponse({ song: updated });
};

// ─── DELETE /api/songs/:id ───

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const user = context.data.user as UserRecord | null;
  const songId = params.id as string;

  if (!user) {
    return errorResponse("Authentication required", 401);
  }

  const song = await env.DB.prepare(
    "SELECT * FROM songs WHERE id = ? AND user_id = ?"
  )
    .bind(songId, user.id)
    .first<SongRecord>();

  if (!song) {
    return errorResponse("Song not found or not authorized", 404);
  }

  // Delete from R2
  await env.R2.delete(song.r2_key);

  // Delete related records
  await env.DB.batch([
    env.DB.prepare("DELETE FROM comments WHERE song_id = ?").bind(songId),
    env.DB.prepare("DELETE FROM likes WHERE song_id = ?").bind(songId),
    env.DB.prepare("DELETE FROM ratings WHERE song_id = ?").bind(songId),
    env.DB.prepare("DELETE FROM songs WHERE id = ?").bind(songId),
  ]);

  return jsonResponse({ success: true });
};
