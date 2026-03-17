/**
 * Like toggle API
 *
 * POST /api/songs/:id/like — toggle like (auth required)
 */

import type { Env, UserRecord } from "../../../lib/types";
import { jsonResponse, errorResponse } from "../../../lib/types";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const user = context.data.user as UserRecord | null;
  const songId = params.id as string;

  if (!user) {
    return errorResponse("Authentication required", 401);
  }

  // Check if already liked
  const existing = await env.DB.prepare(
    "SELECT 1 FROM likes WHERE song_id = ? AND user_id = ?",
  )
    .bind(songId, user.id)
    .first();

  if (existing) {
    // Unlike
    await env.DB.prepare("DELETE FROM likes WHERE song_id = ? AND user_id = ?")
      .bind(songId, user.id)
      .run();
  } else {
    // Like
    await env.DB.prepare("INSERT INTO likes (song_id, user_id) VALUES (?, ?)")
      .bind(songId, user.id)
      .run();
  }

  // Get updated count
  const count = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM likes WHERE song_id = ?",
  )
    .bind(songId)
    .first<{ count: number }>();

  return jsonResponse({
    liked: !existing,
    likeCount: count?.count || 0,
  });
};
