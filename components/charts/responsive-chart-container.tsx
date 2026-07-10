"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ResponsiveContainer } from "recharts"

type ResponsiveChartContainerProps = {
  children: ReactNode
  minHeight?: number
  minWidth?: number
}

export function ResponsiveChartContainer({
  children,
  minHeight = 300,
  minWidth = 300,
}: ResponsiveChartContainerProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  if (!mounted) {
    return <div aria-hidden className="h-full w-full" style={{ minHeight, minWidth }} />
  }

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={minHeight} minWidth={minWidth}>
      {children}
    </ResponsiveContainer>
  )
}
