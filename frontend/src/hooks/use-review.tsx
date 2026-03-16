import { useState, useEffect, createContext, useContext } from 'react'
import { wsClient } from '../services/ws-client'
import type { ReviewPendingEditsChangedPayload } from '@code-viewer/shared'

interface ReviewContextValue {
  pendingEditCount: number
  toolRequestCount: number
  totalBadgeCount: number
}

export const ReviewContext = createContext<ReviewContextValue>({
  pendingEditCount: 0,
  toolRequestCount: 0,
  totalBadgeCount: 0,
})

export function ReviewProvider({ children }: { children: React.ReactNode }) {
  const [pendingEditCount, setPendingEditCount] = useState(0)
  const [toolRequestCount, setToolRequestCount] = useState(0)

  useEffect(() => {
    const unsub = wsClient.subscribe('review.pendingEditsChanged', (msg) => {
      const payload = msg.payload as ReviewPendingEditsChangedPayload
      setPendingEditCount(payload.pendingEditCount)
      setToolRequestCount(payload.toolRequestCount)
    })
    return unsub
  }, [])

  return (
    <ReviewContext.Provider
      value={{
        pendingEditCount,
        toolRequestCount,
        totalBadgeCount: pendingEditCount + toolRequestCount,
      }}
    >
      {children}
    </ReviewContext.Provider>
  )
}

export function useReview() {
  return useContext(ReviewContext)
}
