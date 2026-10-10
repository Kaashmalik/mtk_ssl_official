import { z } from 'zod';

export const deliveryCommandSchema = z.object({
  matchId: z.string().uuid(),
  inningsId: z.string().uuid(),
  over: z.number().int().min(0),
  ball: z.number().int().min(1).max(6),
  runs: z.number().int().min(0).max(7),
  batsmanId: z.string().uuid(),
  bowlerId: z.string().uuid(),
  clientOpId: z.string().trim().min(1).max(200),
  extras: z.object({
    type: z.enum(['wide', 'noball', 'bye', 'legbye']),
    runs: z.number().int().min(1).max(7),
  }).optional(),
  wicket: z.object({
    type: z.enum(['bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'retired', 'retired_hurt']),
    playerId: z.string().uuid(),
    fielderId: z.string().uuid().optional(),
  }).optional(),
});

export type DeliveryCommand = z.infer<typeof deliveryCommandSchema>;

/** Stable identity excludes transport timestamps and object key ordering. */
export function deliveryFingerprint(command: DeliveryCommand): string {
  return JSON.stringify([
    command.matchId, command.inningsId, command.over, command.ball, command.runs,
    command.batsmanId, command.bowlerId, command.extras?.type ?? null,
    command.extras?.runs ?? 0, command.wicket?.type ?? null,
    command.wicket?.playerId ?? null, command.wicket?.fielderId ?? null,
  ]);
}
