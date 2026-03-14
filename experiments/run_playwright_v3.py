#!/usr/bin/env python3
"""
Playwright script v3 - fixes trust dialog and command palette for code-server.
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
        print("Launching Chromium (headless=False for keyboard support)...")
        # Use headless=False for better keyboard event support, but with a virtual display
        # Actually use headless=True but with xvfb... let's try new_cdp_session approach
        browser = pw.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--disable-blink-features=AutomationControlled',
            ]
        )

        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            ignore_https_errors=True,
        )
        page = context.new_page()
        page.on('console', lambda msg: print(f"  [browser] {msg.type}: {msg.text[:100]}") if msg.type != 'warning' else None)

        print("Navigating to http://localhost:8080...")
        page.goto('http://localhost:8080', wait_until='domcontentloaded', timeout=30000)
        time.sleep(3)
        print(f"URL: {page.url}")

        # Wait for Monaco workbench
        print("Waiting for Monaco workbench...")
        try:
            page.wait_for_selector('.monaco-workbench', timeout=60000)
        except PlaywrightTimeout:
            print("WARNING: Monaco workbench timeout")
        time.sleep(5)
        take_screenshot(page, "v3_01_loaded")

        # Handle trust dialog - look for and click trust button
        print("\nHandling trust dialog...")
        try:
            # The trust dialog text is visible in page source
            # Try clicking the trust button using exact text
            trust_result = page.evaluate("""
                () => {
                    // Find all buttons
                    const buttons = Array.from(document.querySelectorAll('button, .monaco-button'));
                    console.log('All buttons:', buttons.map(b => b.textContent.trim()).join(' || '));

                    // Look for trust button
                    const trustBtn = buttons.find(b =>
                        b.textContent.includes('Yes, I trust the authors') ||
                        b.textContent.includes('Trust folder and enable')
                    );

                    if (trustBtn) {
                        trustBtn.click();
                        return 'clicked trust: ' + trustBtn.textContent.trim();
                    }

                    // Try to find dialog-specific buttons
                    const dialogBtns = document.querySelectorAll('.dialog-buttons-row button, .monaco-dialog button');
                    console.log('Dialog buttons:', Array.from(dialogBtns).map(b => b.textContent.trim()).join(' || '));
                    const trustDialogBtn = Array.from(dialogBtns).find(b =>
                        b.textContent.includes('Yes') || b.textContent.includes('Trust')
                    );
                    if (trustDialogBtn) {
                        trustDialogBtn.click();
                        return 'clicked dialog trust: ' + trustDialogBtn.textContent.trim();
                    }

                    return 'no trust button found';
                }
            """)
            print(f"Trust dialog result: {trust_result}")
        except Exception as e:
            print(f"Trust dialog error: {e}")

        time.sleep(2)
        take_screenshot(page, "v3_02_after_trust")

        # Try to click on the workbench editor area to focus it
        print("\nFocusing workbench...")
        try:
            page.mouse.click(960, 300)
            time.sleep(0.5)
            page.mouse.click(960, 300)
            time.sleep(0.5)
        except Exception as e:
            print(f"Click error: {e}")

        # Try to dispatch keyboard events directly to the document
        print("\nAttempting to open command palette via key dispatch...")

        # Method 1: Try pressing F1 after focusing the workbench div
        for attempt in range(3):
            print(f"Attempt {attempt+1}: trying keyboard shortcuts...")

            # Click on a safe area in the editor
            page.mouse.click(960, 400)
            time.sleep(0.3)

            if attempt == 0:
                page.keyboard.press('F1')
            elif attempt == 1:
                # Try dispatching the event via JavaScript
                page.evaluate("""
                    () => {
                        const event = new KeyboardEvent('keydown', {
                            key: 'F1',
                            code: 'F1',
                            keyCode: 112,
                            which: 112,
                            bubbles: true,
                            cancelable: true
                        });
                        document.activeElement.dispatchEvent(event);
                        document.dispatchEvent(event);
                        window.dispatchEvent(event);
                    }
                """)
            else:
                page.keyboard.press('Control+Shift+P')

            time.sleep(2)

            # Check if palette is open
            try:
                palette = page.wait_for_selector('.quick-input-widget:visible', timeout=2000)
                if palette:
                    print(f"Command palette opened on attempt {attempt+1}!")
                    take_screenshot(page, f"v3_palette_open_{attempt+1}")
                    break
            except PlaywrightTimeout:
                take_screenshot(page, f"v3_palette_attempt_{attempt+1}")
                page.keyboard.press('Escape')
                time.sleep(0.5)
        else:
            # All palette attempts failed - try via the "Open Command Palette" button on Welcome screen
            print("\nTrying 'Open Command Palette' button on welcome screen...")

            # Looking at the page source, there's "Open Command PaletteTip: Use keyboard shortcut ⇧⌘P"
            # Let's try clicking it precisely
            try:
                # Find the element with exact text
                cp_element = page.locator('text="Open Command Palette"').first
                if cp_element:
                    # Get its bounding box and click it
                    bb = cp_element.bounding_box()
                    if bb:
                        print(f"Found 'Open Command Palette' at {bb}")
                        page.mouse.click(bb['x'] + bb['width']/2, bb['y'] + bb['height']/2)
                        time.sleep(2)
                        try:
                            palette = page.wait_for_selector('.quick-input-widget:visible', timeout=3000)
                            if palette:
                                print("Command palette opened via welcome screen button!")
                                take_screenshot(page, "v3_palette_welcome_button")
                        except PlaywrightTimeout:
                            take_screenshot(page, "v3_palette_welcome_failed")
            except Exception as e:
                print(f"Welcome button click error: {e}")

        # Check if command palette is open
        palette_open = False
        try:
            widget = page.query_selector('.quick-input-widget')
            if widget and widget.is_visible():
                palette_open = True
                print("Command palette is open!")
        except Exception:
            pass

        if palette_open:
            print("\nTyping command...")
            page.keyboard.press('Control+a')
            time.sleep(0.2)
            page.keyboard.type('Code Viewer: Run All Experiments', delay=60)
            time.sleep(2.5)
            take_screenshot(page, "v3_command_typed")

            # Read results
            try:
                rows = page.query_selector_all('.quick-input-list .monaco-list-row')
                print(f"Palette results: {len(rows)} items")
                for row in rows[:5]:
                    label = row.query_selector('.label-name, .monaco-highlighted-label')
                    if label:
                        print(f"  - {label.inner_text()}")
            except Exception as e:
                print(f"Results error: {e}")

            print("Pressing Enter to run command...")
            page.keyboard.press('Enter')
            time.sleep(3)
            take_screenshot(page, "v3_after_enter")
        else:
            print("\nCommand palette could not be opened. Trying alternative approach...")
            # Try to trigger the command via the code-server API or URL
            # code-server supports running commands via special URLs or the integrated terminal
            print("Trying to use the integrated terminal to trigger the command...")

            # Open terminal with Ctrl+`
            page.keyboard.press('Control+`')
            time.sleep(2)
            take_screenshot(page, "v3_terminal_attempt")

            terminal_visible = False
            try:
                terminal = page.wait_for_selector('.terminal.xterm', timeout=3000)
                if terminal and terminal.is_visible():
                    terminal_visible = True
                    print("Terminal opened!")
            except PlaywrightTimeout:
                pass

            if not terminal_visible:
                print("Terminal not visible, trying another approach...")
                # Try the "Show All Commands" button visible in the page text
                # The page shows "Show All Commands⇧⌘P" in the UI
                try:
                    show_all = page.locator('text="Show All Commands"').first
                    bb = show_all.bounding_box()
                    if bb:
                        print(f"Found 'Show All Commands' at {bb}")
                        page.mouse.click(bb['x'] + bb['width']/2, bb['y'] + bb['height']/2)
                        time.sleep(2)
                except Exception as e:
                    print(f"Show All Commands error: {e}")

        # Open output panel
        print("\nOpening output panel...")
        page.keyboard.press('Control+Shift+U')
        time.sleep(2)
        take_screenshot(page, "v3_output_panel")

        # Wait for experiments
        print("\nWaiting 25 seconds for experiments...")
        for i in range(5):
            time.sleep(5)
            elapsed = (i + 1) * 5
            take_screenshot(page, f"v3_wait_{elapsed:02d}s")
            print(f"  {elapsed}s elapsed")

            # Check for completion
            try:
                text = page.evaluate("() => document.body.innerText")
                if any(kw in text for kw in ['SUMMARY', 'completed', 'Results saved', 'PASS', 'FAIL']):
                    print(f"Completion indicator found at {elapsed}s!")
                    break
            except Exception:
                pass

        take_screenshot(page, "v3_final")

        # Get output panel content
        print("\n=== Output panel content ===")
        try:
            panel_text = page.evaluate("""
                () => {
                    const selectors = [
                        '.output-view-container',
                        '.panel .view-lines',
                        '.panel',
                        '.terminal-wrapper',
                    ];
                    for (const sel of selectors) {
                        const el = document.querySelector(sel);
                        if (el && el.innerText && el.innerText.length > 10) {
                            return {sel, text: el.innerText.substring(0, 3000)};
                        }
                    }
                    return {sel: 'none', text: ''};
                }
            """)
            print(f"Panel selector: {panel_text['sel']}")
            print(panel_text['text'])
        except Exception as e:
            print(f"Panel content error: {e}")

        print("\nDone.")
        browser.close()

if __name__ == '__main__':
    main()
