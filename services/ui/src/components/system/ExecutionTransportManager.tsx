'use client'

import { useEffect } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  startExecutionTransport,
  stopExecutionTransport,
} from "@/core/execution/execution-transport"

/**
 * Mounts once inside the authenticated shell.
 * Starts the SSE transport when the user is logged in,
 * and tears it down on logout or unmount.
 * Renders nothing.
 */
export function ExecutionTransportManager() {
  const { apiKey, isAuthenticated } = useAuth()

  useEffect(() => {
    if (!isAuthenticated || !apiKey) {
      stopExecutionTransport()
      return
    }

    startExecutionTransport(apiKey)

    return () => {
      stopExecutionTransport()
    }
  }, [apiKey, isAuthenticated])

  return null
}
