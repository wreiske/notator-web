/**
 * Rating API
 *
 * POST /api/songs/:id/rate — submit or update rating 1-5 (auth required)
 */

import type { Env, UserRecord } from "../../../lib/types";
import { jsonResponse, errorResponse } from "../../../lib/types";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, params, request } = context;
  const user = context.data.user as UserRecord | null;
  const songId = params.id as string;

  if (!user) {
    return errorResponse("Authentication required", 401);
  }

  const body = await request.json() as { score?: number };
  const score = body.score;

  if (!score || !Number.isInteger(score) || score < 1 || score > 5) {
    return errorResponse("Score must be an integer between 1 and 5", 400);
  }

  // Upsert rating
  const existing = await env.DB.prepare(
    "SELECT 1 FROM ratings WHERE song_id = ? AND user_id = ?"
  )
    .bind(songId, user.id)
    .first();

  if (existing) {
    await env.DB.prepare(
      "UPDATE ratings SET score = ? WHERE song_id = ? AND user_id = ?"
    )
      .bind(score, songId, user.id)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT INTO ratings (song_id, user_id, score) VALUES (?, ?, ?)"
    )
      .bind(songId, user.id, score)
      .run();
  }

  // Get updated average
  const avg = await env.DB.prepare(
    "SELECT AVG(score) as avg_rating, COUNT(*) as count FROM ratings WHERE song_id = ?"
  )
    .bind(songId)
    .first<{ avg_rating: number; count: number }>();

  return jsonResponse({
    userRating: score,
    avgRating: Math.round((avg?.avg_rating || 0) * 10) / 10,
    ratingCount: avg?.count || 0,
  });
};
