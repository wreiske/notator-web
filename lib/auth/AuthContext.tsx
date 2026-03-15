"use client";

/**
 * AuthContext — React context for authentication state
 *
 * Provides user state, login/logout methods, and session persistence via JWT.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  getToken,
  setToken,
  removeToken,
  requestOtp as apiRequestOtp,
  verifyOtp as apiVerifyOtp,
  getSession,
  type UserPublic,
} from "./api";

interface AuthContextType {
  user: UserPublic | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  requestOtp: (email: string) => Promise<{ success: boolean; message: string }>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  requestOtp: async () => ({ success: false, message: "" }),
  verifyOtp: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check existing session on mount
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

    getSession()
      .then((data) => {
        setUser(data.user);
      })
      .catch(() => {
        // Invalid token
        removeToken();
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const requestOtp = useCallback(async (email: string) => {
    return apiRequestOtp(email);
  }, []);

  const verifyOtp = useCallback(async (email: string, code: string) => {
    const data = await apiVerifyOtp(email, code);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    removeToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        requestOtp,
        verifyOtp,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
