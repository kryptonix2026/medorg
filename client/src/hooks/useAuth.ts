import { useState, useEffect, useCallback } from "react";
import { getToken, setToken, clearToken, getUser, setUser } from "../services/api";

export function useAuth() {
  const [token, setTokenState] = useState<string | null>(getToken());
  const [user, setUserState] = useState<any>(getUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setTokenState(getToken());
    setUserState(getUser());
    setLoading(false);
  }, []);

  const login = useCallback((newToken: string, newUser: any) => {
    setToken(newToken);
    setUser(newUser);
    setTokenState(newToken);
    setUserState(newUser);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUserState(null);
  }, []);

  const isAuthenticated = !!token;

  return {
    token,
    user,
    loading,
    isAuthenticated,
    login,
    logout,
  };
}