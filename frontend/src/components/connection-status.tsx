import { useWebSocket } from '../hooks/use-websocket'

export function ConnectionStatus() {
  const { connectionState } = useWebSocket()

  if (connectionState === 'connected') return null

  // All non-connected states: thin 3px bar (not alarming red banner)
  // With cache-first loading, user already sees content — just a subtle signal
  return (
    <div
      style={{
        height: 3,
        background: connectionState === 'disconnected'
          ? '#888'
          : 'linear-gradient(90deg, transparent, #569cd6, transparent)',
        animation: connectionState === 'disconnected'
          ? 'none'
          : 'pulse 1.5s ease-in-out infinite',
      }}
    />
  )
}
