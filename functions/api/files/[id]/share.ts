/**
 * File sharing API
 *
 * POST /api/files/:id/share — generate share link
 * GET  /api/files/shared/:token — access shared file (public, no auth)
 */

import { generateId } from "../../../lib/auth";
import type { Env, UserRecord, UserFileRecord } from "../../../lib/types";
import { jsonResponse, errorResponse } from "../../../lib/types";

// POST /api/files/:id/share — toggle sharing and get share link
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const user = context.data.user as UserRecord | null;
  const fileId = params.id as string;

  if (!user) {
    return errorResponse("Authentication required", 401);
  }

  const file = await env.DB.prepare(
    "SELECT * FROM user_files WHERE id = ? AND user_id = ?"
  )
    .bind(fileId, user.id)
    .first<UserFileRecord>();

  if (!file) {
    return errorResponse("File not found", 404);
  }

  if (file.is_shared && file.share_token) {
    // Unshare
    await env.DB.prepare(
      "UPDATE user_files SET is_shared = 0, share_token = NULL WHERE id = ?"
    )
      .bind(fileId)
      .run();
    return jsonResponse({ shared: false });
  }

  // Share — generate token
  const token = generateId();
  await env.DB.prepare(
    "UPDATE user_files SET is_shared = 1, share_token = ? WHERE id = ?"
  )
    .bind(token, fileId)
    .run();

  return jsonResponse({
    shared: true,
    shareUrl: `https://notator.online/shared/${token}`,
    token,
  });
};
