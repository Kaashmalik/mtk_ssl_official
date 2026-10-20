"use client"

import { motion, useReducedMotion } from "framer-motion"
import { usePathname } from "next/navigation"

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // ENH-04-02: reduced-motion users get the swap without the slide/fade.
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      key={pathname}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="h-full w-full"
    >
      {children}
    </motion.div>
  )
}
