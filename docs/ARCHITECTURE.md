# CurbKey — Architecture

High-level system shape, data flow, and outbox pattern.

---

## System overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CurbKey                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Frontend (Next.js)          │  Backend (Flask)         │  Postgres      │
│  - Guest /t/[token]          │  - REST API              │  - venues      │
│  - Valet /valet              │  - JWT (Valet/Manager)    │  - exits/zones │
│  - Manager /manager          │  - SSE /t/[token]/events │  - tickets     │
│  - Login /login              │  - Scheduler tick        │  - requests    │
│                              │  - Notif outbox + drain  │  - status_events│
│                              │                          │  - notif_outbox│
└──────────────────────────────┴──────────────────────────┴────────────────┘
         │                                  │
         │  NEXT_PUBLIC_API_BASE → :5001     │
         └──────────────────────────────────┘
```

---

## Roles and entrypoints

| Role    | Auth        | Entrypoint        | Main actions                          |
|---------|-------------|-------------------|----------------------------------------|
| Guest   | Ticket token only | `/t/<token>`      | Request car, schedule, see status, SSE |
| Valet   | JWT (VALET) | `/valet`          | List requests (venue), set Retrieving/Ready/Picked up |
| Manager | JWT (MANAGER) | `/manager`      | Demo seed/reset, create ticket, scheduler tick, drain, retry |

---

## Core flows

### 1. Guest requests car (immediate or scheduled)

```
Guest (browser)                Backend                      DB
     │                             │                         │
     │  POST /t/<token>/request    │                         │
     │  { exit_id, delay_minutes? } │                         │
     │ ──────────────────────────► │  CarRequest             │
     │                             │  status=SCHEDULED or    │
     │                             │  REQUESTED              │
     │                             │  StatusEvent            │
     │                             │ ──────────────────────► │
     │                             │  queue_and_send (opt)   │
     │  201 { request }            │ ──────────────────────► │
     │ ◄────────────────────────── │                         │
```

- **Idempotency:** One active request per ticket (SCHEDULED + REQUESTED count as active); repeat POST returns existing request with 200.

### 2. Scheduler: SCHEDULED → REQUESTED

```
Cron / script                  Backend                      DB
     │                             │                         │
     │  POST /api/scheduler/tick   │                         │
     │  Authorization: Bearer JWT  │  SELECT ... FOR UPDATE  │
     │ ──────────────────────────► │  SKIP LOCKED            │
     │                             │  scheduled_for <= now   │
     │                             │  UPDATE status=REQUESTED│
     │                             │  StatusEvent            │
     │                             │  queue_and_send         │
     │  200 { flipped: N }         │ ──────────────────────► │
     │ ◄────────────────────────── │                         │
```

- **Concurrency-safe:** Row lock (`FOR UPDATE SKIP LOCKED`) + in-loop status check so multiple workers don’t double-trigger.

### 3. Valet updates status

```
Valet (browser)                Backend                      DB
     │                             │                         │
     │  PATCH /api/requests/:id/   │                         │
     │       status                │  ALLOWED_TRANSITIONS    │
     │  { status: "READY" }        │  StatusEvent            │
     │ ──────────────────────────► │  (READY → notif)        │
     │                             │ ──────────────────────► │
     │  200 { request }            │                         │
     │ ◄────────────────────────── │                         │
```

- **State machine:** REQUESTED → RETRIEVING → READY → PICKED_UP (auto → CLOSED). SCHEDULED → REQUESTED or CANCELED only.

### 4. Notifications (outbox + drain)

```
App (status change)            Outbox table                 Drain (manager/cron)
     │                             │                             │
     │  queue_and_send(...)         │                             │
     │  INSERT state=PENDING        │                             │
     │ ──────────────────────────► │                             │
     │                             │  POST /api/notifs/drain     │
     │                             │  ?state=PENDING&limit=50    │
     │                             │ ◄───────────────────────────│
     │                             │  send_outbox_item()         │
     │                             │  UPDATE state=SENT|FAILED   │
     │                             │ ──────────────────────────► │
     │                             │                             │
     │                             │  POST /api/notifs/retry     │
     │                             │  ?older_than_seconds=30     │
     │                             │  FAILED → PENDING,          │
     │                             │  retry_count += 1           │
     │                             │ ◄───────────────────────────│
```

- **Outbox pattern:** One source of truth in DB; drain sends and updates state; retry re-queues FAILED with backoff (older_than_seconds). Idempotent delivery is provider-specific (e.g. provider_id / dedup).

---

## Data model (summary)

- **Venue** → Exits, Zones (zone.default_exit_id), Users (Valet/Manager), Tickets.
- **Ticket** → token (guest link), venue_id; Requests.
- **Request** → ticket_id, exit_id, status, scheduled_for; StatusEvents.
- **StatusEvent** → request_id, from_status, to_status, note (audit trail).
- **NotificationOutbox** → ticket_id, request_id, state (PENDING/SENT/FAILED), retry_count; drained by manager/cron.
- **NotificationSubscription** → ticket_id, channel, target (guest subscribes for notifs).

---

## Key endpoints (reference)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /auth/seed | — | Bootstrap venue + manager |
| POST | /auth/login | — | JWT |
| GET  | /t/:token | token | Ticket + latest request |
| POST | /t/:token/request | token | Request car (exit_id, delay_minutes?) |
| GET  | /t/:token/events | token | SSE status stream |
| POST | /api/demo/seed | Manager | Venue + exits + zones (+ valet) |
| POST | /api/demo/tickets | Manager | Create ticket → token, guest_url |
| POST | /api/demo/reset | Manager | Wipe tickets/requests/events/outbox |
| POST | /api/scheduler/tick | Manager | SCHEDULED → REQUESTED (due) |
| GET  | /api/requests | Valet/Manager | List requests (venue_id, filter) |
| PATCH| /api/requests/:id/status | Valet/Manager | Transition status |
| POST | /api/notifs/drain | Manager | Process outbox (?state=PENDING\|FAILED) |
| POST | /api/notifs/retry | Manager | FAILED → PENDING, retry_count++ |
