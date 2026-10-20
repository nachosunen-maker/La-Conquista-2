import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";

export function AuthProvider({ children, convex }: { children: React.ReactNode, convex: ConvexReactClient }) {
  return (
    <ConvexAuthProvider client={convex}>
      {children}
    </ConvexAuthProvider>
  );
}

// Re-export hook if needed, or update consumers to use useAuthActions from @convex-dev/auth/react
export { useAuthActions } from "@convex-dev/auth/react";
export { useConvexAuth } from "@convex-dev/auth/react";
