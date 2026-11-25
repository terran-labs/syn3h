# Overflow rooms: staging crowd test plan

Public room overflow (server/registry.ts PublicSeats) ships armed and off. It is turned on only after this test passes on staging, with the owner's authorisation. The test generates no production traffic.

## Setup

- Staging Worker with this branch, `PUBLIC_OVERFLOW = "runtime"`, `OVERFLOW_TOKEN` set, and the runtime flag on.
- The real opting-in client (assign=1, prefer, one retry), not only scripted sockets.
- Load generators on a different machine from the Worker's host.

## Waves

Run 50, then 100, then 200 arrivals within ten seconds. Every wave keeps sustained state at 20 Hz, four host bots, and churn (leaves, reloads, drops). Go to 500 only if the 200 wave recovers every arrival within the agreed join-time budget.

## Measure per wave

- Time to welcome per arrival (p50, p90, p99, max), and how many arrivals never get a welcome.
- Outcomes: seated first time, seated after one retry (4001, 4005, failed upgrade or 1006 before welcome), and fell back to a parallel universe.
- `assign_slow` lines by outcome (ok over 250 ms, late, timeout, error, nonsense).
- Largest room (must stay at 16 or fewer) and rooms of one.
- Incoming messages per room against the 1,000 a second soft limit.

## Registry capacity (from the active-count review)

The registry is one object shared by every room, so measure its load directly:

- Active-only presence deliveries: up to R/10 a second across R rooms (ACTIVE_REPORT_MS).
- Aligned reporters: rooms created together by a wave report together. Watch for bursts at the 10 s and 30 s marks.
- Unchanged 30 s refreshes: each one rewrites the full counts map to storage. Measure writes a second and the size of the counts map at R rooms.
- Assignment latency while those reports are arriving, compared with a quiet registry.
