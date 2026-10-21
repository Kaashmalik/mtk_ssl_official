"use client"

import { useEffect, useCallback, useRef } from "react"
import { io, type Socket } from "socket.io-client"
import { useUser } from "@clerk/nextjs"

interface NotificationPayload {
  id: string
  type: string
  title: string
  body: string | null
  createdAt: string
}

interface UseNotificationSocketOptions {
  /**
   * Called when the notification-service WS delivers a new notification.
   * The parent (NotificationBell) can use this to refresh its count/list.
   */
  onNotification?: (payload: NotificationPayload) => void
  /**
   * ENH-06-04 realtime recovery: called on every successful (re)connect, so a
   * socket that was down while notices were written performs a catch-up read
   * instead of waiting for the next poll. The bell's read path is the source
   * of truth; the socket is only the prompt.
   */
  onConnected?: () => void
}

/**
 * Connects to the notification-service WebSocket gateway at
 * `NEXT_PUBLIC_NOTIFICATION_WS_URL` (unset in production = disabled; localhost fallback only in development) and joins
 * the user's personal room.  The connection is established only when a Clerk
 * user is signed in.
 *
 * Graceful degradation: when the WS URL is not set or the connection fails,
 * the hook does nothing and the existing 30 s polling in NotificationBell
 * continues to work.  This means the WS is a progressive enhancement, not a
 * hard dependency.
 */
export function useNotificationSocket({
  onNotification,
  onConnected,
}: UseNotificationSocketOptions = {}) {
  const { user, isLoaded } = useUser()
  const socketRef = useRef<Socket | null>(null)
  const onNotificationRef = useRef(onNotification)
  const onConnectedRef = useRef(onConnected)

  // Keep callback refs up to date without reconnecting on each render
  useEffect(() => {
    onNotificationRef.current = onNotification
  }, [onNotification])

  useEffect(() => {
    onConnectedRef.current = onConnected
  }, [onConnected])

  const connect = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_NOTIFICATION_WS_URL

    // Batch 174: never dial a guessed host. When the URL is unset on a
    // production deployment there IS no notification server to reach - the
    // previous localhost:4008 fallback made the browser hammer an impossible
    // address on every page (console error spam). Notifications remain fully
    // functional via polling/fallbacks; the socket is an enhancement only.
    if (!wsUrl || (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(wsUrl) && process.env.NODE_ENV === "production")) {
      const disabled = {
        on: () => disabled,
        emit: () => disabled,
        disconnect: () => disabled,
      } as unknown as Socket
      return disabled
    }

    const socket = io(wsUrl, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      // ENH-01-04: the notification gateway QUARANTINED client-declared room
      // joining (an arbitrary userId/tenantId used to subscribe to private
      // feeds). Until an authenticated room-derivation flow exists, the
      // socket delivers nothing and the bell relies on its polling fallback;
      // we deliberately send no identity.
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      timeout: 5000,
    })

    socket.on("notification", (payload: NotificationPayload) => {
      onNotificationRef.current?.(payload)
    })

    // Fires on the first connect AND after every reconnect. A notice written
    // while the socket was down is never pushed; this read catches it up.
    socket.on("connect", () => {
      onConnectedRef.current?.()
    })

    socket.on("connect_error", () => {
      // Expected in dev without the notification-service running — silent.
    })

    return socket
  }, [])

  useEffect(() => {
    if (!isLoaded || !user?.id) return

    // Only connect once per mount; disconnect on unmount.
    const socket = connect()
    socketRef.current = socket

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [isLoaded, user?.id, connect])
}
