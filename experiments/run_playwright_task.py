#!/usr/bin/env python3
"""
Playwright script to run Code Viewer experiments in code-server.
Follows exact instructions:
1. Open http://localhost:8080 in Chromium
2. Wait for Monaco workbench
3. Handle trust dialog (a[role=button] "Yes, I trust the authors")
4. Wait 12 seconds for extension host initialization
5. Press F1 to open command palette
6. Type 'Code Viewer: Run All Experiments' (palette already has '>')
7. Press Enter
8. Wait 20 seconds
"""

import time
import os
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

SCREENSHOT_DIR = "/Users/rickwen/code/code-viewer/experiments/.progress"


def ss(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=False)
    print(f"  [screenshot] {name}")
    return path


def main():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    with sync_playwright() as pw:
        print("Step 1: Launching Chromium browser...")
        browser = pw.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        )
        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            ignore_https_errors=True
        )
        page = context.new_page()

        print("  Navigating to http://localhost:8080 ...")
        page.goto('http://localhost:8080', wait_until='domcontentloaded', timeout=30000)

        print("Step 2: Waiting for Monaco workbench to fully load...")
        try:
            page.wait_for_selector('.monaco-workbench', timeout=60000)
            print("  Monaco workbench detected.")
        except PlaywrightTimeout:
            print("  WARNING: Monaco workbench not detected within 60s, continuing anyway.")
        time.sleep(3)
        ss(page, "task_01_loaded")

        print("Step 3: Checking for trust dialog...")
        # The trust dialog has an <a role="button"> element
        try:
            # Try aria role button with text "Yes, I trust the authors"
            trust_btn = page.locator('a[role="button"]:has-text("Yes, I trust the authors")')
            count = trust_btn.count()
            print(f"  Trust button count (a[role=button]): {count}")
            if count > 0:
                trust_btn.first.click()
                print("  Clicked trust button.")
                time.sleep(3)
            else:
                # Try broader search
                trust_btn2 = page.locator('[role="button"]:has-text("Yes, I trust the authors")')
                count2 = trust_btn2.count()
                print(f"  Trust button count (any role=button): {count2}")
                if count2 > 0:
                    trust_btn2.first.click()
                    print("  Clicked trust button (any role).")
                    time.sleep(3)
                else:
                    print("  No trust dialog found, skipping.")
        except Exception as e:
            print(f"  Trust dialog error: {e}")
        ss(page, "task_02_trust_done")

        print("Step 4: Waiting 12 seconds for extension host initialization...")
        for i in range(12):
            time.sleep(1)
            if (i + 1) % 3 == 0:
                print(f"  {i + 1}s elapsed...")
        print("  Extension host wait complete.")
        ss(page, "task_03_after_12s_wait")

        print("Step 5: Pressing F1 to open command palette...")
        # Click on the editor area first to ensure focus
        page.mouse.click(960, 400)
        time.sleep(0.5)
        page.keyboard.press('F1')
        time.sleep(2)

        # Verify palette opened
        try:
            palette = page.wait_for_selector('.quick-input-widget:visible', timeout=5000)
            print("  Command palette opened successfully.")
        except PlaywrightTimeout:
            print("  WARNING: Palette not detected, trying Ctrl+Shift+P...")
            page.mouse.click(960, 400)
            time.sleep(0.3)
            page.keyboard.press('Control+Shift+P')
            time.sleep(2)
            try:
                palette = page.wait_for_selector('.quick-input-widget:visible', timeout=5000)
                print("  Command palette opened with Ctrl+Shift+P.")
            except PlaywrightTimeout:
                print("  WARNING: Palette still not visible, continuing anyway.")
        ss(page, "task_04_palette_open")

        # Check current palette state
        palette_state = page.evaluate("""
            () => {
                const input = document.querySelector('.quick-input-box input');
                const widget = document.querySelector('.quick-input-widget');
                return {
                    val: input ? input.value : 'NOT FOUND',
                    placeholder: input ? input.placeholder : '',
                    visible: widget ? (getComputedStyle(widget).display !== 'none') : false
                };
            }
        """)
        print(f"  Palette state: {palette_state}")

        print("Step 6: Typing 'Code Viewer: Run All Experiments' (palette already starts with '>')...")
        # The palette input already has '>' prefix when opened with F1
        # Just type the command name after it
        command_text = 'Code Viewer: Run All Experiments'
        page.keyboard.type(command_text, delay=50)
        time.sleep(3)

        # Check results
        results_state = page.evaluate("""
            () => {
                const input = document.querySelector('.quick-input-box input');
                const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
                return {
                    val: input ? input.value : '',
                    rowCount: rows.length,
                    rows: Array.from(rows).slice(0, 5).map(r => r.innerText.trim().substring(0, 120))
                };
            }
        """)
        print(f"  After typing - input: '{results_state['val']}', results: {results_state['rowCount']}")
        for row in results_state['rows']:
            print(f"    - {row}")
        ss(page, "task_05_typed_command")

        print("Step 7: Pressing Enter to execute command...")
        page.keyboard.press('Enter')
        time.sleep(2)
        ss(page, "task_06_after_enter")

        print("Step 8: Waiting 20 seconds for experiments to finish...")
        for i in range(20):
            time.sleep(1)
            if (i + 1) % 5 == 0:
                print(f"  {i + 1}s elapsed...")
                ss(page, f"task_07_wait_{i+1:02d}s")

        print("  Wait complete.")
        ss(page, "task_08_final")

        # Try to get any output panel content
        print("\n=== Checking output panel ===")
        page.keyboard.press('Control+Shift+U')
        time.sleep(2)
        output_content = page.evaluate("""
            () => {
                const selectors = ['.output-view-container .view-lines', '.panel .view-lines', '.panel'];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        const text = el.innerText.trim();
                        if (text && text.length > 10) {
                            return {sel, text: text.substring(0, 5000)};
                        }
                    }
                }
                return {sel: 'none', text: 'no output found'};
            }
        """)
        print(f"Output [{output_content['sel']}]:")
        print(output_content['text'])
        ss(page, "task_09_output")

        browser.close()
        print("\nPlaywright script complete.")


if __name__ == '__main__':
    main()
