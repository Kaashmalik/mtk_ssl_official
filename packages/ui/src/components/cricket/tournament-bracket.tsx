"use client"

import { Card } from "@mtk/ui/components/ui/card"
import { Trophy } from "lucide-react"

export function TournamentBracket() {
  return (
    <div className="w-full overflow-x-auto py-8">
      <div className="min-w-[800px] flex justify-between">
        
        {/* Quarter Finals */}
        <div className="flex flex-col justify-around h-[400px]">
          <MatchBox team1="Lahore Lions" score1="165" team2="Karachi Kings" score2="160" />
          <MatchBox team1="Multan Sultans" score1="180" team2="Quetta Gladiators" score2="140" />
          <MatchBox team1="Islamabad United" score1="190" team2="Peshawar Zalmi" score2="191" />
          <MatchBox team1="Faisalabad Wolves" score1="130" team2="Sialkot Stallions" score2="132" />
        </div>

        {/* Semi Finals */}
        <div className="flex flex-col justify-around h-[400px]">
           <MatchBox team1="Lahore Lions" score1="170" team2="Multan Sultans" score2="168" />
           <MatchBox team1="Peshawar Zalmi" score1="150" team2="Sialkot Stallions" score2="145" />
        </div>

        {/* Final */}
        <div className="flex flex-col justify-center h-[400px]">
           <div className="relative">
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 text-yellow-500">
                 <Trophy size={32} />
              </div>
              <MatchBox team1="Lahore Lions" score1="--" team2="Peshawar Zalmi" score2="--" isFinal />
           </div>
        </div>

      </div>
    </div>
  )
}

function MatchBox({ team1, score1, team2, score2, isFinal = false }: { team1: string, score1: string, team2: string, score2: string, isFinal?: boolean }) {
  return (
    <Card variant="neo" hoverEffect="glow" className={`w-48 ${isFinal ? 'border-primary shadow-primary/20 shadow-lg' : ''}`}>
      <div className="flex flex-col text-sm font-medium">
         <div className="flex justify-between items-center p-2 border-b">
            <span className="truncate">{team1}</span>
            <span className="font-bold tabular-nums">{score1}</span>
         </div>
         <div className="flex justify-between items-center p-2 bg-muted/20">
            <span className="truncate">{team2}</span>
            <span className="font-bold tabular-nums">{score2}</span>
         </div>
      </div>
    </Card>
  )
}
