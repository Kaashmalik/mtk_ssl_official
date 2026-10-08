/**
 * Scoring WebSocket gateway module.
 *
 * STATUS: Implemented but NOT registered in app.module.ts.
 *
 * This module contains a real WebSocket gateway (ScoringGateway) for live
 * scoring, but it is deliberately not wired into the app because live scoring
 * is handled by the separate `services/scoring-service` (which has its own
 * Kafka + Redis + WS infrastructure).
 *
 * To activate this module in `services/api`, import it in app.module.ts.
 * To retire it, delete this directory and consolidate into scoring-service.
 *
 * See docs/architecture/BACKEND_UNIFICATION_DECISION.md.
 */
import { Module } from "@nestjs/common";
import { ScoringGateway } from "./scoring.gateway";
import { ScoringService } from "./scoring.service";

@Module({
  providers: [ScoringGateway, ScoringService],
  exports: [ScoringService],
})
export class ScoringModule {}

