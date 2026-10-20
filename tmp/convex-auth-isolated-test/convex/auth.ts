import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { DataModel } from "./_generated/dataModel.js";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      profile(params) {
        const username = (params.username as string) || (params.email as string)?.split("@")[0] || "user";
        const normalizedUsername = username.trim().toLowerCase();
        // Use a synthetic internal email to satisfy Password provider schema requirements without needing real email
        const syntheticEmail = `${normalizedUsername}@local.conquista.game`;
        return {
          email: syntheticEmail,
          name: username.trim(),
          username: normalizedUsername,
        };
      },
    }),
  ],
});
