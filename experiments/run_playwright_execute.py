#!/usr/bin/env python3
"""
Playwright execute - carefully run 'Code Viewer: Run All Experiments' and capture output.
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

        # Trust dialog
        print("[1] Trust dialog...")
        try:
            btn = page.locator('role=button[name="Yes, I trust the authors"]')
            if btn.count() > 0:
                btn.first.click()
                time.sleep(4)
                print("  Trust dismissed.")
            else:
                print("  No trust dialog found.")
        except Exception as e:
            print(f"  Trust error: {e}")

        # Wait for extension to fully activate
        print("  Waiting 10s for extension host...")
        time.sleep(10)

        # Open command palette
        print("\n[2] Opening command palette...")
        page.mouse.click(960, 400)
        time.sleep(0.5)

        palette_opened = False
        for attempt in range(4):
            page.mouse.click(960, 400)
            time.sleep(0.3)
            page.keyboard.press('F1')
            time.sleep(2)
            try:
                widget = page.wait_for_selector('.quick-input-widget:visible', timeout=2000)
                if widget:
                    palette_opened = True
                    break
            except PlaywrightTimeout:
                pass
            page.keyboard.press('Escape')
            time.sleep(0.5)

        if not palette_opened:
            print("  FAILED to open command palette!")
            browser.close()
            return

        # Verify palette starts with '>'
        init_val = page.evaluate("() => { const i = document.querySelector('.quick-input-box input'); return i ? i.value : ''; }")
        print(f"  Palette input: '{init_val}'")

        # Type AFTER '>' (which is already there)
        page.keyboard.press('End')
        time.sleep(0.1)
        command = 'Code Viewer: Run All Experiments'
        for ch in command:
            page.keyboard.type(ch)
            time.sleep(0.04)
        time.sleep(3)

        state = page.evaluate("""
            () => {
                const input = document.querySelector('.quick-input-box input');
                const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
                return {
                    val: input ? input.value : '',
                    count: rows.length,
                    items: Array.from(rows).map(r => {
                        const label = r.querySelector('.label-name, .monaco-highlighted-label');
                        return label ? label.innerText : r.innerText.trim().substring(0, 80);
                    })
                };
            }
        """)
        print(f"  Input: '{state['val']}', Results: {state['count']}")
        for item in state['items']:
            print(f"    - {item}")

        ss(page, "exec_01_typed")

        if state['count'] > 0 and 'No matching results' not in str(state['items']):
            print("  Pressing Enter to execute command...")
            page.keyboard.press('Enter')
            time.sleep(5)
            ss(page, "exec_02_entered")
        else:
            print("  ERROR: Command not found in palette!")
            browser.close()
            return

        # Open output panel (Ctrl+Shift+U)
        print("\n[3] Opening output panel...")
        page.mouse.click(960, 400)
        time.sleep(0.3)
        page.keyboard.press('Control+Shift+U')
        time.sleep(2)
        ss(page, "exec_03_output")

        # Select Code Viewer Experiments output channel
        print("  Selecting Code Viewer Experiments channel...")
        try:
            # Try to click the dropdown in the output panel
            channel_result = page.evaluate("""
                () => {
                    // Try select element first
                    const selects = document.querySelectorAll('select');
                    for (const sel of selects) {
                        for (let i = 0; i < sel.options.length; i++) {
                            if (sel.options[i].text.includes('Code Viewer')) {
                                sel.selectedIndex = i;
                                sel.dispatchEvent(new Event('change', {bubbles: true}));
                                return 'selected via select: ' + sel.options[i].text;
                            }
                        }
                    }

                    // Try the output channel switcher widget
                    const switcher = document.querySelector('.output-view-container .select-container');
                    if (switcher) return 'found select-container: ' + switcher.innerText.substring(0, 100);

                    return 'no select found';
                }
            """)
            print(f"  Channel: {channel_result}")
        except Exception as e:
            print(f"  Channel error: {e}")

        time.sleep(2)
        ss(page, "exec_04_channel")

        # Now wait for experiments to complete (they take ~15-20 seconds)
        print("\n[4] Waiting up to 60s for experiments to complete...")
        start = time.time()
        completed = False

        for i in range(12):  # 12 x 5s = 60 seconds
            time.sleep(5)
            elapsed = time.time() - start
            print(f"  {elapsed:.0f}s elapsed...")
            ss(page, f"exec_wait_{(i+1)*5:02d}s")

            # Check output panel content
            try:
                panel_text = page.evaluate("""
                    () => {
                        // Look for the view-lines in the output panel
                        const outputContainer = document.querySelector('.output-view-container');
                        if (outputContainer) return outputContainer.innerText;
                        const panel = document.querySelector('.panel .view-lines');
                        if (panel) return panel.innerText;
                        return '';
                    }
                """)

                # Check for completion markers
                if '╚' in panel_text or 'SUMMARY' in panel_text or 'Results written' in panel_text:
                    print(f"  EXPERIMENTS COMPLETED at {elapsed:.0f}s!")
                    completed = True
                    break
                elif 'Extension activated' in panel_text and len(panel_text) > 100:
                    print(f"  Output: {panel_text[:200]}")
            except Exception:
                pass

        ss(page, "exec_final")

        # Extract full output
        print("\n=== FINAL OUTPUT PANEL CONTENT ===")
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
                            return {sel, text};
                        }
                    }
                }
                return {sel: 'none', text: 'No output'};
            }
        """)
        print(f"[Source: {content['sel']}]")
        print(content['text'])

        browser.close()
        print("\nPlaywright done.")

if __name__ == '__main__':
    main()
