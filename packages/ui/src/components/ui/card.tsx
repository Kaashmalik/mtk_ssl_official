import * as React from "react"

import { cn } from "../../lib/utils"

// Helper for card variants
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "glass" | "gradient" | "neo" | "ghost"
  hoverEffect?: "none" | "lift" | "glow" | "spotlight"
  noPadding?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", hoverEffect = "none", noPadding = false, ...props }, ref) => {
    const variantStyles = {
      default: "bg-card text-card-foreground",
      glass: "bg-white/10 backdrop-blur-md border-white/20 text-card-foreground shadow-lg dark:bg-black/20 dark:border-white/10",
      gradient: "bg-gradient-to-br from-card to-secondary/20 border-primary/10",
      neo: "bg-card shadow-[5px_5px_10px_rgba(0,0,0,0.05),-5px_-5px_10px_rgba(255,255,255,0.8)] dark:shadow-[5px_5px_10px_rgba(0,0,0,0.3),-5px_-5px_10px_rgba(255,255,255,0.05)] border-none",
      ghost: "border-none shadow-none bg-transparent",
    }

    const hoverStyles = {
      none: "",
      lift: "hover:-translate-y-1 hover:shadow-md transition-transform duration-300",
      glow: "hover:shadow-[0_0_20px_rgba(var(--primary),0.3)] hover:border-primary/50 transition-all duration-300",
      spotlight: "group relative overflow-hidden",
    }

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg border shadow-sm",
          variantStyles[variant],
          hoverStyles[hoverEffect],
          className
        )}
        {...props}
      />
    )
  }
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-2xl font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }

