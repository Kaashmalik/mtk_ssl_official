"use client";

import { useState } from "react";
import { Button } from "@mtk/ui";
import { BallInput, WicketType, useScoringStore } from "@/stores/scoring-store";
import { WicketSelector } from "./wicket-selector";

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
  onBallAdded?: () => void;
}

export function BallInputComponent({ batsmanId, bowlerId, onBallAdded }: BallInputProps) {
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

  const submitBall = async (input: BallInput, wicketType?: WicketType, runs?: number) => {
    if (!currentInnings) return;

    const overNumber = currentInnings.currentBall === 6 ? currentInnings.currentOver + 1 : currentInnings.currentOver;
    const ballNumber = currentInnings.currentBall === 6 ? 1 : currentInnings.currentBall + 1;

    await addBall({
      overNumber,
      ballNumber,
      input,
      runs: runs ?? (typeof input === "number" ? input : input === "WD" || input === "NB" ? 1 : 0),
      isWicket: input === "W" || !!wicketType,
      wicketType,
      isWide: input === "WD",
      isNoBall: input === "NB",
      isBye: input === "B",
      isLegBye: input === "LB",
      batsmanId,
      bowlerId,
    });

    setShowWicketSelector(false);
    setPendingWicket(null);
    onBallAdded?.();
  };

  const handleWicketSelect = async (wicketType: WicketType) => {
    if (pendingWicket) {
      await submitBall(pendingWicket, wicketType);
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 sm:gap-3">
        {BALL_OPTIONS.map((option) => (
          <Button
            key={option.value}
            onClick={() => handleBallClick(option.value)}
            aria-label={`Record ${option.label}`}
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
          onCancel={() => {
            setShowWicketSelector(false);
            setPendingWicket(null);
          }}
        />
      )}
    </div>
  );
}

