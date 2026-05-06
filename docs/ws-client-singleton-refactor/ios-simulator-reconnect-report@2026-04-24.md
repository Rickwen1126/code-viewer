# iOS Simulator Reconnect Report

Created: 2026-04-24
Last Updated: 2026-04-24
Status: Evidence collected; target symptom not reproduced in this run

## Scope

This run followed `spike-ios-simulator@2026-04-24.md` with the first goal of reproducing the Safari/iOS symptom where a workspace is already open, the frontend falls into `Reconnect`, and it never recovers.

Environment:

- Repo: `/Users/rickwen/code/code-viewer`
- Simulator: iPhone 16e, iOS 26.2, already booted
- Frontend URL: `http://10.0.4.5:4801`
- Backend health: `http://127.0.0.1:4800/admin/workspaces`
- Services: existing local `4800` backend and `4801` frontend were used as-is. They were not killed, restarted, rebound, or proxied.

## Tooling Notes

- `xcrun simctl` needed sandbox escalation to access CoreSimulatorService.
- Computer Use could not control Simulator because macOS rejected Apple Events with `Sender process is not authenticated`.
- AppleScript keyboard control also failed with `System Events ... not allowed to send keystrokes`.
- Retrying AppleScript with sandbox escalation did not change the result. The failure is macOS TCC/Accessibility authorization, not Codex command sandboxing.
- Retrying Computer Use after user approval still returned `Apple event error -10000: Sender process is not authenticated`.
- Physical iPhone retry: `system_profiler SPUSBDataType` saw a USB iPhone (`Product ID: 0x12a8`, `Vendor ID: 0x05ac`, serial `0000814000127D4801E3001C`), but Xcode/CoreDevice tooling did not expose it as a usable device:
  - `xcrun devicectl list devices --timeout 30` timed out waiting for CoreDeviceService.
  - `xcrun xctrace list devices` listed only the Mac.
  - `xcrun xcdevice list` listed only `My Mac`.
  - `rvictl -l` returned `Could not get list of devices`.
  - `idevice_id`, `ios_webkit_debug_proxy`, `pymobiledevice3`, and `cfgutil` were not installed.
- Safari AppleScript can read Safari window names, but `System Events` still cannot access Safari menus because `osascript` has no Accessibility permission. This blocks scripted access to Safari Develop -> iPhone Web Inspector.
- Safari console logs were not captured because Web Inspector GUI automation was blocked and `simctl openurl` rejects `javascript:` URLs. This is a data gap, not evidence that no frontend lifecycle event occurred.
- System `log stream` was too noisy for useful frontend-level evidence. It did show WebKit `ProcessSuspension` activity around the run, but not app-level `[ws]` console lines.

## Evidence Artifacts

- `evidence/ios-simulator-baseline@2026-04-24.png`
- `evidence/ios-simulator-after-30s@2026-04-24.png`
- `evidence/ios-simulator-after-30s-retry@2026-04-24.png`
- `evidence/ios-simulator-after-2min@2026-04-24.png`

All screenshots show the same already-open `code-viewer` workspace in file view, rendering `app.tsx`, without a visible stuck `Reconnect` state.

## Service Baseline

Before running the experiments:

- `4800` was listening.
- `4801` was listening.
- `/admin/workspaces` returned `status: ok`.
- Workspace `code-viewer` was connected with extension version `0.0.5`.

After each foreground recovery, `/admin/workspaces` still returned connected workspaces and fresh heartbeats. This means the VS Code extension side and backend authority stayed alive during these tests.

## Experiments

| Experiment | Action | Result | Reproduced stuck `Reconnect`? |
|---|---|---|---|
| Baseline | Opened `http://10.0.4.5:4801` in Simulator Safari | Existing `code-viewer` workspace file view loaded | No |
| 30s background | `launch com.apple.springboard`, wait 30s, `launch com.apple.mobilesafari` | File view restored; backend workspaces still connected | No |
| 30s background retry after privilege attempt | Same as 30s background, after retrying GUI control with escalation | File view restored; backend workspaces still connected | No |
| Rapid switch | 5 loops of SpringBoard/Safari with 1.5s waits | File view restored; backend workspaces still connected | No |
| 2min background | SpringBoard for 120s, then Safari foreground | File view restored; backend workspaces still connected | No |

## Q1-Q5 Status

1. Q1: `visibilitychange` vs `ws.onclose` order was not measurable because Safari Web Inspector console was not captured.
2. Q2: post-background `ws.readyState` was not measurable from the page console.
3. Q3: BFCache `pageshow persisted` was not tested in this pass.
4. Q4: rapid switching did not produce a visible stuck state, but concurrent `openSocket()` could not be proven or disproven without console instrumentation.
5. Q5: the observed run did not demonstrate a transport failure or state-notification failure. It only shows that these Simulator/Safari background paths did not trigger the stuck symptom.

## Code-Level Suspicions To Keep

The run did not reproduce the bug, but the existing code still has the same structural risks described in `survey-conclusion@2026-04-23.md`:

- `frontend/src/services/ws-client.ts` still has multiple async writers around one mutable `this.ws`: `openSocket()`, `onclose`, `ensureActiveConnection()`, `probeConnection()`, `forceReconnect()`, and `disconnect()`.
- `forceReconnect()` nulls handlers and replaces `this.ws`, but there is no socket epoch/version guard. A stale event from an older socket can still be hard to reason about if it fires after a newer socket has been created.
- `connect()` returns early while state is `connecting`, `connected`, or `reconnecting`. If the app-level route/workspace layer expects a fresh connection attempt while the client is stuck in a stale reconnect state, the call will be ignored.
- `probeConnection()` uses `request('ping')` and the shared pending request map. If probe timeout, foreground recovery, and an existing reconnect timer overlap, the control flow is still spread across several paths.

## Current Assessment

This pass did not reproduce the user-facing stuck `Reconnect` symptom in iOS Simulator Safari 26.2 using the existing running dev services.

The useful finding is narrower: simple background/foreground recovery, 2-minute backgrounding, and rapid SpringBoard/Safari switching are not sufficient reproductions in this environment. The likely next reproduction path needs stronger instrumentation or a harsher transport break:

- Add a temporary in-page log buffer for `[ws]` lifecycle events so Simulator Safari logs can be extracted without Web Inspector.
- Run the same tests with PWA standalone mode, not only Safari tab mode.
- Test a controlled network interruption between Simulator Safari and backend `4800` without restarting or killing the protected local services.
- Add socket identity/epoch logging before changing implementation, so stale event writers can be proven rather than inferred.
