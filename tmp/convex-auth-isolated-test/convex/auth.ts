import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { Google } from "@convex-dev/auth/providers/Google";
import { DataModel } from "./_generated/dataModel.js";

const CustomPassword = Password<DataModel>({
  profile(params) {
    const rawUsername = (params.name as string) || (params.username as string) || "user";
    const normalizedUsername = rawUsername.trim().toLowerCase();
    
    return {
      email: `${normalizedUsername}@local.auth`,
      name: rawUsername.trim(),
    };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    CustomPassword,
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
});
