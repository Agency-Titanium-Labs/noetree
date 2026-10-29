"use client";

import { useConvexConnectionState } from "convex/react";
import { useEffect, useState } from "react";

export interface ConnectionStatus {
  isOnline: boolean;
  isWebSocketConnected: boolean;
  hasEverConnected: boolean;
  isReconnecting: boolean;
  isDisconnected: boolean;
}

export function useConnectionStatus(): ConnectionStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.onLine === "boolean"
    ) {
      return navigator.onLine;
    }
    return true;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  let connectionState: ReturnType<typeof useConvexConnectionState> | undefined;

  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    connectionState = useConvexConnectionState();
  } catch {
    // Graceful fallback when rendered in isolated test environments without ConvexProvider
  }

  const isWebSocketConnected = connectionState?.isWebSocketConnected ?? true;
  const hasEverConnected = connectionState?.hasEverConnected ?? false;

  const isReconnecting = isOnline && hasEverConnected && !isWebSocketConnected;
  const isDisconnected =
    !isOnline || (hasEverConnected && !isWebSocketConnected);

  return {
    isOnline,
    isWebSocketConnected,
    hasEverConnected,
    isReconnecting,
    isDisconnected,
  };
}
