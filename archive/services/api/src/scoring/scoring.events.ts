export const ScoringEvents = {
  JoinMatch: "join-match",
  LeaveMatch: "leave-match",
  BallAdded: "ball-added",
  BallUndo: "ball-undo",
  MatchState: "match-state",
  MatchStateUpdated: "match-state-updated",
  ScorerJoined: "scorer-joined",
  ScorerLeft: "scorer-left",
  BallRemoved: "ball-removed",
} as const;

export type ScoringEvent = (typeof ScoringEvents)[keyof typeof ScoringEvents];