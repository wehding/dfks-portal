"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ResponsiveContainer } from "recharts"

type ResponsiveChartContainerProps = {
  children: ReactNode
  minHeight?: number
  minWidth?: number
}

export function ResponsiveChartContainer({
  children,
  minHeight = 300,
  minWidth = 0,
}: ResponsiveChartContainerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [initialSize, setInitialSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = () => {
      const bounds = root.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) {
        setInitialSize(null)
        return
      }
      setInitialSize(current => current?.width === bounds.width && current.height === bounds.height
        ? current
        : { width: bounds.width, height: bounds.height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={rootRef} className="h-full w-full min-w-0" style={{ minHeight, minWidth }}>
      {initialSize && <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        initialDimension={initialSize}
      >
        {children}
      </ResponsiveContainer>}
    </div>
  )
}
