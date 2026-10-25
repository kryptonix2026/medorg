import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { getToken, clearToken } from "../services/api";
import { LiveStatusResponse } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "/api";

type LiveListener = (newStatus: LiveStatusResponse, prevStatus: LiveStatusResponse | null) => void;

interface LiveContextValue {
  isConnected: boolean;
  isReconnecting: boolean;
  lastStatus: LiveStatusResponse | null;
  refetchNow: () => Promise<void>;
  subscribe: (listener: LiveListener) => () => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export const LiveUpdatesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [lastStatus, setLastStatus] = useState<LiveStatusResponse | null>(null);

  const lastStatusRef = useRef<LiveStatusResponse | null>(null);
  const listenersRef = useRef<Set<LiveListener>>(new Set());
  const timerRef = useRef<any>(null);
  const backoffDelayRef = useRef<number>(4000);
  const isFetchingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearPollTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const poll = useCallback(async () => {
    const token = getToken();
    if (!token) {
      clearPollTimer();
      setIsConnected(false);
      setIsReconnecting(false);
      lastStatusRef.current = null;
      setLastStatus(null);
      return;
    }

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      abortControllerRef.current = new AbortController();
      const res = await fetch(`${API_URL}/live/status`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-store",
        },
        signal: abortControllerRef.current.signal,
      });

      if (res.status === 401) {
        clearPollTimer();
        clearToken();
        window.location.hash = "#/user/login";
        return;
      }

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data: LiveStatusResponse = await res.json();

      setIsConnected(true);
      setIsReconnecting(false);
      backoffDelayRef.current = 4000;

      const prev = lastStatusRef.current;
      const changed =
        !prev ||
        prev.accessVersion !== data.accessVersion ||
        prev.unreadNotifications !== data.unreadNotifications ||
        prev.pendingRequestsCount !== data.pendingRequestsCount;

      lastStatusRef.current = data;
      setLastStatus(data);

      if (changed) {
        listenersRef.current.forEach((fn) => {
          try {
            fn(data, prev);
          } catch (e) {
            console.error("Error in live update listener:", e);
          }
        });
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setIsReconnecting(true);
      backoffDelayRef.current = Math.min(backoffDelayRef.current * 2, 30000);
    } finally {
      isFetchingRef.current = false;
      if (typeof document !== "undefined" && document.visibilityState !== "hidden" && getToken()) {
        clearPollTimer();
        timerRef.current = setTimeout(poll, backoffDelayRef.current);
      }
    }
  }, []);

  const refetchNow = useCallback(async () => {
    clearPollTimer();
    backoffDelayRef.current = 4000;
    await poll();
  }, [poll]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refetchNow();
      } else {
        clearPollTimer();
      }
    };

    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        refetchNow();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);

    if (getToken()) {
      poll();
    }

    return () => {
      clearPollTimer();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [poll, refetchNow]);

  const subscribe = useCallback((listener: LiveListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  return (
    <LiveContext.Provider
      value={{
        isConnected,
        isReconnecting,
        lastStatus,
        refetchNow,
        subscribe,
      }}
    >
      {children}
    </LiveContext.Provider>
  );
};

export function useLiveStatus() {
  const ctx = useContext(LiveContext);
  if (!ctx) {
    return {
      isConnected: false,
      isReconnecting: false,
      lastStatus: null,
      refetchNow: async () => {},
      subscribe: () => () => {},
    };
  }
  return ctx;
}
