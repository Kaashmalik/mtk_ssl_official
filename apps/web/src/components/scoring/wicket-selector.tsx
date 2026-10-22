"use client";

import { useState } from "react";
import { Button } from "@mtk/ui";
import { WicketType } from "@/stores/scoring-store";
import { X } from "lucide-react";

const WICKET_TYPES: { value: WicketType; label: string; description: string }[] = [
  { value: "bowled", label: "Bowled", description: "Bowler hits the stumps" },
  { value: "caught", label: "Caught", description: "Caught by fielder" },
  { value: "lbw", label: "LBW", description: "Leg Before Wicket" },
  { value: "run_out", label: "Run Out", description: "Run out by fielder" },
  { value: "stumped", label: "Stumped", description: "Stumped by wicketkeeper" },
  { value: "hit_wicket", label: "Hit Wicket", description: "Batsman hits stumps" },
];

interface WicketSelectorProps {
  onSelect: (type: WicketType, wicketPlayerOutId?: string) => void;
  onCancel: () => void;
  /** Batch 100: both confirmed crease occupants from the last
   *  service-confirmed acknowledgement (ids resolved to names by the page).
   *  When present, a run-out asks WHICH batter actually left - the striker
   *  default was silently wrong for every off-strike run-out. */
  creaseBatters?: Array<{ id: string; name: string; onStrike: boolean }>;
}

/** Dismissal types whose victim is rule-fixed to the striker (they faced the
 *  ball). Only run_out needs the scorer to name the batter who left. */
function needsVictimAttribution(type: WicketType): boolean {
  return type === "run_out";
}

export function WicketSelector({ onSelect, onCancel, creaseBatters }: WicketSelectorProps) {
  const [pendingType, setPendingType] = useState<WicketType | null>(null);
  const victimStep = pendingType != null && needsVictimAttribution(pendingType)
    && Array.isArray(creaseBatters) && creaseBatters.length === 2;

  const choose = (type: WicketType) => {
    if (needsVictimAttribution(type) && Array.isArray(creaseBatters) && creaseBatters.length === 2) {
      setPendingType(type);
      return;
    }
    void onSelect(type);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 sm:p-6">
      <div className="bg-background rounded-lg shadow-xl max-w-md w-full p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg sm:text-xl font-bold">
            {pendingType ? "Which batter is out?" : "Select Wicket Type"}
          </h3>
          <Button
            variant="ghost"
            size="icon"
            aria-label={pendingType ? "Back to wicket types" : "Cancel wicket selection"}
            onClick={() => {
              if (pendingType) {
                setPendingType(null);
              } else {
                onCancel();
              }
            }}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {victimStep ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {(creaseBatters ?? []).map((batter) => (
              <Button
                key={batter.id}
                onClick={() => void onSelect(pendingType!, batter.id)}
                className="flex flex-col items-start p-3 sm:p-4 h-auto touch-manipulation active:scale-95"
                variant="outline"
              >
                <span className="font-semibold text-sm sm:text-base">{batter.name}</span>
                <span className="text-xs text-muted-foreground mt-1">
                  {batter.onStrike ? "On strike" : "Non-striker"}
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {WICKET_TYPES.map((type) => (
              <Button
                key={type.value}
                onClick={() => choose(type.value)}
                className="flex flex-col items-start p-3 sm:p-4 h-auto touch-manipulation active:scale-95"
                variant="outline"
              >
                <span className="font-semibold text-sm sm:text-base">{type.label}</span>
                <span className="text-xs text-muted-foreground mt-1">{type.description}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
