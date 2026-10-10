/** A rejected response is never a duplicate acknowledgement. */
export function isScoringAcknowledgement(status: number, body: unknown, operationId: string): boolean {
  return status >= 200 && status < 300 && !!body && typeof body === "object" &&
    "ballId" in body && typeof body.ballId === "string" && body.ballId.length > 0 &&
    "clientOpId" in body && body.clientOpId === operationId;
}
