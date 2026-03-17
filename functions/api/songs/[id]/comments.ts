/**
 * Comments API for a song
 *
 * GET  /api/songs/:id/comments — list comments
 * POST /api/songs/:id/comments — add comment (auth required)
 */

import { generateId } from "../../../lib/auth";
import type { Env, UserRecord, CommentRecord } from "../../../lib/types";
import { jsonResponse, errorResponse } from "../../../lib/types";

// ─── GET ───

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const songId = params.id as string;

  const { results } = await env.DB.prepare(
    `
    SELECT c.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.song_id = ?
    ORDER BY c.created_at DESC
  `,
  )
    .bind(songId)
    .all();

  return jsonResponse({ comments: results });
};

// ─── POST ───

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, params, request } = context;
  const user = context.data.user as UserRecord | null;
  const songId = params.id as string;

  if (!user) {
    return errorResponse("Authentication required", 401);
  }

  const body = (await request.json()) as { body?: string };
  const text = body.body?.trim();

  if (!text || text.length === 0) {
    return errorResponse("Comment body is required", 400);
  }

  if (text.length > 2000) {
    return errorResponse("Comment must be under 2000 characters", 400);
  }

  // Verify song exists
  const song = await env.DB.prepare("SELECT id FROM songs WHERE id = ?")
    .bind(songId)
    .first();

  if (!song) {
    return errorResponse("Song not found", 404);
  }

  const commentId = generateId();
  await env.DB.prepare(
    "INSERT INTO comments (id, song_id, user_id, body) VALUES (?, ?, ?, ?)",
  )
    .bind(commentId, songId, user.id, text)
    .run();

  const comment = await env.DB.prepare(
    `
    SELECT c.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `,
  )
    .bind(commentId)
    .first();

  return jsonResponse({ comment }, 201);
};
