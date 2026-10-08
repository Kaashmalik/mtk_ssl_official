# Scoring WebSocket Events

This document describes the real-time scoring WebSocket contract for services/api.

## Connection

- Endpoint: ws(s)://<host>
- Namespace: /
- Auth (if enabled):
  - Header: Authorization: Bearer <token>
  - Or handshake auth: { "token": "<token>" }
- Tenant (if enabled):
  - Header: x-tenant-id: <tenant-uuid>

## Client → Server Events

### join-match
Payload:
- matchId: string

### leave-match
Payload:
- matchId: string

### ball-added
Payload:
- matchId: string
- ballData: object

### ball-undo
Payload:
- matchId: string
- ballId: string

## Server → Client Events

### match-state
Payload:
- match state object (current scoring snapshot)

### match-state-updated
Payload:
- match state object (current scoring snapshot)

### scorer-joined
Payload:
- matchId: string
- scorerId: string

### scorer-left
Payload:
- matchId: string
- scorerId: string

### ball-added
Payload:
- matchId: string
- ball: object
- scorerId: string

### ball-removed
Payload:
- matchId: string
- ballId: string
- scorerId: string

## Notes

- Payloads are validated server-side; invalid payloads return an error event.
- Event names are centralized in services/api/src/scoring/scoring.events.ts.
