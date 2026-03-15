/**
 * GET /api/auth/session
 *
 * Returns the current authenticated user from JWT.
 * Returns 401 if not authenticated.
 */

import type { Env, UserRecord } from "../../lib/types";
import { jsonResponse, errorResponse } from "../../lib/types";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const user = context.data.user as UserRecord | null | undefined;

  if (!user) {
    return errorResponse("Not authenticated", 401);
  }

  return jsonResponse({
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      bio: user.bio,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
    },
  });
};
