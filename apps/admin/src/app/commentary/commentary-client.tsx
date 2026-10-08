"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mic, Bot, Send, Languages, Volume2 } from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Badge,
  Textarea,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@mtk/ui";

interface CommentaryEvent {
  id: string;
  over_number: number;
  ball_number: number;
  language: string;
  tone: string;
  text: string;
  is_ai_generated: boolean;
  created_at: string;
}

interface LiveMatch {
  id: string;
  match_number: number;
  team_a: { name: string };
  team_b: { name: string };
  status: string;
}

const LANGUAGES = [
  { value: "en", label: "English" }, { value: "ur", label: "Urdu" },
  { value: "pa", label: "Punjabi" }, { value: "ps", label: "Pashto" },
  { value: "sd", label: "Sindhi" },
];

const TONES = [
  { value: "neutral", label: "Neutral" }, { value: "hype", label: "Hype" },
  { value: "premium", label: "Premium Broadcast" }, { value: "social", label: "Social Short-form" },
];

export function CommentaryClient() {
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<string>("");
  const [commentary, setCommentary] = useState<CommentaryEvent[]>([]);
  const [newCommentary, setNewCommentary] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [selectedTone, setSelectedTone] = useState("neutral");
  const [aiAssistEnabled, setAiAssistEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/matches?status=live")
      .then((r) => r.json())
      .then((d) => {
        const live: LiveMatch[] = d.matches || [];
        setMatches(live);
        if (live.length > 0) setSelectedMatch(live[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedMatch) return;
    const fetchCommentary = () =>
      fetch(`/api/matches/${selectedMatch}/commentary`)
        .then((r) => r.json())
        .then((d) => setCommentary(d.commentary || []))
        .catch(() => {});
    fetchCommentary();
    const interval = setInterval(fetchCommentary, 5000);
    return () => clearInterval(interval);
  }, [selectedMatch]);

  async function addCommentary() {
    if (!newCommentary.trim() || !selectedMatch) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/matches/${selectedMatch}/commentary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newCommentary, language: selectedLanguage, tone: selectedTone, is_ai_generated: false }),
      });
      if (res.ok) { setNewCommentary(""); toast.success("Commentary added"); }
      else toast.error("Failed to add commentary");
    } catch { toast.error("Failed to add commentary"); }
    finally { setLoading(false); }
  }

  async function generateAiCommentary() {
    if (!selectedMatch) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/matches/${selectedMatch}/commentary/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: selectedLanguage, tone: selectedTone }),
      });
      if (res.ok) { const d = await res.json(); setNewCommentary(d.text); toast.success("AI commentary generated"); }
      else toast.error("Failed to generate AI commentary");
    } catch { toast.error("Failed to generate AI commentary"); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Commentary System</h1>
          <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
            AI Beta
          </Badge>
        </div>
        <p className="text-muted-foreground mt-2">
          Manual and AI-powered multi-language commentary. AI assist is beta — circuit-breaker
          fallbacks keep scoring live if OpenAI is degraded.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Mic className="w-5 h-5" />Commentary Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Match</label>
              <Select value={selectedMatch} onValueChange={setSelectedMatch}>
                <SelectTrigger><SelectValue placeholder="Select a match" /></SelectTrigger>
                <SelectContent>
                  {matches.map((match) => (
                    <SelectItem key={match.id} value={match.id}>
                      {match.team_a?.name} vs {match.team_b?.name}
                      {match.status === "live" && <Badge className="ml-2 bg-red-500">LIVE</Badge>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2"><Languages className="w-4 h-4" />Language</label>
              <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2"><Volume2 className="w-4 h-4" />Commentary Tone</label>
              <Select value={selectedTone} onValueChange={setSelectedTone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between py-2 border-t">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4" />
                <span className="text-sm font-medium">AI Assist</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/60 text-amber-700">
                  Beta
                </Badge>
              </div>
              <Button variant={aiAssistEnabled ? "default" : "outline"} size="sm" onClick={() => setAiAssistEnabled(!aiAssistEnabled)}>
                {aiAssistEnabled ? "Enabled" : "Disabled"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Commentary Feed</span>
              {selectedMatch && <Badge variant="outline">{commentary.length} entries</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 mb-6">
              <Textarea
                placeholder="Enter commentary text..."
                value={newCommentary}
                onChange={(e) => setNewCommentary(e.target.value)}
                className="min-h-[100px]"
              />
              <div className="flex gap-2">
                {aiAssistEnabled && (
                  <Button variant="outline" onClick={generateAiCommentary} disabled={loading || !selectedMatch} className="gap-2">
                    <Bot className="w-4 h-4" />Generate AI
                  </Button>
                )}
                <Button onClick={addCommentary} disabled={loading || !newCommentary.trim() || !selectedMatch} className="gap-2 flex-1">
                  <Send className="w-4 h-4" />Add Commentary
                </Button>
              </div>
            </div>

            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {commentary.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No commentary yet. Add your first commentary above.</div>
              ) : (
                commentary.map((event) => (
                  <div key={event.id} className={`p-3 rounded-lg border ${event.is_ai_generated ? "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800" : "bg-muted/50"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm flex-1">{event.text}</p>
                      <div className="flex items-center gap-2">
                        {event.is_ai_generated && <Badge variant="outline" className="text-xs"><Bot className="w-3 h-3 mr-1" />AI</Badge>}
                        <Badge variant="outline" className="text-xs uppercase">{event.language}</Badge>
                        <Badge variant="outline" className="text-xs capitalize">{event.tone}</Badge>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Over {event.over_number}.{event.ball_number} • {new Date(event.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
