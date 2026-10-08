"use client"

import * as React from "react"
import { cn } from "../../lib/utils"
import { PlusCircle } from "lucide-react"

interface EmptyStateProps {
    title: string
    description: string
    icon?: React.ReactNode
    action?: {
        label: string
        onClick: () => void
    }
    className?: string
}

export function EmptyState({
    title,
    description,
    icon,
    action,
    className,
}: EmptyStateProps) {
    return (
        <div className={cn(
            "animate-fade-in flex flex-col items-center justify-center p-8 text-center duration-500",
            className
        )}>
            {icon && (
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/5 text-primary ring-4 ring-primary/5 backdrop-blur-sm transition-transform duration-300 hover:scale-110">
                    {icon}
                </div>
            )}
            <h3 className="mb-3 text-xl font-bold tracking-tight text-foreground">{title}</h3>
            <p className="mb-8 max-w-sm text-base leading-relaxed text-muted-foreground">{description}</p>
            {action && (
                <button
                    onClick={action.onClick}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 font-medium text-primary-foreground transition-all duration-200 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 active:scale-95"
                >
                    <PlusCircle className="h-4 w-4" />
                    {action.label}
                </button>
            )}
        </div>
    )
}
