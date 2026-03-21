import { useWebSocket } from '../hooks/use-websocket'

export function ConnectionStatus() {
  const { connectionState } = useWebSocket()

  if (connectionState === 'connected') return null

  if (connectionState === 'reconnecting') {
    return (
      <div
        style={{
          height: 3,
          background: 'linear-gradient(90deg, transparent, #569cd6, transparent)',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
    )
  }

  // connecting or disconnected
  return (
    <div
      style={{
        padding: '8px 16px',
        paddingTop: 'calc(8px + env(safe-area-inset-top))',
        background: '#5a1d1d',
        color: '#f48771',
        fontSize: 13,
        textAlign: 'center',
      }}
    >
      Disconnected — cached content available
    </div>
  )
}
