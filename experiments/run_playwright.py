#!/usr/bin/env python3
"""
Playwright script to run Code Viewer experiments in code-server.
"""

import time
import sys
import os
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

SCREENSHOT_DIR = "/Users/rickwen/code/code-viewer/experiments/.progress"

def take_screenshot(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path)
    print(f"Screenshot saved: {path}")
    return path

def wait_for_vscode(page):
    """Wait for VS Code to fully load."""
    print("Waiting for VS Code to load...")
    try:
        page.wait_for_selector('.monaco-workbench', timeout=60000)
        print("Monaco workbench detected.")
    except PlaywrightTimeout:
        print("WARNING: Monaco workbench not found after 60s")
    time.sleep(3)
    print("VS Code appears loaded.")

def handle_trust_dialog(page):
    """Handle the 'Trust Authors' dialog if present."""
    print("Checking for trust dialog...")
    take_screenshot(page, "00_check_trust")

    # Try multiple selectors for the trust button
    selectors = [
        'button.monaco-button:has-text("Yes, I trust the authors")',
        '.monaco-dialog-box button:has-text("Yes")',
        'button:text-matches("Yes, I trust")',
        '.trusted-domain-dialog button >> nth=1',
    ]

    for sel in selectors:
        try:
            btn = page.wait_for_selector(sel, timeout=3000)
            if btn:
                print(f"Trust button found with selector: {sel}")
                btn.click()
                time.sleep(3)
                take_screenshot(page, "01_after_trust")
                print("Trust dialog dismissed.")
                return True
        except PlaywrightTimeout:
            continue
        except Exception as e:
            print(f"  Selector {sel} error: {e}")

    # Try clicking by text content using JavaScript
    try:
        result = page.evaluate("""
            () => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const trustBtn = buttons.find(b => b.textContent.includes('Yes, I trust'));
                if (trustBtn) {
                    trustBtn.click();
                    return 'clicked: ' + trustBtn.textContent;
                }
                return 'not found, buttons: ' + buttons.map(b => b.textContent.trim()).join(' | ');
            }
        """)
        print(f"JS button search result: {result}")
        if 'clicked' in result:
            time.sleep(3)
            take_screenshot(page, "01_after_trust_js")
            return True
    except Exception as e:
        print(f"JS click error: {e}")

    print("No trust dialog found or could not dismiss.")
    return False

def open_command_palette_and_run(page, command):
    """Open command palette and run a specific command."""
    print(f"Opening command palette to run: {command}")

    # Click on the editor area first to focus it
    try:
        editor_area = page.query_selector('.monaco-workbench')
        if editor_area:
            editor_area.click()
            time.sleep(0.5)
    except Exception as e:
        print(f"Could not click editor: {e}")

    take_screenshot(page, "02_before_command_palette")

    # Try to open command palette
    for attempt in range(3):
        print(f"Attempt {attempt+1} to open command palette...")

        if attempt == 0:
            page.keyboard.press('F1')
        elif attempt == 1:
            page.keyboard.press('Control+Shift+P')
        else:
            # Try clicking the gear icon or menu
            page.keyboard.press('Meta+Shift+P')

        time.sleep(1.5)

        try:
            palette = page.wait_for_selector('.quick-input-widget', timeout=3000)
            if palette and palette.is_visible():
                print(f"Command palette opened on attempt {attempt+1}")
                break
        except PlaywrightTimeout:
            print(f"  Attempt {attempt+1} failed")
            # Close any partial open
            page.keyboard.press('Escape')
            time.sleep(0.5)
    else:
        print("Could not open command palette after 3 attempts")
        take_screenshot(page, "error_no_palette")

        # Try using the Help menu as fallback
        print("Trying Help menu > Command Palette...")
        try:
            # Look for menu bar
            help_menu = page.query_selector('[aria-label="Help"]')
            if help_menu:
                help_menu.click()
                time.sleep(0.5)
                cp_item = page.query_selector('[aria-label="Command Palette"]')
                if cp_item:
                    cp_item.click()
                    time.sleep(1)
        except Exception as e:
            print(f"Help menu error: {e}")

        # Check one more time
        try:
            palette = page.wait_for_selector('.quick-input-widget', timeout=3000)
            if not (palette and palette.is_visible()):
                return False
        except PlaywrightTimeout:
            return False

    take_screenshot(page, "03_command_palette_open")

    # Clear existing content and type the command
    page.keyboard.press('Control+a')
    time.sleep(0.3)
    page.keyboard.type(command, delay=50)
    time.sleep(2)

    take_screenshot(page, "04_command_typed")

    # Read what's shown
    try:
        rows = page.query_selector_all('.quick-input-list .monaco-list-row')
        print(f"Found {len(rows)} results in command palette")
        for row in rows[:5]:
            label_el = row.query_selector('.label-name, .monaco-highlighted-label')
            if label_el:
                print(f"  Result: {label_el.inner_text()}")
    except Exception as e:
        print(f"Could not read palette results: {e}")

    # Press Enter
    print("Pressing Enter to execute command...")
    page.keyboard.press('Enter')
    time.sleep(2)

    take_screenshot(page, "05_after_enter")
    return True

