#!/usr/bin/env python3
"""
Robust Playwright script - handles trust dialog appearing multiple times,
correctly opens command palette and captures output panel screenshot.
"""

import time
import os
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

SCREENSHOT_DIR = "/Users/rickwen/code/code-viewer/experiments/.progress"


def ss(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=False)
    print(f"  [ss] {name}")
    return path


def dismiss_trust_if_present(page, label=""):
    """Click 'Yes, I trust the authors' if the dialog is visible."""
    try:
        # Use role=button because the element is <a role="button">
        btn = page.locator('role=button[name="Yes, I trust the authors"]')
        if btn.count() > 0 and btn.first.is_visible():
            print(f"  [{label}] Trust dialog visible - dismissing...")
            btn.first.click()
            time.sleep(3)
            print(f"  [{label}] Trust dismissed.")
            return True
    except Exception as e:
        print(f"  [{label}] Trust check error: {e}")
    return False


def wait_for_no_dialog(page, timeout=10):
    """Wait until no monaco-dialog-box is visible."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            dialog = page.query_selector('.monaco-dialog-box')
            if not dialog or not dialog.is_visible():
                return True
        except Exception:
            return True
        time.sleep(0.5)
    return False


def open_command_palette(page):
    """Open the command palette (F1). Returns True if successful."""
    for attempt in range(5):
        # First make sure no dialog is in the way
        dismiss_trust_if_present(page, f"pre-palette-{attempt}")

        page.mouse.click(960, 400)
        time.sleep(0.4)
        page.keyboard.press('F1')
        time.sleep(2)

        try:
            widget = page.wait_for_selector('.quick-input-widget:visible', timeout=2000)
            if widget:
                print(f"  Palette opened on attempt {attempt + 1}")
                return True
        except PlaywrightTimeout:
            pass

        page.keyboard.press('Escape')
        time.sleep(0.5)

    return False


def main():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    with sync_playwright() as pw:
        print("Launching Chromium (headless)...")
        browser = pw.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
            ]
        )
        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            ignore_https_errors=True,
        )
        page = context.new_page()

        print("Navigating to http://localhost:8080 ...")
        page.goto('http://localhost:8080', wait_until='domcontentloaded', timeout=30000)
        time.sleep(3)

        # ── 1. Wait for Monaco workbench ─────────────────────────────────
        print("\n[1] Waiting for Monaco workbench...")
        try:
            page.wait_for_selector('.monaco-workbench', timeout=60000)
            print("  Monaco workbench detected.")
        except PlaywrightTimeout:
            print("  WARNING: Monaco workbench not found after 60s")
        time.sleep(5)
        ss(page, "r_01_loaded")

        # ── 2. Dismiss initial trust dialog ──────────────────────────────
        print("\n[2] Dismissing trust dialog...")
        dismiss_trust_if_present(page, "initial")
        # Also wait for any lingering dialog
        wait_for_no_dialog(page)
        time.sleep(2)
        ss(page, "r_02_trusted")

        # ── 3. Wait for extension host to fully activate ──────────────────
        print("\n[3] Waiting 12s for extension host activation...")
        time.sleep(12)
        # Dismiss trust again in case it re-appeared
        dismiss_trust_if_present(page, "post-wait")
        ss(page, "r_03_ready")

        # ── 4. Open command palette and run 'Code Viewer: Run All Experiments' ──
        print("\n[4] Opening command palette...")
        if not open_command_palette(page):
            print("  FAILED to open command palette - aborting.")
            ss(page, "r_error_no_palette")
            browser.close()
            return

        # Palette is open with '>' already in the input
        init_val = page.evaluate(
            "() => { const i = document.querySelector('.quick-input-box input'); return i ? i.value : ''; }"
        )
        print(f"  Palette input starts as: '{init_val}'")

        # Position cursor at end of '>' and type command name
        page.keyboard.press('End')
        time.sleep(0.1)

        command_name = 'Code Viewer: Run All Experiments'
        print(f"  Typing: '{command_name}'")
        for ch in command_name:
            page.keyboard.type(ch)
            time.sleep(0.04)
        time.sleep(3)

        state = page.evaluate("""
            () => {
                const input = document.querySelector('.quick-input-box input');
                const rows  = document.querySelectorAll('.quick-input-list .monaco-list-row');
                return {
                    val:   input ? input.value : '',
                    count: rows.length,
                    items: Array.from(rows).map(r => {
                        const lbl = r.querySelector('.label-name, .monaco-highlighted-label');
                        return lbl ? lbl.innerText : r.innerText.trim().substring(0, 80);
                    })
                };
            }
        """)
        print(f"  Palette: input='{state['val']}', {state['count']} result(s)")
        for item in state['items']:
            print(f"    - {item}")

        ss(page, "r_04_typed")

        if state['count'] > 0 and 'No matching results' not in str(state['items']):
            print("  Pressing Enter to run command...")
            page.keyboard.press('Enter')
            time.sleep(2)

            # Trust dialog may appear immediately after running the command
            # (workspace update / folder add triggers it)
            dismiss_trust_if_present(page, "post-run")
            time.sleep(1)
            ss(page, "r_05_command_ran")
        else:
            print("  ERROR: command not found in palette!")
            ss(page, "r_error_no_cmd")
            browser.close()
            return

        # ── 5. Ensure output panel is open ───────────────────────────────
        print("\n[5] Opening Output panel...")
        # Dismiss any dialog that may have appeared
        dismiss_trust_if_present(page, "pre-output")
        wait_for_no_dialog(page)

        page.mouse.click(960, 400)
        time.sleep(0.3)
        page.keyboard.press('Control+Shift+U')
        time.sleep(2)
        ss(page, "r_06_output_open")

        # ── 6. Wait for experiments to complete (up to 60 s) ─────────────
        print("\n[6] Waiting up to 60s for experiments to complete...")
        start = time.time()
        completed = False

        for tick in range(12):
            time.sleep(5)
            elapsed = time.time() - start

            # Dismiss any trust dialogs that appear during experiments
            dismiss_trust_if_present(page, f"tick-{tick}")

            print(f"  {elapsed:.0f}s elapsed...")
            ss(page, f"r_wait_{int(elapsed):02d}s")

            try:
                panel_text = page.evaluate("""
                    () => {
                        const out = document.querySelector('.output-view-container');
                        if (out) return out.innerText;
                        const vl = document.querySelector('.panel .view-lines');
                        if (vl) return vl.innerText;
                        return '';
                    }
                """)
                if any(kw in panel_text for kw in ['SUMMARY', 'Results written', '╚══', 'Workspace Management']):
                    print(f"  EXPERIMENTS COMPLETE at {elapsed:.0f}s!")
                    completed = True
                    break
                if len(panel_text) > 50:
                    # Show first 300 chars for monitoring
                    snippet = panel_text.strip()[:300].replace('\n', ' | ')
                    print(f"    Output so far: {snippet}")
            except Exception as e:
                print(f"  Panel read error: {e}")

        ss(page, "r_07_final")
        print(f"\n  Completed={completed}")

        # ── 7. Extract full output panel text ────────────────────────────
        print("\n=== OUTPUT PANEL CONTENT ===")
        content = page.evaluate("""
            () => {
                const sels = [
                    '.output-view-container',
                    '.panel .view-lines',
                    '.panel',
                ];
                for (const sel of sels) {
                    const el = document.querySelector(sel);
                    if (el) {
                        const text = el.innerText.trim();
                        if (text && text.length > 10 && !text.startsWith('Drag a view')) {
                            return { sel, text };
                        }
                    }
                }
                return { sel: 'none', text: 'No output captured' };
            }
        """)
        print(f"[From selector: {content['sel']}]")
        print(content['text'])

        browser.close()
        print("\nPlaywright script finished.")


if __name__ == '__main__':
    main()
