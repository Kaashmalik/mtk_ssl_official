import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white hover:bg-destructive/90 shadow-sm",
        outline: "text-foreground hover:bg-accent hover:text-accent-foreground",
        glass: "border-white/20 bg-white/20 backdrop-blur-md text-foreground hover:bg-white/30 shadow-sm",
        soft: "border-transparent bg-primary/10 text-primary hover:bg-primary/20",
      },
      animation: {
        none: "",
        pulse: "animate-pulse",
        scale: "hover:scale-105",
      },
    },
    defaultVariants: {
      variant: "default",
      animation: "none",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof badgeVariants> {
  withDot?: boolean
}

function Badge({ className, variant, animation, withDot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, animation }), className)} {...props}>
      {withDot && (
        <span className="mr-1.5 flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
        </span>
      )}
      {children}
    </div>
  )
}

export { Badge, badgeVariants }

