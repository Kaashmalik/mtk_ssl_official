"use client";

import { useState } from "react";
import {
  resolveWicketFielderId,
  wicketFielderQuestion,
  wicketFielderRequirement,
  wicketRequiresVictimAttribution,
} from "@mtk/contracts";
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
  onSelect: (type: WicketType, wicketPlayerOutId?: string, wicketFielderId?: string) => void;
  onCancel: () => void;
  /** Batch 100: both confirmed crease occupants from the last
   *  service-confirmed acknowledgement (ids resolved to names by the page).
   *  When present, a run-out asks WHICH batter actually left - the striker
   *  default was silently wrong for every off-strike run-out. */
  creaseBatters?: Array<{ id: string; name: string; onStrike: boolean }>;
  /** Batch 103: the fielding-side squad (the bowler among them - a caught-
   *  and-bowled catcher is legitimate). When present, caught asks for the
   *  catcher and run_out/stumped offer the dismissing fielder. Absent → the
   *  record is written without fielder attribution, as before Batch 103. */
  fielders?: Array<{ id: string; name: string }>;
}

/** Batch 102: the "which dismissal asks for the victim" rule now lives in
 *  @mtk/contracts (wicketRequiresVictimAttribution) so the mobile picker
 *  cannot drift from this one; the local copy is gone. Batch 103: the
 *  fielder question and the required/optional rule come from the SAME
 *  contracts module, so both surfaces ask IDENTICAL questions. */
export function WicketSelector({ onSelect, onCancel, creaseBatters, fielders }: WicketSelectorProps) {
  const [pendingType, setPendingType] = useState<WicketType | null>(null);
  // Batch 103: victim choice captured WHILE the fielder question follows
  // (a run-out can ask both: which batter left, then who broke the wicket).
  const [pendingVictimId, setPendingVictimId] = useState<string | undefined>(undefined);
  const hasFielders = Array.isArray(fielders) && fielders.length > 0;
  const asksFielder = pendingType != null && wicketFielderRequirement(pendingType) !== "none" && hasFielders;
  const victimNeeded = pendingType != null && wicketRequiresVictimAttribution(pendingType)
    && Array.isArray(creaseBatters) && creaseBatters.length === 2;
  // Query order: which batter left FIRST (run-out), then who dismissed them.
  const victimStep = victimNeeded && !pendingVictimId;
  const fielderStep = asksFielder && !victimStep;

  const choose = (type: WicketType) => {
    const victimNeeded = wicketRequiresVictimAttribution(type)
      && Array.isArray(creaseBatters) && creaseBatters.length === 2;
    const fielderNeeded = wicketFielderRequirement(type) !== "none" && hasFielders;
    if (victimNeeded || fielderNeeded) {
      setPendingVictimId(undefined);
      setPendingType(type);
      return;
    }
    void onSelect(type);
  };

  const chooseVictim = (victimId: string) => {
    if (asksFielder) {
      setPendingVictimId(victimId);
      return;
    }
    void onSelect(pendingType!, victimId);
  };

  const chooseFielder = (fielderId?: string) => {
    // Re-validated against the offered candidates at record time; an
    // un-offered/foreign id degrades to no attribution, never a guess.
    void onSelect(
      pendingType!,
      pendingVictimId,
      fielderId
        ? resolveWicketFielderId({ wicketType: pendingType, options: fielders ?? [], chosenId: fielderId }) ?? undefined
        : undefined,
    );
  };

  const stepBack = () => {
    if (fielderStep && pendingVictimId) {
      // Back from the fielder question re-opens the victim question.
      setPendingVictimId(undefined);
      return;
    }
    setPendingVictimId(undefined);
    setPendingType(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 sm:p-6">
      <div className="bg-background rounded-lg shadow-xl max-w-md w-full p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg sm:text-xl font-bold">
            {fielderStep
              ? wicketFielderQuestion(pendingType) ?? "Who dismissed the batter?"
              : pendingType
                ? "Which batter is out?"
                : "Select Wicket Type"}
          </h3>
          <Button
            variant="ghost"
            size="icon"
            aria-label={pendingType ? "Back to wicket types" : "Cancel wicket selection"}
            onClick={() => {
              if (pendingType) {
                stepBack();
              } else {
                onCancel();
              }
            }}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {fielderStep ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {(fielders ?? []).map((fielder) => (
                <Button
                  key={fielder.id}
                  onClick={() => chooseFielder(fielder.id)}
                  className="flex flex-col items-start p-3 sm:p-4 h-auto touch-manipulation active:scale-95"
                  variant="outline"
                >
                  <span className="font-semibold text-sm sm:text-base">{fielder.name}</span>
                </Button>
              ))}
            </div>
            {wicketFielderRequirement(pendingType) === "optional" && (
              <Button
                onClick={() => chooseFielder(undefined)}
                className="w-full touch-manipulation active:scale-95"
                variant="ghost"
              >
                Record without fielder
              </Button>
            )}
          </div>
        ) : victimStep ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {(creaseBatters ?? []).map((batter) => (
              <Button
                key={batter.id}
                onClick={() => void chooseVictim(batter.id)}
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
