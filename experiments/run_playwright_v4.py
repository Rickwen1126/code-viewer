#!/usr/bin/env python3
"""
Playwright script v4 - targeted trust dialog + command palette for code-server.
"""

import time
import os
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

SCREENSHOT_DIR = "/Users/rickwen/code/code-viewer/experiments/.progress"

def take_screenshot(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=False)
    print(f"Screenshot: {path}")
    return path

def main():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    with sync_playwright() as pw:
        print("Launching Chromium...")
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

        print("Navigating to http://localhost:8080...")
        page.goto('http://localhost:8080', wait_until='domcontentloaded', timeout=30000)
        time.sleep(3)

        # Wait for Monaco workbench
        print("Waiting for Monaco workbench...")
        try:
            page.wait_for_selector('.monaco-workbench', timeout=60000)
            print("Monaco workbench loaded")
        except PlaywrightTimeout:
            print("WARNING: Monaco workbench timeout")
        time.sleep(5)
        take_screenshot(page, "v4_01_initial")

        # Step 1: Handle trust dialog
        print("\n=== Step 1: Handle trust dialog ===")
        # The dialog contains "Yes, I trust the authors" and "Trust folder and enable all features"
        # Try multiple approaches
        for attempt in range(3):
            try:
                # Look for the "Yes, I trust the authors" button specifically
                # In the page HTML, it shows as a button
                result = page.evaluate("""
                    () => {
                        // Try .monaco-dialog buttons
                        const allButtons = Array.from(document.querySelectorAll('button.monaco-button, button'));
                        const btn = allButtons.find(b => {
                            const text = b.textContent.trim();
                            return text.includes('Yes, I trust') || text === 'Yes' || text.includes('Trust folder');
                        });
                        if (btn) {
                            const rect = btn.getBoundingClientRect();
                            return JSON.stringify({found: true, text: btn.textContent.trim(), x: rect.x, y: rect.y, w: rect.width, h: rect.height});
                        }

                        // Also check for dialog box
                        const dialog = document.querySelector('.monaco-dialog-box, .dialog-message-container');
                        if (dialog) {
                            return JSON.stringify({found: false, dialog: dialog.innerText.substring(0, 200)});
                        }

                        return JSON.stringify({found: false, msg: 'no dialog'});
                    }
                """)
                import json
                info = json.loads(result)
                print(f"Trust button info: {info}")

                if info.get('found'):
                    x = info['x'] + info['w'] / 2
                    y = info['y'] + info['h'] / 2
                    print(f"Clicking trust button at ({x}, {y})")
                    page.mouse.click(x, y)
                    time.sleep(3)
                    take_screenshot(page, f"v4_02_after_trust_{attempt}")
                    break
                elif 'dialog' in info:
                    print(f"Dialog found but no button: {info['dialog']}")
                else:
                    print(f"No trust dialog: {info.get('msg')}")
                    break
            except Exception as e:
                print(f"Trust attempt {attempt}: {e}")
            time.sleep(1)

        # Step 2: Open command palette
        print("\n=== Step 2: Open command palette ===")
        take_screenshot(page, "v4_03_before_palette")

        # First, click on the main workbench area to ensure focus
        # The workbench is at full viewport, click in the center-ish editor area
        page.mouse.click(960, 400)
        time.sleep(0.5)
        page.mouse.click(960, 400)  # double-click to be sure
        time.sleep(0.5)

        palette_opened = False

        # Try various methods to open command palette
        for attempt in range(6):
            print(f"\nPalette attempt {attempt+1}...")

            if attempt == 0:
                # Standard F1
                page.keyboard.press('F1')
            elif attempt == 1:
                # Ctrl+Shift+P
                page.keyboard.press('Control+Shift+P')
            elif attempt == 2:
                # Click on status bar area first, then F1
                page.mouse.click(100, 1060)  # bottom status bar
                time.sleep(0.3)
                page.keyboard.press('F1')
            elif attempt == 3:
                # Try Meta+Shift+P (macOS)
                page.keyboard.press('Meta+Shift+P')
            elif attempt == 4:
                # Click on the editor title area
                page.mouse.click(500, 45)  # tab bar area
                time.sleep(0.3)
                page.keyboard.press('F1')
            elif attempt == 5:
                # Try using the "Show All Commands" button visible in the top menu area
                # The page shows "Show All Commands⇧⌘P" hint
                page.mouse.click(960, 10)  # top of workbench
                time.sleep(0.3)
                page.keyboard.press('F1')

            time.sleep(2)
            take_screenshot(page, f"v4_palette_attempt_{attempt+1}")

            # Check if palette opened
            try:
                widget = page.query_selector('.quick-input-widget')
                if widget and widget.is_visible():
                    print(f"SUCCESS: Command palette opened on attempt {attempt+1}!")
                    palette_opened = True
                    break
            except Exception:
                pass

            # Close any partial state
            page.keyboard.press('Escape')
            time.sleep(0.3)

        if not palette_opened:
            # Last resort: click the "Open Command Palette" text in the welcome screen
            print("\nTrying welcome screen 'Open Command Palette' link...")
            try:
                # Get all clickable elements
                elements = page.evaluate("""
                    () => {
                        const results = [];
                        const allEls = document.querySelectorAll('a, button, [role="button"], .action-item');
                        for (const el of allEls) {
                            if (el.textContent.includes('Command Palette') || el.textContent.includes('Show All')) {
                                const rect = el.getBoundingClientRect();
                                if (rect.width > 0 && rect.height > 0) {
                                    results.push({
                                        tag: el.tagName,
                                        text: el.textContent.trim().substring(0, 50),
                                        x: rect.x,
                                        y: rect.y,
                                        w: rect.width,
                                        h: rect.height
                                    });
                                }
                            }
                        }
                        return results;
                    }
                """)
                print(f"Found {len(elements)} command palette related elements:")
                for el in elements[:5]:
                    print(f"  {el}")
                    # Click the first visible one
                    if el['w'] > 0 and el['h'] > 0:
                        cx = el['x'] + el['w'] / 2
                        cy = el['y'] + el['h'] / 2
                        print(f"  Clicking at ({cx}, {cy})")
                        page.mouse.click(cx, cy)
                        time.sleep(2)
                        try:
                            widget = page.query_selector('.quick-input-widget')
                            if widget and widget.is_visible():
                                print("Command palette opened via element click!")
                                palette_opened = True
                                break
                        except Exception:
                            pass
            except Exception as e:
                print(f"Element click error: {e}")

        if palette_opened:
            print("\n=== Step 3: Type and execute command ===")
            # Clear the input and type the command
            time.sleep(0.5)
            page.keyboard.press('Control+a')
            time.sleep(0.2)
            # Clear any '>' prefix
            page.keyboard.press('Delete')
            time.sleep(0.2)

            command = 'Code Viewer: Run All Experiments'
            print(f"Typing: {command}")
            page.keyboard.type(command, delay=60)
            time.sleep(2.5)
            take_screenshot(page, "v4_command_typed")

            # Show what's in the palette
            try:
                rows = page.query_selector_all('.quick-input-list .monaco-list-row')
                print(f"Palette shows {len(rows)} results:")
                for row in rows[:8]:
                    label = row.query_selector('.label-name, .monaco-highlighted-label')
                    if label:
                        print(f"  - {label.inner_text()}")
            except Exception as e:
                print(f"Results read error: {e}")

            print("Pressing Enter...")
            page.keyboard.press('Enter')
            time.sleep(3)
            take_screenshot(page, "v4_after_enter")
        else:
            print("\nCommand palette could not be opened after all attempts!")
            print("Trying to trigger command via terminal...")

            # Open integrated terminal
            page.mouse.click(960, 400)
            time.sleep(0.3)
            page.keyboard.press('Control+grave')  # Ctrl+`
            time.sleep(2)
            take_screenshot(page, "v4_terminal")

            # Check if terminal opened
            try:
                term = page.wait_for_selector('.terminal.xterm, .xterm-viewport', timeout=3000)
                if term and term.is_visible():
                    print("Terminal opened! But we need VS Code command, not shell command.")
            except PlaywrightTimeout:
                print("Terminal not found")

        # Step 4: Show output panel
        print("\n=== Step 4: Show Output panel ===")
        page.keyboard.press('Control+Shift+U')
        time.sleep(2)
        take_screenshot(page, "v4_output_panel_open")

        # Step 5: Wait for experiments
        print("\n=== Step 5: Wait 25s for experiments ===")
        for i in range(5):
            time.sleep(5)
            elapsed = (i + 1) * 5
            take_screenshot(page, f"v4_wait_{elapsed:02d}s")
            print(f"  {elapsed}s elapsed")
            try:
                text = page.evaluate("() => document.body.innerText")
                for kw in ['Results saved', 'experiment-results.json', 'SUMMARY', 'All experiments']:
                    if kw in text:
                        print(f"Found completion keyword: '{kw}' at {elapsed}s!")
                        break
            except Exception:
                pass

        take_screenshot(page, "v4_final")

        # Extract output
        print("\n=== Output panel content ===")
        try:
            content = page.evaluate("""
                () => {
                    const sels = ['.output-view-container', '.panel .view-lines', '.panel'];
                    for (const sel of sels) {
                        const el = document.querySelector(sel);
                        if (el && el.innerText && el.innerText.trim().length > 5) {
                            return {sel, text: el.innerText.substring(0, 5000)};
                        }
                    }
                    return {sel: 'body', text: document.body.innerText.substring(0, 2000)};
                }
            """)
            print(f"[{content['sel']}]:")
            print(content['text'])
        except Exception as e:
            print(f"Content error: {e}")

        browser.close()
        print("\nPlaywright done.")

if __name__ == '__main__':
    main()
