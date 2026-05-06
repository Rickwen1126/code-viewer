# iPhone Safari Web Inspector Debug Report @ 2026-04-24

## Scope

Primary goal: restore the official Mac Safari Web Inspector path for the physical iPhone, then use it to inspect the Code Viewer frontend reconnect/connecting state.

No backend/frontend service restart was performed. Reserved ports `4800` and `4801` were inspected only.

## Device And Tooling State

- Physical device: `Rick Wen's iPhone`
- iOS: `26.3.1 (23D8133)`
- UDID: `00008140-00127D4801E3001C`
- Xcode/CoreDevice status:
  - `xcrun devicectl list devices --timeout 30` listed the iPhone as `connected`
  - `xcrun xcdevice list` listed the iPhone as available over USB
  - `xcrun xctrace list devices` listed the iPhone
  - `developerModeStatus: enabled`
  - `pairingState: paired`
  - `transportType: wired`
  - `tunnelState: connected`
- Xcode Devices window also showed the physical iPhone under `Connected`.

## iPhone Settings Confirmed

The user provided screenshots confirming:

- iPhone Developer Mode: enabled
- Safari Advanced:
  - JavaScript: enabled
  - Web Inspector: enabled
  - Remote Automation: enabled

## Mac Safari Inspector Recovery

Initial Mac Safari Develop menu state:

- `Develop > Rick Wen's iPhone` submenu only showed `連線中...`
- `Develop > Connect Web Inspector` did not immediately surface page targets
- `webinspectord` had previously been stuck/not running after reset attempts

Recovery steps that worked:

1. Re-opened Xcode `Window > Devices and Simulators`.
2. Switched from `Simulators` to `Devices` and selected `Rick Wen's iPhone`.
3. Restarted Mac Safari process.
4. Confirmed `com.apple.webinspectord` respawned and was running.
5. Used `devicectl` to foreground/open the iPhone Safari target URL:
   - `http://10.0.4.5:4801`
6. Used actual Safari UI user intent against the Develop menu.

Result:

- Web Inspector opened successfully.
- Inspector title:
  - `網頁檢閱器 — Rick Wen's iPhone — Safari — 100.112.227.109 — workspaces`

Important log evidence:

- Safari/WebInspector recognized the iPhone as a physical remote-inspector-capable device:
  - `supportsRemoteInspector(YES)`
  - `deviceClass(RWIDeviceClassIPhone)`
- Before the successful open, Safari logged:
  - `RWIPairingProgressDelayedUntilUserIntent`

Interpretation:

The missing step was not another iPhone setting. The Mac Safari remote inspector path needed a real user-intent trigger after `webinspectord` and CoreDevice were healthy. AppleScript menu probing was enough to inspect state, but not always enough to satisfy Safari's user-intent gate.

## Frontend Evidence From Physical iPhone Safari

Console logs observed after Web Inspector attached:

```text
[ws] visibilitychange: hidden, ws=0, state=connecting
[vite] connecting...
[vite] connected.
[ws] state: disconnected -> connecting (0 listeners)
[ws] pageshow: persisted=false, ws=0, state=connecting
[ws] state: connecting -> connected (4 listeners)
```

Additional console error:

```text
Unhandled Promise Rejection: TypeError: undefined is not an object (evaluating 'e.optionsAutoSave')
single-file-extension-bootstrap.js:1:7741
```

This error came from a Safari Web Extension script, not Code Viewer application code.

Earlier console error observed before recovery:

```text
WebSocket connection to 'ws://100.112.227.109:4801/' failed: 網際網路連線已斷開。
```

Interpretation:

- The `ws://100.112.227.109:4801/` failure is Vite/HMR, not the Code Viewer control-plane backend on `4800`.
- The Code Viewer frontend logs showed the app-level WebSocket state recovered from `connecting` to `connected`.
- The successful transition had `4 listeners`; the earlier reconnect attempt had `0 listeners`.

## Current Frontend Suspicion

The important Code Viewer sequence is:

```text
visibilitychange: hidden, ws=0, state=connecting
state: disconnected -> connecting (0 listeners)
pageshow: persisted=false, ws=0, state=connecting
state: connecting -> connected (4 listeners)
```

This points back to the frontend singleton/state lifecycle:

- Safari can fire `visibilitychange` and `pageshow` while the singleton has `ws=0` and `state=connecting`.
- A reconnect can happen before React listeners are attached (`0 listeners`).
- Later, listeners attach and the state becomes observable again (`4 listeners`).

The stuck version to capture next is the same sequence without the final:

```text
[ws] state: connecting -> connected (...)
```

If that final transition is missing while TCP connections exist, the likely bug is not raw network reachability. It is more likely one of:

- control-plane connection promise/state remains in `connecting`
- stale `ws` reference is no longer usable but still gates reconnect
- lifecycle handler races with listener registration
- `pageshow`/`visibilitychange` re-entry starts or suppresses reconnect in the wrong state

## Physical iPhone Reproduction: Stuck Vs Normal Logs

After adding temporary diagnostic logging to `frontend/src/services/ws-client.ts`, the physical iPhone reproduced the stuck state on the Workspaces page:

```text
[ws] visibilitychange: hidden, ws=0, state=connecting
[vite] connecting...
[vite] connected.
[ws] state: disconnected -> connecting (0 listeners)
[ws] openSocket#1: url=ws://100.112.227.109:4800/ws/frontend, prevWs=undefined, state=connecting, listeners=0
[ws] pageshow: persisted=false, ws=0, state=connecting
[ws] openSocket#1: after 3000ms ws=0, state=connecting, listeners=4
```

