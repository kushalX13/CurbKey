# CurbKey (Ticketless Valet)

## Roles
- Guest: no login, uses ticket token link/QR
- Valet: staff login
- Manager: dashboard login

## Core flow (MVP)
1) Ticket created → QR/token
2) Guest requests car + selects Exit
3) Valet updates status: REQUESTED → RETRIEVING → READY → PICKED_UP
4) Guest sees live updates via SSE

## Entities
Venue, Exit, Ticket, Request, StatusEvent, User

## Statuses
REQUESTED, RETRIEVING, READY, PICKED_UP
