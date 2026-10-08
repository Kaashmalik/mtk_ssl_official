"use client"

import * as React from "react"
import { motion, useMotionValue, useTransform, animate } from "framer-motion"
import { cn } from "../../lib/utils"
import { ArrowUp, ArrowDown, Minus } from "lucide-react"

interface StatCardProps {
  title: string
  value: number
  previousValue?: number
  format?: "number" | "percentage" | "decimal"
  icon?: React.ReactNode
  trendLabel?: string
  className?: string
  accentColor?: string
  delay?: number
}

function CountUpNumber({ value, format = "number", delay = 0 }: { value: number; format?: string; delay?: number }) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, (latest) => {
    if (format === "decimal") return latest.toFixed(2)
    if (format === "percentage") return `${Math.round(latest)}%`
    return Math.round(latest).toLocaleString()
  })

  React.useEffect(() => {
    const controls = animate(count, value, {
      duration: 1.2,
      delay,
      ease: [0.25, 0.46, 0.45, 0.94],
    })
    return controls.stop
  }, [value, count, delay])

  return <motion.span>{rounded}</motion.span>
}

export function StatCard({
  title,
  value,
  previousValue,
  format = "number",
  icon,
  trendLabel,
  className,
  accentColor,
  delay = 0,
}: StatCardProps) {
  const trend = previousValue !== undefined ? value - previousValue : 0
  const trendPercentage = previousValue && previousValue > 0 ? ((trend / previousValue) * 100).toFixed(1) : "0"
  const isPositive = trend > 0
  const isNeutral = trend === 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: delay * 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm transition-all duration-300 group",
        "hover:shadow-md hover:-translate-y-1",
        className
      )}
    >
      {/* Accent gradient background */}
      {accentColor && (
        <div 
          className="absolute inset-0 opacity-[0.04] group-hover:opacity-[0.08] transition-opacity duration-300"
          style={{ background: `radial-gradient(circle at top right, ${accentColor}, transparent 70%)` }}
        />
      )}
      
      {/* Background icon watermark */}
      {icon && (
        <div className="absolute top-3 right-3 opacity-[0.06]">
          <div className="h-16 w-16">{icon}</div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {icon && <div className="text-primary h-4 w-4">{icon}</div>}
      </div>

      <div className="text-3xl font-bold tracking-tight">
        <CountUpNumber value={value} format={format} delay={delay * 0.1 + 0.2} />
      </div>

      {previousValue !== undefined && (
        <div className="mt-2 flex items-center gap-1">
          {isNeutral ? (
            <Minus className="h-3 w-3 text-muted-foreground" />
          ) : isPositive ? (
            <ArrowUp className="h-3 w-3 text-success" />
          ) : (
            <ArrowDown className="h-3 w-3 text-destructive" />
          )}
          <span
            className={cn(
              "text-xs font-medium",
              isNeutral ? "text-muted-foreground" : isPositive ? "text-success" : "text-destructive"
            )}
          >
            {isPositive && "+"}{trendPercentage}%
          </span>
          {trendLabel && (
            <span className="text-xs text-muted-foreground">{trendLabel}</span>
          )}
        </div>
      )}
    </motion.div>
  )
}