def show_output_panel(page):
    """Try to show the Output panel."""
    print("Trying to show Output panel...")

    # Try keyboard shortcut to open output
    # Ctrl+Shift+U on Windows/Linux, or use View menu
    page.keyboard.press('Control+Shift+U')
    time.sleep(1)
    take_screenshot(page, "06_output_panel_attempt")

    # Check if panel appeared
    panel = page.query_selector('.panel, .output-view-container')
    if panel and panel.is_visible():
        print("Output panel is visible.")
        return True

    print("Trying View menu > Output...")
    return False

def wait_and_read_output(page, wait_seconds=25):
    """Wait for experiments to complete and read output."""
    print(f"Waiting {wait_seconds} seconds for experiments...")

    start = time.time()
    last_screenshot = 0

    while time.time() - start < wait_seconds:
        elapsed = time.time() - start

        # Take periodic screenshots
        if elapsed - last_screenshot >= 5:
            take_screenshot(page, f"progress_{int(elapsed):02d}s")
            last_screenshot = elapsed

            # Check output content
            try:
                output_text = page.evaluate("""
                    () => {
                        const containers = document.querySelectorAll('.output-view-container, .view-lines');
                        for (const c of containers) {
                            const text = c.innerText;
                            if (text && text.length > 50) return text;
                        }
                        return '';
                    }
                """)
                if output_text and ('SUMMARY' in output_text or 'PASS' in output_text or 'FAIL' in output_text):
                    print(f"Experiments complete detected at {elapsed:.0f}s!")
                    break
            except Exception as e:
                print(f"  Output check error: {e}")

        time.sleep(2)

    take_screenshot(page, "07_final_state")
    print("Wait period complete.")

def get_all_output_text(page):
    """Extract all text from the page, focusing on experiment output."""
    print("\n=== Extracting output text ===")

    # Try to get text from output container
    texts = page.evaluate("""
        () => {
            const results = [];

            // Try output view
            const outputView = document.querySelector('.output-view-container');
            if (outputView) {
                results.push({source: 'output-view', text: outputView.innerText});
            }

            // Try view lines (Monaco editor)
            const viewLines = document.querySelector('.view-lines');
            if (viewLines) {
                results.push({source: 'view-lines', text: viewLines.innerText});
            }

            // Try panel area
            const panel = document.querySelector('.panel');
            if (panel) {
                results.push({source: 'panel', text: panel.innerText});
            }

            // Full body for experiment keywords
            const body = document.body.innerText;
            const expLines = body.split('\\n').filter(l =>
                l.includes('PASS') || l.includes('FAIL') || l.includes('SUMMARY') ||
                l.includes('WebSocket') || l.includes('File System') || l.includes('Git') ||
                l.includes('━━━') || l.includes('╔') || l.includes('✓') || l.includes('✗') ||
                l.includes('LSP') || l.includes('Diagnostics') || l.includes('Workspace')
            );
            if (expLines.length > 0) {
                results.push({source: 'body-filtered', text: expLines.join('\\n')});
            }

            return results;
        }
    """)

    for item in texts:
        if item['text']:
            print(f"\n--- {item['source']} ---")
            print(item['text'][:3000])
            print("---")

    return texts

def main():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    with sync_playwright() as pw:
        print("Launching Chromium browser (headless)...")
        browser = pw.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
            ]
        )

        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            ignore_https_errors=True,
        )
        page = context.new_page()

        # Enable console logging
        page.on('console', lambda msg: print(f"  [browser-console] {msg.type}: {msg.text[:200]}"))

        print("Navigating to http://localhost:8080...")
        try:
            page.goto('http://localhost:8080', wait_until='domcontentloaded', timeout=30000)
        except Exception as e:
            print(f"Navigation error: {e}")

        time.sleep(3)
        current_url = page.url
        print(f"Current URL: {current_url}")

        # Wait for VS Code
        wait_for_vscode(page)

        # Handle trust dialog
        handle_trust_dialog(page)

        # Give extra time after trust dialog
        time.sleep(2)

        # Open command palette and run experiment command
        success = open_command_palette_and_run(page, 'Code Viewer: Run All Experiments')

        if not success:
            # Try using command ID directly via keyboard shortcut or alternative
            print("Trying to run via command ID directly...")
            # Try the command palette again with the command ID
            page.keyboard.press('F1')
            time.sleep(1)
            page.keyboard.type('>codeViewerBridge.runAllExperiments')
            time.sleep(1)
            page.keyboard.press('Enter')
            time.sleep(1)

        # Show output panel
        show_output_panel(page)

        # Wait for experiments to complete
        wait_and_read_output(page, wait_seconds=30)

        # Get all output text
        get_all_output_text(page)

        print("\nPlaywright script completed.")
        browser.close()

if __name__ == '__main__':
    main()
