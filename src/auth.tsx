import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { ConvexReactClient } from 'convex/react';

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthUser | null;
  login: (idToken: string) => void;
  logout: () => void;
  isGoogleLoaded: boolean;
  googleClientId: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

function parseJwt(token: string): AuthUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const parsed = JSON.parse(jsonPayload);
    if (!parsed || typeof parsed.sub !== 'string') return null;
    return {
      sub: parsed.sub,
      email: parsed.email,
      name: parsed.name,
      picture: parsed.picture,
    };
  } catch {
    return null;
  }
}

interface AuthProviderProps {
  children: React.ReactNode;
  convex: ConvexReactClient;
  googleClientId: string;
}

export function AuthProvider({ children, convex, googleClientId }: AuthProviderProps) {
  // El ID Token se mantiene estrictamente en memoria (useState), nunca en localStorage ni logs
  const [idToken, setIdToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isGoogleLoaded, setIsGoogleLoaded] = useState<boolean>(false);

  // Sincronización del token con el cliente Convex
  useEffect(() => {
    if (idToken) {
      convex.setAuth(async () => idToken);
    } else {
      convex.setAuth(async () => null);
    }
  }, [idToken, convex]);

  // Detección de la carga de Google Identity Services
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).google?.accounts?.id) {
      setIsGoogleLoaded(true);
      return;
    }

    const interval = setInterval(() => {
      if (typeof window !== 'undefined' && (window as any).google?.accounts?.id) {
        setIsGoogleLoaded(true);
        clearInterval(interval);
      }
    }, 200);

    const timeout = setTimeout(() => {
      clearInterval(interval);
    }, 10000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);

  const login = useCallback((credential: string) => {
    if (!credential || typeof credential !== 'string') return;
    const profile = parseJwt(credential);
    if (profile) {
      setIdToken(credential);
      setUser(profile);
    }
  }, []);

  const logout = useCallback(() => {
    setIdToken(null);
    setUser(null);
    if (typeof window !== 'undefined' && (window as any).google?.accounts?.id?.disableAutoSelect) {
      (window as any).google.accounts.id.disableAutoSelect();
    }
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      isAuthenticated: !!user && !!idToken,
      user,
      login,
      logout,
      isGoogleLoaded,
      googleClientId,
    }),
    [user, idToken, login, logout, isGoogleLoaded, googleClientId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe utilizarse dentro de un AuthProvider');
  }
  return context;
}
