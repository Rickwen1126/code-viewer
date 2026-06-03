import { useSyncExternalStore, useCallback } from 'react'
import { wsClient, type ConnectionState } from '../services/ws-client'
import type { WsMessage } from '@code-viewer/shared'

export function useWebSocket() {
  const connectionState: ConnectionState = useSyncExternalStore(
    (cb) => wsClient.onStateChange(cb),
    () => wsClient.getState(),
  )

  const send = useCallback(<T>(type: string, payload: T) => {
    return wsClient.send(type, payload)
  }, [])

  const request = useCallback(<TReq, TRes>(type: string, payload: TReq, timeout?: number) => {
    return wsClient.request<TReq, TRes>(type, payload, timeout)
  }, [])

  return { connectionState, send, request }
}

export type { WsMessage }
