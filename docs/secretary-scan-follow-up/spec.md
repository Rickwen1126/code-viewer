# Secretary Scan Follow-up

Created: 2026-06-09 15:05
Last Updated: 2026-06-09 15:05
Status: Active decision log

## Purpose

Record the 2026-06-09 secretary scan conclusions before fixing the first confirmed bug. This document is a short decision log, not a full feature spec.

## Current Conclusions

| Item | Status | Decision / Evidence | Next Action |
|------|--------|---------------------|-------------|
| Tailscale subnet classification | Confirmed bug | `getLanIp()` returns the first non-internal IPv4 and does not exclude Tailscale `100.64.0.0/10`. `getTailscaleIp()` also used broad `100.*` matching. | Fix now and add CIDR boundary tests. |
| Backend/frontend stale detection | Split status | Extension stale detection exists in `backend/src/ws/manager.ts`; frontend entries only track selected workspace, desired watches, and connection time. | Decide whether a separate frontend heartbeat/stale model is still needed. |
| Review Queue | Deferred product decision | Review protocol and pages exist, but the tab is hidden and provider handlers still return placeholder empty lists. | Decide whether to keep it parked until chatpilot integration or promote to an active feature. |
| CPU watch issue | Structurally addressed | Demand-driven watch list is marked completed and implemented through frontend `watch.sync`, backend aggregation, and extension `watch.set` registry reconciliation. | Only re-profile if CPU symptoms return. |
| WebSocket singleton refactor | Stable | Commits `5a53409`, `06fdd66`, and `df3c2a9` landed state machine, epoch stale-event rejection, and CodeTour. Progress notes record focused E2E pass. | No immediate action. |
| Instant annotation | Stable with later reliability work | Annotation MVP was followed by active-job sync, stophook-gated completion, density validation, and targeted tests. | Monitor only; inspect run logs if live stophook cursor/ack edge cases appear. |
| Git hygiene | Needs cleanup | Local `main` is ahead of remote `main` by 37 commits, with additional modified and untracked files. | Decide push/cleanup strategy separately. |

## Fixed In This Follow-up

- Tailscale/LAN classification is the only item approved for immediate code change.
- All other items remain recorded for later prioritization.
