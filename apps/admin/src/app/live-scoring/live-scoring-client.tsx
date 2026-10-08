"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Trophy } from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Badge,
  Skeleton,
} from "@mtk/ui";

interface LiveMatch {
  id: string;
  match_number: number;
  status: string;
  team_a: { name: string; logo_url: string };
  team_b: { name: string; logo_url: string };
  match_innings: {
    id: string;
    innings_number: number;
    team_id: string;
    total_runs: number;
    total_wickets: number;
    total_balls: number;
    status: string;
  }[];
  current_innings?: {
    id: string;
    innings_number: number;
    total_runs: number;
    total_wickets: number;
    total_balls: number;
  };
}

function getOversDisplay(balls: number) {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function getRunRate(runs: number, balls: number) {
  return balls === 0 ? "0.00" : ((runs / balls) * 6).toFixed(2);
}

export function LiveScoringClient() {
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<LiveMatch | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLiveMatches = useCallback(async () => {
    try {
      const res = await fetch("/api/matches?status=live");
      const data = await res.json();
      const live: LiveMatch[] = data.matches || [];
      setLiveMatches(live);
      if (live.length > 0 && !selectedMatch) setSelectedMatch(live[0]);
    } catch {
      // silent refresh failure
    } finally {
      setLoading(false);
    }
  }, [selectedMatch]);

  useEffect(() => {
    fetchLiveMatches();
    const interval = setInterval(fetchLiveMatches, 5000);
    return () => clearInterval(interval);
  }, [fetchLiveMatches]);

  async function updateScore(matchId: string, inningsId: string, runs: number, isWicket = false) {
    try {
      const res = await fetch(`/api/matches/${matchId}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ innings_id: inningsId, runs, is_wicket: isWicket }),
      });
      if (res.ok) { fetchLiveMatches(); toast.success("Score updated"); }
      else toast.error("Failed to update score");
    } catch {
      toast.error("Failed to update score");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
    );
  }

  if (liveMatches.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Scoring</h1>
          <p className="text-muted-foreground mt-2">Real-time ball-by-ball scoring interface.</p>
        </div>
        <Card className="p-12 text-center">
          <CardContent>
            <div className="text-6xl mb-4">🏏</div>
            <h3 className="text-xl font-semibold mb-2">No Live Matches</h3>
            <p className="text-muted-foreground mb-4">
              There are no matches currently in progress. Start a match from the Matches page.
            </p>
            <Button asChild><a href="/matches">Go to Matches</a></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Scoring</h1>
          <p className="text-muted-foreground mt-2">Real-time ball-by-ball scoring interface.</p>
        </div>
        <Badge className="bg-red-500 animate-pulse">● LIVE</Badge>
      </div>

      {liveMatches.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {liveMatches.map((match) => (
            <Button
              key={match.id}
              variant={selectedMatch?.id === match.id ? "default" : "outline"}
              onClick={() => setSelectedMatch(match)}
              className="whitespace-nowrap"
            >
              {match.team_a?.name} vs {match.team_b?.name}
            </Button>
          ))}
        </div>
      )}

      {selectedMatch && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Scoreboard</span>
                <Badge variant="outline">Match #{selectedMatch.match_number}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  {selectedMatch.team_a?.logo_url && (
                    <img src={selectedMatch.team_a.logo_url} alt="" className="w-12 h-12 rounded-full object-cover" />
                  )}
                  <div>
                    <div className="font-bold text-lg">{selectedMatch.team_a?.name}</div>
                    <div className="text-sm text-muted-foreground">Team A</div>
                  </div>
                </div>
                <div className="text-2xl font-bold text-muted-foreground">VS</div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-bold text-lg">{selectedMatch.team_b?.name}</div>
                    <div className="text-sm text-muted-foreground">Team B</div>
                  </div>
                  {selectedMatch.team_b?.logo_url && (
                    <img src={selectedMatch.team_b.logo_url} alt="" className="w-12 h-12 rounded-full object-cover" />
                  )}
                </div>
              </div>

              {selectedMatch.current_innings && (
                <div className="bg-muted rounded-lg p-6 text-center mb-6">
                  <div className="text-sm text-muted-foreground mb-2">
                    Innings {selectedMatch.current_innings.innings_number}
                  </div>
                  <div className="text-6xl font-bold mb-2">
                    {selectedMatch.current_innings.total_runs}/{selectedMatch.current_innings.total_wickets}
                  </div>
                  <div className="text-xl text-muted-foreground">
                    Overs: {getOversDisplay(selectedMatch.current_innings.total_balls)} |{" "}
                    RR: {getRunRate(selectedMatch.current_innings.total_runs, selectedMatch.current_innings.total_balls)}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {selectedMatch.match_innings?.map((innings) => (
                  <div
                    key={innings.id}
                    className={`p-4 rounded-lg border ${
                      selectedMatch.current_innings?.id === innings.id ? "border-primary bg-primary/5" : "border-muted"
                    }`}
                  >
                    <div className="text-sm font-medium">Innings {innings.innings_number}</div>
                    <div className="text-2xl font-bold">{innings.total_runs}/{innings.total_wickets}</div>
                    <div className="text-sm text-muted-foreground">{getOversDisplay(innings.total_balls)} overs</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Scoring Controls</CardTitle></CardHeader>
            <CardContent>
              {selectedMatch.current_innings ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    {[0, 1, 2, 3, 4, 6].map((runs) => (
                      <Button
                        key={runs}
                        variant="outline"
                        size="lg"
                        onClick={() => updateScore(selectedMatch.id, selectedMatch.current_innings!.id, runs)}
                        className="text-xl font-bold h-16"
                      >
                        {runs}
                      </Button>
                    ))}
                    <Button
                      size="lg"
                      onClick={() => updateScore(selectedMatch.id, selectedMatch.current_innings!.id, 0, true)}
                      className="text-xl font-bold h-16 bg-red-600 hover:bg-red-700"
                    >
                      W
                    </Button>
                  </div>
                  <div className="pt-4 border-t">
                    <div className="text-sm font-medium mb-2">Extras</div>
                    <div className="grid grid-cols-4 gap-2">
                      <Button variant="outline" size="sm">Wide</Button>
                      <Button variant="outline" size="sm">No Ball</Button>
                      <Button variant="outline" size="sm">Bye</Button>
                      <Button variant="outline" size="sm">Leg Bye</Button>
                    </div>
                  </div>
                  <div className="pt-4 border-t space-y-2">
                    <div className="text-sm font-medium">Actions</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" className="gap-2"><RotateCcw className="w-4 h-4" />Undo</Button>
                      <Button variant="outline" className="gap-2"><Trophy className="w-4 h-4" />End Match</Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No active innings. Start an innings to begin scoring.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
