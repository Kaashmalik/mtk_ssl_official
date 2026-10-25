import React from "react"
import { cn } from "../../lib/utils"

/**
 * Motion foundation — CSS-driven entrance reveals.
 *
 * Industry best practice (2025/26): entrance reveals must NEVER depend on JS.
 * The previous framer-motion implementation rendered `opacity: 0` inline on
 * the server; any hydration failure (blocked script, bundle error, slow
 * network) left the entire page permanently invisible — a blank screen with
 * only ambient decorations showing. CSS animations always complete, even
 * with JavaScript disabled, and `prefers-reduced-motion` is honored globally
 * via the `.motion-reveal` rules in the app's global stylesheet.
 */

export const motionVariants = {
    fadeIn: "motion-reveal motion-fade",
    fadeInUp: "motion-reveal motion-up",
    fadeInDown: "motion-reveal motion-down",
    fadeInLeft: "motion-reveal motion-left",
    fadeInRight: "motion-reveal motion-right",
    scaleIn: "motion-reveal motion-scale",
    staggerContainer: "motion-stagger",
} as const

export type MotionVariant = keyof typeof motionVariants

interface MotionWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: MotionVariant
    /** Seconds to wait before the reveal starts. */
    delay?: number
    /** Animate direct children one after another instead of the wrapper. */
    stagger?: boolean
    className?: string
    children: React.ReactNode
}

export function MotionWrapper({
    variant = "fadeInUp",
    delay = 0,
    stagger = false,
    className,
    style,
    children,
    ...props
}: MotionWrapperProps) {
    return (
        <div
            className={cn(stagger ? motionVariants.staggerContainer : motionVariants[variant], className)}
            style={{ ...{ "--motion-delay": `${delay}s` } as React.CSSProperties, ...style }}
            {...props}
        >
            {children}
        </div>
    )
}

/** Legacy alias — a plain reveal div (framer import removed with it). */
export function MotionItem({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn("motion-reveal motion-up", className)} {...props}>
            {children}
        </div>
    )
}
