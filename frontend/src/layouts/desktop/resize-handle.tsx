import { useCallback, useRef, useState } from 'react'

interface ResizeHandleProps {
  onResize: (width: number) => void
  minWidth: number
  maxWidth: number
}

export function ResizeHandle({ onResize, minWidth, maxWidth }: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      setIsDragging(true)
      startXRef.current = e.clientX
      // Read the sidebar width from the parent element
      const sidebar = (e.target as HTMLElement).parentElement
      startWidthRef.current = sidebar?.offsetWidth ?? 280

      const onPointerMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startXRef.current
        const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta))
        onResize(newWidth)
      }

      const onPointerUp = () => {
        setIsDragging(false)
        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerup', onPointerUp)
      }

      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
    },
    [onResize, minWidth, maxWidth],
  )

  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 4,
        cursor: 'col-resize',
        zIndex: 10,
        borderRight: isDragging ? '1px solid #569cd6' : '1px solid transparent',
      }}
      onMouseEnter={(e) => {
        if (!isDragging) {
          ;(e.target as HTMLElement).style.borderRight = '1px solid #569cd6'
        }
      }}
      onMouseLeave={(e) => {
        if (!isDragging) {
          ;(e.target as HTMLElement).style.borderRight = '1px solid transparent'
        }
      }}
    />
  )
}
