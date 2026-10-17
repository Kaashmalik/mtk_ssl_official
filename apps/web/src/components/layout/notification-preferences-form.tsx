"use client"

import { useState, useTransition } from "react"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { saveNotificationPreferences } from "@/app/actions/notifications"
import { toast } from "sonner"

export type NotificationPreferencesValues = {
  inAppEnabled: boolean
  quietStartMinute: number | null
  quietEndMinute: number | null
  timeZone: string | null
}

/** The editor offers half-hour wall-clock steps (48 options per boundary). */
const QUIET_MINUTE_STEP = 30
const MINUTES_PER_DAY = 24 * 60

function minuteLabel(minute: number): string {
  const hours = Math.floor(minute / 60)
  const minutes = minute % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function quietOptions(): number[] {
  const out: number[] = []
  for (let m = 0; m < MINUTES_PER_DAY; m += QUIET_MINUTE_STEP) out.push(m)
  return out
}

/**
 * FAN-02 consent + quiet-hours preferences, scoped to the active league by the
 * server action (the client never sends a tenant). Save is replay-honest: an
 * identical set answers "Nothing changed - already saved" via `changed`.
 */
export function NotificationPreferencesForm({
  initial,
  defaultTimeZone,
}: {
  initial: NotificationPreferencesValues | null
  defaultTimeZone: string
}) {
  const quietOn = initial?.quietStartMinute != null && initial?.quietEndMinute != null
  const [inAppEnabled, setInAppEnabled] = useState(initial?.inAppEnabled ?? true)
  const [quietEnabled, setQuietEnabled] = useState(quietOn)
  const [startMinute, setStartMinute] = useState(initial?.quietStartMinute ?? 22 * 60)
  const [endMinute, setEndMinute] = useState(initial?.quietEndMinute ?? 7 * 60)
  const [timeZone, setTimeZone] = useState(initial?.timeZone ?? defaultTimeZone)
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    startTransition(async () => {
      try {
        const result = await saveNotificationPreferences({
          inAppEnabled,
          quietEnabled,
          quietStartMinute: startMinute,
          quietEndMinute: endMinute,
          timeZone: timeZone.trim() || null,
        })
        if (result.changed) {
          toast.success("Notification preferences saved")
        } else {
          toast.info("Nothing changed - preferences were already saved")
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Preferences could not be saved"
        toast.error(message)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="pref-in-app" className="font-medium">In-app bell</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Followed-tournament updates land in your bell inside each league you follow.
          </p>
        </div>
        <input
          id="pref-in-app"
          type="checkbox"
          checked={inAppEnabled}
          onChange={(e) => setInAppEnabled(e.target.checked)}
          className="mt-1 h-4 w-4"
        />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="pref-quiet" className="font-medium">Quiet hours</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Future interrupting channels (email/push) will respect this window in your time zone.
            The in-app bell never interrupts, so it is always delivered.
          </p>
        </div>
        <input
          id="pref-quiet"
          type="checkbox"
          checked={quietEnabled}
          onChange={(e) => setQuietEnabled(e.target.checked)}
          className="mt-1 h-4 w-4"
        />
      </div>

      {quietEnabled && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="pref-quiet-start">From</Label>
            <select id="pref-quiet-start" value={startMinute} onChange={(e) => setStartMinute(Number(e.target.value))} className="min-h-11 w-full rounded-md border bg-background px-3">
              {quietOptions().map(m => <option key={m} value={m}>{minuteLabel(m)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pref-quiet-end">Until</Label>
            <select id="pref-quiet-end" value={endMinute} onChange={(e) => setEndMinute(Number(e.target.value))} className="min-h-11 w-full rounded-md border bg-background px-3">
              {quietOptions().map(m => <option key={m} value={m}>{minuteLabel(m)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pref-quiet-zone">Time zone</Label>
            <Input id="pref-quiet-zone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder={defaultTimeZone} aria-describedby="pref-quiet-zone-hint" />
            <p id="pref-quiet-zone-hint" className="text-xs text-muted-foreground">IANA name (e.g. Asia/Karachi).</p>
          </div>
        </div>
      )}

      <Button onClick={handleSave} disabled={isPending}>
        {isPending ? "Saving..." : "Save preferences"}
      </Button>
    </div>
  )
}
