import { useEffect, useRef } from "react";
import { useLiveStatus } from "../context/LiveUpdatesContext";
import { LiveStatusResponse } from "../types";

/**
 * Hook to poll /api/live/status with 4s intervals, pausing when tab is hidden,
 * exponential backoff on errors, and triggering onChange only when accessVersion
 * or unreadNotifications actually changes.
 */
export function useLiveUpdates(
  onChange?: (newStatus: LiveStatusResponse, prevStatus: LiveStatusResponse | null) => void
) {
  const { isConnected, isReconnecting, lastStatus, refetchNow, subscribe } = useLiveStatus();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!onChangeRef.current) return;
    const unsubscribe = subscribe((newStatus, prevStatus) => {
      if (onChangeRef.current) {
        onChangeRef.current(newStatus, prevStatus);
      }
    });
    return unsubscribe;
  }, [subscribe]);

  return {
    isConnected,
    isReconnecting,
    lastStatus,
    refetchNow,
  };
}
