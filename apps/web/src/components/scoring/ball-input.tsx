"use client";

import * as React from "react";
import { useRef, useState } from "react";
import { wicketFielderRequirement } from "@mtk/contracts";
import { Button } from "@mtk/ui";
import { BallInput, WicketType, useScoringStore } from "@/stores/scoring-store";
import { WicketSelector } from "./wicket-selector";
import { toast } from "sonner";

const BALL_OPTIONS: { value: BallInput; label: string; color: string }[] = [
  { value: 0, label: "0", color: "bg-gray-700 hover:bg-gray-600" },
  { value: 1, label: "1", color: "bg-blue-600 hover:bg-blue-500" },
  { value: 2, label: "2", color: "bg-green-600 hover:bg-green-500" },
  { value: 3, label: "3", color: "bg-yellow-600 hover:bg-yellow-500" },
  { value: 4, label: "4", color: "bg-orange-600 hover:bg-orange-500" },
  { value: 6, label: "6", color: "bg-red-600 hover:bg-red-500" },
  { value: "W", label: "W", color: "bg-purple-600 hover:bg-purple-500" },
  { value: "WD", label: "WD", color: "bg-pink-600 hover:bg-pink-500" },
  { value: "NB", label: "NB", color: "bg-cyan-600 hover:bg-cyan-500" },
  { value: "LB", label: "LB", color: "bg-indigo-600 hover:bg-indigo-500" },
  { value: "B", label: "B", color: "bg-teal-600 hover:bg-teal-500" },
];

interface BallInputProps {
  batsmanId?: string;
  bowlerId?: string;
  /** Batch 100: both confirmed crease occupants from the last
   *  service-confirmed acknowledgement. When provided, a run-out asks the
   *  scorer WHICH batter is out instead of silently assuming the striker. */
  creaseBatters?: Array<{ id: string; name: string; onStrike: boolean }>;
  /** Batch 103: the fielding-side squad. When provided, caught asks for the
   *  catcher (the bowler included - caught and bowled) and run_out/stumped
   *  offer the dismissing fielder. */
  fielders?: Array<{ id: string; name: string }>;
  onBallAdded?: () => void | Promise<void>;
  disabled?: boolean;
}

export function BallInputComponent({ batsmanId, bowlerId, creaseBatters, fielders, onBallAdded, disabled = false }: BallInputProps) {
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [showWicketSelector, setShowWicketSelector] = useState(false);
  const [pendingWicket, setPendingWicket] = useState<BallInput | null>(null);
  const addBall = useScoringStore((state) => state.addBall);
  const currentInnings = useScoringStore((state) =>
    state.currentInnings === 1 ? state.innings1 :
    state.currentInnings === 2 ? state.innings2 :
    state.superOver
  );

  const handleBallClick = (input: BallInput) => {
    if (input === "W") {
      setPendingWicket(input);
      setShowWicketSelector(true);
    } else {
      void submitBall(input);
    }
  };

  const submitBall = async (input: BallInput, wicketType?: WicketType, runs?: number, wicketPlayerOutId?: string, wicketFielderId?: string) => {
    if (!currentInnings || disabled || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      const overNumber = currentInnings.currentBall === 6 ? currentInnings.currentOver + 1 : currentInnings.currentOver;
      const ballNumber = currentInnings.currentBall === 6 ? 1 : currentInnings.currentBall + 1;

      await addBall({
        overNumber,
        ballNumber,
        input,
        runs: runs ?? (typeof input === "number" ? input : input === "W" ? 0 : 1),
        isWicket: input === "W" || !!wicketType,
        wicketType,
        // Batch 100: runner-out attribution is only meaningful for dismissal
        // types whose victim is not rule-fixed (the service/fold default the
        // striker for bowled/caught/lbw/stumped/hit_wicket).
        wicketPlayerOutId: wicketType === "run_out" ? wicketPlayerOutId : undefined,
        // Batch 103: the dismissing fielder - collected only for dismissal
        // types that ask for one; the canonical service re-validates the id
        // against the fielding XI regardless of what this surface sent.
        wicketFielderId: wicketType && wicketFielderRequirement(wicketType) !== "none"
          ? wicketFielderId
          : undefined,
        isWide: input === "WD",
        isNoBall: input === "NB",
        isBye: input === "B",
        isLegBye: input === "LB",
        batsmanId,
        bowlerId,
      });

      setShowWicketSelector(false);
      setPendingWicket(null);
      await onBallAdded?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record this delivery");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const handleWicketSelect = async (wicketType: WicketType, wicketPlayerOutId?: string, wicketFielderId?: string) => {
    if (pendingWicket) {
      await submitBall(pendingWicket, wicketType, undefined, wicketPlayerOutId, wicketFielderId);
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 sm:gap-3">
        {BALL_OPTIONS.map((option) => (
          <Button
            key={option.value}
            onClick={() => handleBallClick(option.value)}
            disabled={disabled || saving || !batsmanId || !bowlerId}
            aria-label={`Record ${option.label}`}
            // Batch 139: disabled-but-busy is announced, not just felt —
            // assistive tech hears the pending state the pads are in.
            aria-busy={saving || undefined}
            className={`${option.color} text-white text-xl sm:text-xl font-bold min-h-14 sm:min-h-0 py-5 sm:py-6 touch-manipulation active:scale-95 transition-all rounded-xl`}
            size="lg"
          >
            {option.label}
          </Button>
        ))}
      </div>

      {showWicketSelector && (
        <WicketSelector
          onSelect={handleWicketSelect}
          creaseBatters={creaseBatters}
          fielders={fielders}
          // Batch 139: the modal inherits the live save state — every
          // control in it goes stable while the dismissal write runs.
          submitting={saving}
          onCancel={() => {
            setShowWicketSelector(false);
            setPendingWicket(null);
          }}
        />
      )}
    </div>
  );
}

