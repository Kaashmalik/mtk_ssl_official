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
}

/**
 * Connects to the notification-service WebSocket gateway at
 * `NEXT_PUBLIC_NOTIFICATION_WS_URL` (falls back to localhost:4008) and joins
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
}: UseNotificationSocketOptions = {}) {
  const { user, isLoaded } = useUser()
  const socketRef = useRef<Socket | null>(null)
  const onNotificationRef = useRef(onNotification)

  // Keep callback ref up to date without reconnecting on each render
  useEffect(() => {
    onNotificationRef.current = onNotification
  }, [onNotification])

  const connect = useCallback((userId: string, internalUserId?: string) => {
    const wsUrl =
      process.env.NEXT_PUBLIC_NOTIFICATION_WS_URL ?? "http://localhost:4008"

    const socket = io(wsUrl, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      query: internalUserId ? { userId: internalUserId } : undefined,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      timeout: 5000,
    })

    socket.on("connect", () => {
      // If we have the internal userId via query, the server already put us
      // in the room. If we only have the Clerk ID we join after connect.
      if (!internalUserId && userId) {
        socket.emit("join", { userId })
      }
    })

    socket.on("notification", (payload: NotificationPayload) => {
      onNotificationRef.current?.(payload)
    })

    socket.on("connect_error", () => {
      // Expected in dev without the notification-service running — silent.
    })

    return socket
  }, [])

  useEffect(() => {
    if (!isLoaded || !user?.id) return

    // Only connect once per mount; disconnect on unmount.
    const socket = connect(user.id)
    socketRef.current = socket

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [isLoaded, user?.id, connect])
}
