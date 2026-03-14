#!/usr/bin/env python3
"""
Playwright correct - keep '>' prefix, type command name after it.
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

def main():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    with sync_playwright() as pw:
        print("Launching Chromium...")
        browser = pw.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        )
        context = browser.new_context(viewport={'width': 1920, 'height': 1080}, ignore_https_errors=True)
        page = context.new_page()
        page.goto('http://localhost:8080', wait_until='domcontentloaded', timeout=30000)
        time.sleep(3)

        print("Waiting for Monaco workbench...")
        try:
            page.wait_for_selector('.monaco-workbench', timeout=60000)
        except PlaywrightTimeout:
            pass
        time.sleep(8)
        ss(page, "c_01_loaded")

        # Step 1: Trust dialog
        print("\n[1] Trust dialog...")
        try:
            btn = page.locator('role=button[name="Yes, I trust the authors"]')
            if btn.count() > 0:
                btn.first.click()
                time.sleep(3)
                print("  Trust dismissed.")
        except Exception as e:
            print(f"  Trust error: {e}")
        ss(page, "c_02_trusted")

        # Extra wait for extension activation
        print("  Waiting 10s for extension host...")
        time.sleep(10)
        ss(page, "c_03_ready")

        # Step 2: Open command palette
        print("\n[2] Opening command palette...")
        page.mouse.click(960, 400)
        time.sleep(0.5)

        palette_opened = False
        for attempt in range(4):
            if attempt == 0:
                page.keyboard.press('F1')
            elif attempt == 1:
                page.mouse.click(960, 400)
                time.sleep(0.2)
                page.keyboard.press('Control+Shift+P')
            elif attempt == 2:
                page.mouse.click(960, 400)
                time.sleep(0.2)
                page.keyboard.press('Meta+Shift+P')
            else:
                page.mouse.click(960, 400)
                time.sleep(0.2)
                page.keyboard.press('F1')

            time.sleep(2)
            try:
                widget = page.wait_for_selector('.quick-input-widget:visible', timeout=2000)
                if widget:
                    print(f"  Palette opened on attempt {attempt+1}")
                    palette_opened = True
                    break
            except PlaywrightTimeout:
                pass
            page.keyboard.press('Escape')
            time.sleep(0.3)

        if not palette_opened:
            print("  FAILED to open command palette!")
            browser.close()
            return

        ss(page, "c_04_palette")

        # Step 3: Type command AFTER the existing '>'
        # The palette input already shows '>' - just type the command name
        print("\n[3] Typing command...")

        # Get current input value (should be '>')
        init_val = page.evaluate("() => { const i = document.querySelector('.quick-input-box input'); return i ? i.value : ''; }")
        print(f"  Current input: '{init_val}'")

        # Move cursor to end and type the command name (without '>' since it's already there)
        page.keyboard.press('End')
        time.sleep(0.1)

        command = 'Code Viewer: Run All Experiments'
        print(f"  Typing: '{command}'")
        for ch in command:
            page.keyboard.type(ch)
            time.sleep(0.03)
        time.sleep(3)

        # Check results
        state = page.evaluate("""
            () => {
                const input = document.querySelector('.quick-input-box input');
                const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
                return {
                    val: input ? input.value : '',
                    rowCount: rows.length,
                    items: Array.from(rows).map(r => {
                        const label = r.querySelector('.label-name, .monaco-highlighted-label');
                        return label ? label.innerText : r.innerText.trim().substring(0, 80);
                    })
                };
            }
        """)
        print(f"  Input: '{state['val']}', Results: {state['rowCount']}")
        for item in state['items']:
            print(f"    - {item}")

        ss(page, "c_05_typed")

        if state['rowCount'] > 0 and 'No matching results' not in str(state['items']):
            print("\n[4] Pressing Enter to run command...")
            page.keyboard.press('Enter')
            time.sleep(3)
            ss(page, "c_06_entered")
            print("  Command executed!")
        else:
            print("\n  Still no matching results. Something is wrong.")
            # Look at what the palette actually shows for debugging
            full_state = page.evaluate("""
                () => {
                    const widget = document.querySelector('.quick-input-widget');
                    return widget ? widget.innerText.substring(0, 500) : 'no widget';
                }
            """)
            print(f"  Palette widget text: {full_state}")
            ss(page, "c_debug")

        # Step 4: Show output panel
        print("\n[4] Opening output panel...")
        page.keyboard.press('Escape')
        time.sleep(0.5)
        page.mouse.click(960, 400)
        time.sleep(0.3)
        page.keyboard.press('Control+Shift+U')
        time.sleep(2)
        ss(page, "c_07_output")

        # Switch to Code Viewer Experiments channel
        try:
            page.evaluate("""
                () => {
                    const selects = document.querySelectorAll('select');
                    for (const sel of selects) {
                        for (let i = 0; i < sel.options.length; i++) {
                            if (sel.options[i].text.includes('Code Viewer')) {
                                sel.selectedIndex = i;
                                sel.dispatchEvent(new Event('change', {bubbles: true}));
                                return;
                            }
                        }
                    }
                }
            """)
        except Exception:
            pass

        time.sleep(1)
        ss(page, "c_08_channel_selected")

        # Step 5: Wait for experiments
        print("\n[5] Waiting 30s for experiments...")
        for i in range(6):
            time.sleep(5)
            elapsed = (i + 1) * 5
            print(f"  {elapsed}s elapsed...")
            ss(page, f"c_wait_{elapsed:02d}s")

            try:
                body = page.evaluate("() => document.body.innerText")
                for kw in ['Results written to', 'SUMMARY', '╚', 'experiment-results.json written']:
                    if kw in body:
                        print(f"    Found: '{kw}'!")
                        break
            except Exception:
                pass

        ss(page, "c_final")

        # Extract output
        print("\n=== OUTPUT PANEL ===")
        content = page.evaluate("""
            () => {
                // Try multiple selectors
                const sels = [
                    '.output-view-container',
                    '.panel .view-lines',
                    '.panel',
                ];
                for (const sel of sels) {
                    const el = document.querySelector(sel);
                    if (el) {
                        const text = el.innerText.trim();
                        if (text && text.length > 10 && !text.includes('Drag a view here')) {
                            return {sel, text: text.substring(0, 15000)};
                        }
                    }
                }
                return {sel: 'none', text: 'No output'};
            }
        """)
        print(f"[From: {content['sel']}]")
        print(content['text'])

        browser.close()
        print("\nPlaywright done.")

if __name__ == '__main__':
    main()
