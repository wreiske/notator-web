/**
 * User profiles API
 *
 * GET   /api/users/:id — public profile + published songs
 * PATCH /api/users/:id — update own profile (auth required)
 */

import type { Env, UserRecord, UpdateProfileBody } from "../../lib/types";
import { jsonResponse, errorResponse } from "../../lib/types";

// ─── GET /api/users/:id ───

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const userId = params.id as string;

  const user = await env.DB.prepare(
    "SELECT id, display_name, bio, avatar_url, created_at FROM users WHERE id = ?",
  )
    .bind(userId)
    .first();

  if (!user) {
    return errorResponse("User not found", 404);
  }

  // Get user's public songs
  const { results: songs } = await env.DB.prepare(
    `
    SELECT s.*,
      COALESCE(AVG(r.score), 0) as avg_rating,
      COUNT(DISTINCT r.user_id) as rating_count,
      COUNT(DISTINCT l.user_id) as like_count
    FROM songs s
    LEFT JOIN ratings r ON s.id = r.song_id
    LEFT JOIN likes l ON s.id = l.song_id
    WHERE s.user_id = ? AND s.is_public = 1
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `,
  )
    .bind(userId)
    .all();

  // Get stats
  const stats = await env.DB.prepare(
    `
    SELECT
      COUNT(*) as song_count,
      COALESCE(SUM(play_count), 0) as total_plays
    FROM songs WHERE user_id = ? AND is_public = 1
  `,
  )
    .bind(userId)
    .first<{ song_count: number; total_plays: number }>();

  return jsonResponse({
    user,
    songs,
    stats: {
      songCount: stats?.song_count || 0,
      totalPlays: stats?.total_plays || 0,
    },
  });
};

// ─── PATCH /api/users/:id ───

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const { env, params, request } = context;
  const currentUser = context.data.user as UserRecord | null;
  const userId = params.id as string;

  if (!currentUser || currentUser.id !== userId) {
    return errorResponse("Not authorized", 403);
  }

  const body = (await request.json()) as UpdateProfileBody;
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.display_name !== undefined) {
    const name = body.display_name.trim();
    if (name.length === 0 || name.length > 50) {
      return errorResponse("Display name must be 1-50 characters", 400);
    }
    updates.push("display_name = ?");
    values.push(name);
  }

  if (body.bio !== undefined) {
    if (body.bio.length > 500) {
      return errorResponse("Bio must be under 500 characters", 400);
    }
    updates.push("bio = ?");
    values.push(body.bio.trim() || null);
  }

  if (updates.length === 0) {
    return errorResponse("No fields to update", 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(userId);

  await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await env.DB.prepare(
    "SELECT id, display_name, bio, avatar_url, created_at, updated_at FROM users WHERE id = ?",
  )
    .bind(userId)
    .first();

  return jsonResponse({ user: updated });
};