Important missing events in the stuck run:

```text
[ws] openSocket#1: onopen ...
[ws] openSocket#1: onclose ...
[ws] openSocket#1: onerror ...
```

The user-provided iPhone screenshot showed the visible app state:

```text
Workspaces
Reconnecting... (connecting)
```

At the same time, Mac-side `lsof -nP -iTCP:4800 -sTCP:ESTABLISHED` still showed established Safari/WebKit-to-backend TCP connections, including `com.apple` WebKit client connections to `10.0.4.5:4800`.

After several manual reloads, the same page recovered. The normal run logged:

```text
[ws] visibilitychange: hidden, ws=0, state=connecting
[vite] connecting...
[vite] connected.
[ws] state: disconnected -> connecting (0 listeners)
[ws] openSocket#1: url=ws://100.112.227.109:4800/ws/frontend, prevWs=undefined, state=connecting, listeners=0
[ws] pageshow: persisted=false, ws=0, state=connecting
[ws] openSocket#1: onopen ws=1, state=connecting, listeners=4
[ws] state: connecting -> connected (4 listeners)
[ws] openSocket#1: after 3000ms ws=1, state=connected, listeners=4
```

Evidence delta:

- Stuck run: after 3 seconds, the same socket remained `WebSocket.CONNECTING (0)` and no `onopen`, `onclose`, or `onerror` fired.
- Normal run: `onopen` fired, readyState became `WebSocket.OPEN (1)`, and frontend state transitioned to `connected`.
- Listener count is not the root cause. Both runs had listeners by the 3-second mark.
- Backend reachability is not the primary root cause. TCP connections to `4800` existed while the frontend state remained stuck.

Most likely root cause:

Safari on physical iPhone can leave a newly-created WebSocket permanently stuck in `CONNECTING (0)` without firing any terminal event. The current frontend state machine treats `state === connecting` as a valid in-progress state and does not recover from it.

Precise code path:

```text
frontend/src/services/ws-client.ts
openSocket()
  setState('connecting')
  this.ws = new WebSocket(this.url)

ensureActiveConnection()
  if (this.state !== 'connected' && this.state !== 'connecting') {
    this.openSocket()
  }
```

Because `ensureActiveConnection()` explicitly skips recovery while state is `connecting`, a Safari socket stuck in `CONNECTING` can keep the UI in `Reconnecting... (connecting)` forever.

Recommended fix:

Add a per-socket connect timeout in `openSocket()`:

- Start a timer after `new WebSocket(this.url)`.
- If the timer fires and `this.ws` is still the same socket and `socket.readyState === WebSocket.CONNECTING`, treat it as stale.
- Remove handlers, close defensively, set `this.ws = null`, drain pending requests, and reconnect.
- Clear the timer on `onopen` and `onclose`.
- Keep the timeout scoped to the socket identity so old timers cannot close a newer socket.

## Next Capture Checklist

When the iPhone is stuck on `Connecting` again, keep this exact setup:

1. Keep iPhone unlocked and Safari foregrounded on the stuck page.
2. Mac Safari: `Develop > Rick Wen's iPhone > <current page>`.
3. In Console, collect:
   - all `[ws]` logs from before and after the stuck state
   - any WebSocket error mentioning `:4800`
   - ignore Vite-only `:4801` HMR errors unless they correlate with app reload
4. In Network tab, filter `WS` and capture:
   - whether `ws://<host>:4800` exists
   - whether it is open, closed, or pending
   - close code/reason if closed
5. In Console, run a read-only snapshot:

```js
console.log('CV_SNAPSHOT', JSON.stringify({
  href: location.href,
  title: document.title,
  readyState: document.readyState,
  visibilityState: document.visibilityState,
  bodyText: document.body?.innerText?.slice(0, 800),
  localStorage: Object.fromEntries(
    Object.entries(localStorage).filter(([k]) =>
      /code-viewer|debug|ws|workspace|connection/i.test(k)
    )
  ),
  sessionStorage: Object.fromEntries(
    Object.entries(sessionStorage).filter(([k]) =>
      /code-viewer|debug|ws|workspace|connection/i.test(k)
    )
  ),
}));
```

## Working Debug Environment Runbook

If `Develop > Rick Wen's iPhone` is stuck at `連線中...`:

1. Confirm iPhone settings:
   - Developer Mode enabled
   - Safari Advanced > Web Inspector enabled
   - Safari Advanced > Remote Automation enabled
2. Confirm Mac tooling:
   - `xcrun devicectl list devices --timeout 30`
   - `xcrun devicectl device info details --device "Rick Wen's iPhone"`
3. Open Xcode:
   - `Window > Devices and Simulators`
   - switch to `Devices`
   - select `Rick Wen's iPhone`
4. Restart Mac Safari if `webinspectord` is stale.
5. Confirm:
   - `launchctl print gui/$(id -u)/com.apple.webinspectord`
   - state should become `running` once Safari uses Web Inspector
6. Foreground the target page on iPhone:
   - `xcrun devicectl device process launch --device "Rick Wen's iPhone" com.apple.mobilesafari --payload-url http://10.0.4.5:4801`
7. Use the Mac Safari Develop menu with real UI user intent:
   - `Develop > Rick Wen's iPhone > <page>`
