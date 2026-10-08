"use client"

import { motion, type HTMLMotionProps } from "framer-motion"
import { cn } from "../../lib/utils"

export const motionVariants = {
    fadeIn: {
        hidden: { opacity: 0 },
        visible: { opacity: 1 },
    },
    fadeInUp: {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
    },
    fadeInDown: {
        hidden: { opacity: 0, y: -20 },
        visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
    },
    fadeInLeft: {
        hidden: { opacity: 0, x: -20 },
        visible: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
    },
    fadeInRight: {
        hidden: { opacity: 0, x: 20 },
        visible: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
    },
    scaleIn: {
        hidden: { opacity: 0, scale: 0.9 },
        visible: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 300, damping: 24 } },
    },
    staggerContainer: {
        hidden: {},
        visible: { transition: { staggerChildren: 0.1 } },
    },
}

interface MotionWrapperProps extends HTMLMotionProps<"div"> {
    variant?: keyof typeof motionVariants
    delay?: number
    stagger?: boolean
    className?: string
    children: React.ReactNode
}

export function MotionWrapper({
    variant = "fadeInUp",
    delay = 0,
    stagger = false,
    className,
    children,
    ...props
}: MotionWrapperProps) {
    const selectedVariant = stagger ? motionVariants.staggerContainer : motionVariants[variant]

    return (
        <motion.div
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={selectedVariant}
            transition={{ delay }}
            className={cn(className)}
            {...props}
        >
            {children}
        </motion.div>
    )
}

export const MotionItem = motion.div
