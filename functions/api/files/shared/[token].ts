/**
 * Shared file access (public)
 *
 * GET /api/files/shared/:token — download a shared file (no auth required)
 */

import type { Env, UserFileRecord } from "../../../lib/types";
import { errorResponse } from "../../../lib/types";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const token = params.token as string;

  const file = await env.DB.prepare(
    "SELECT * FROM user_files WHERE share_token = ? AND is_shared = 1"
  )
    .bind(token)
    .first<UserFileRecord>();

  if (!file) {
    return errorResponse("Shared file not found or no longer shared", 404);
  }

  const object = await env.R2.get(file.r2_key);
  if (!object) {
    return errorResponse("File not found in storage", 404);
  }

  const safeFilename = file.filename.replace(/["\r\n\x00-\x1f]/g, "_");

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(object.size),
    },
  });
};
