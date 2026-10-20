import { query } from "./_generated/server.js";
import { getAuthUserId } from "@convex-dev/auth/server";

export const getIdentity = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { status: "anonymous" };
    }
    const user = await ctx.db.get(userId);
    return { status: "authenticated", userId, user };
  },
});
