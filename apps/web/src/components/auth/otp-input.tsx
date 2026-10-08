"use client"

import { useRef, useState, KeyboardEvent, ClipboardEvent } from "react"

interface OtpInputProps {
  length?: number
  onComplete: (code: string) => void
  disabled?: boolean
}

export function OtpInput({ length = 6, onComplete, disabled }: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(""))
  const inputsRef = useRef<(HTMLInputElement | null)[]>([])

  const update = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1)
    const next = [...digits]
    next[index] = digit
    setDigits(next)
    if (digit && index < length - 1) inputsRef.current[index + 1]?.focus()
    const code = next.join("")
    if (code.length === length && !next.includes("")) onComplete(code)
  }

  const onKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus()
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length)
    if (!text) return
    const next = Array(length).fill("")
    for (let i = 0; i < text.length; i++) next[i] = text[i]
    setDigits(next)
    const focusIdx = Math.min(text.length, length - 1)
    inputsRef.current[focusIdx]?.focus()
    if (text.length === length) onComplete(text)
  }

  return (
    <div className="flex gap-2 justify-center">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { inputsRef.current[i] = el }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={d}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          className="w-11 h-14 rounded-lg border text-center text-xl font-bold focus:outline-none focus:ring-2 focus:ring-primary"
          onChange={(e) => update(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
        />
      ))}
    </div>
  )
}
