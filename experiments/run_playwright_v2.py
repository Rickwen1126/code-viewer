#!/usr/bin/env python3
"""
Playwright script to run Code Viewer experiments in code-server (improved).
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
    time.sleep(5)
    print("VS Code appears loaded.")

def open_command_palette(page):
    """Open command palette using various methods."""
    take_screenshot(page, "before_palette")

    # First click somewhere safe in the workbench to focus it
    try:
        page.mouse.click(960, 540)
        time.sleep(0.5)
    except Exception as e:
        print(f"Click error: {e}")

    # Try pressing F1
    for attempt in range(5):
        print(f"Attempt {attempt+1} to open command palette...")
        key_combos = ['F1', 'Control+Shift+P', 'Meta+Shift+P', 'Shift+F10', 'F1']
        key = key_combos[min(attempt, len(key_combos)-1)]

        if attempt == 2:
            # Try clicking on the gear icon or the command palette button in UI
            try:
                # Try clicking the "Open Command Palette" button in Welcome tab if visible
                cp_btn = page.query_selector('text="Open Command Palette"')
                if cp_btn:
                    cp_btn.click()
                    time.sleep(1)
            except Exception as e:
                print(f"  CP button click: {e}")

        page.keyboard.press(key)
        time.sleep(2)

        try:
            # Check for quick-input-widget
            palette = page.wait_for_selector('.quick-input-widget', timeout=2000)
            if palette and palette.is_visible():
                print(f"Command palette opened on attempt {attempt+1} with key {key}")
                take_screenshot(page, "palette_open")
                return True
        except PlaywrightTimeout:
            pass

        page.keyboard.press('Escape')
        time.sleep(0.5)

    # Try clicking the "Open Command Palette" text on Welcome screen
    try:
        print("Trying to click 'Open Command Palette' link on welcome screen...")
        result = page.evaluate("""
            () => {
                const links = Array.from(document.querySelectorAll('a, button, span, div'));
                const link = links.find(el => el.textContent.includes('Open Command Palette'));
                if (link) {
                    link.click();
                    return 'clicked: ' + link.tagName + ' ' + link.textContent.trim();
                }
                return 'not found';
            }
        """)
        print(f"Welcome screen CP link: {result}")
        time.sleep(2)
        try:
            palette = page.wait_for_selector('.quick-input-widget', timeout=3000)
            if palette and palette.is_visible():
                print("Command palette opened via welcome screen link!")
                take_screenshot(page, "palette_open_via_link")
                return True
        except PlaywrightTimeout:
            pass
    except Exception as e:
        print(f"Welcome screen link error: {e}")

    # Try using the View menu
    try:
        print("Trying View menu...")
        view_btn = page.query_selector('[aria-label="View"]') or page.query_selector('text="View"')
        if view_btn:
            view_btn.click()
            time.sleep(0.5)
            take_screenshot(page, "view_menu_open")
    except Exception as e:
        print(f"View menu error: {e}")

    take_screenshot(page, "palette_failed")
    return False

def run_command_via_palette(page, command):
    """Type and run a command in the palette."""
    print(f"Typing command: {command}")
    page.keyboard.press('Control+a')
    time.sleep(0.3)
    page.keyboard.type(command, delay=80)
    time.sleep(2.5)
    take_screenshot(page, "command_typed")

    # Show results
    try:
        rows = page.query_selector_all('.quick-input-list .monaco-list-row')
        print(f"Found {len(rows)} command palette results")
        for row in rows[:5]:
            label_el = row.query_selector('.label-name, .monaco-highlighted-label')
            if label_el:
                print(f"  Result: {label_el.inner_text()}")
    except Exception as e:
        print(f"Could not read palette results: {e}")

    print("Pressing Enter...")
    page.keyboard.press('Enter')
    time.sleep(3)
    take_screenshot(page, "after_enter")
    return True

def ensure_output_panel_open(page):
    """Make sure output panel is visible."""
    print("Ensuring Output panel is open...")

    # Try Ctrl+Shift+U first
    page.keyboard.press('Control+Shift+U')
    time.sleep(1.5)

    panel_visible = False
    try:
        panel = page.query_selector('.panel .output-view-container')
        if panel and panel.is_visible():
            print("Output panel visible after Ctrl+Shift+U")
            panel_visible = True
    except Exception:
        pass

    if not panel_visible:
        # Try to find and click Output tab if panel is showing something else
        try:
            output_tab = page.query_selector('[aria-label="Output (Ctrl+Shift+U)"]') or \
                         page.query_selector('text="Output"')
            if output_tab:
                output_tab.click()
                time.sleep(1)
                panel_visible = True
        except Exception as e:
            print(f"Output tab click error: {e}")

    take_screenshot(page, "output_panel")
    return panel_visible

def switch_output_channel(page, channel_name="Code Viewer Bridge"):
    """Switch output channel to Code Viewer related channel."""
    print(f"Trying to switch output channel to '{channel_name}'...")
    try:
        # Find the output channel dropdown
        dropdown = page.query_selector('.output-view-container .monaco-select-box') or \
                   page.query_selector('.panel .monaco-select-box')
        if dropdown:
            dropdown.click()
            time.sleep(0.5)
            take_screenshot(page, "output_dropdown")

            option = page.query_selector(f'option:text("{channel_name}")') or \
                     page.query_selector(f'[aria-label="{channel_name}"]')
            if option:
                option.click()
                time.sleep(0.5)
                return True
    except Exception as e:
        print(f"Channel switch error: {e}")
    return False

def main():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    with sync_playwright() as pw:
        print("Launching Chromium browser...")
        browser = pw.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--disable-features=IsolateOrigins',
                '--disable-site-isolation-trials',
            ]
        )

        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            ignore_https_errors=True,
        )
        page = context.new_page()

        page.on('console', lambda msg: print(f"  [browser] {msg.type}: {msg.text[:150]}"))

        print("Navigating to http://localhost:8080...")
        try:
            page.goto('http://localhost:8080', wait_until='domcontentloaded', timeout=30000)
        except Exception as e:
            print(f"Navigation error: {e}")

        time.sleep(3)
        print(f"Current URL: {page.url}")

        # Wait for VS Code
        wait_for_vscode(page)
        take_screenshot(page, "00_vscode_loaded")

        # Open command palette
        palette_opened = open_command_palette(page)

        if palette_opened:
            run_command_via_palette(page, 'Code Viewer: Run All Experiments')
        else:
            print("Could not open command palette. Trying direct workbench command via URL...")
            # Try to execute via URL workaround
            try:
                page.evaluate("""
                    () => {
                        // Try to execute command via vscode API
                        if (window.vscode) {
                            window.vscode.commands.executeCommand('codeViewerBridge.runAllExperiments');
                        }
                    }
                """)
            except Exception as e:
                print(f"Direct command execution: {e}")

        # Show output panel
        time.sleep(2)
        ensure_output_panel_open(page)

        # Wait for experiments
        print("\nWaiting 25 seconds for experiments to complete...")
        for i in range(5):
            time.sleep(5)
            print(f"  {(i+1)*5}s elapsed...")
            take_screenshot(page, f"wait_{(i+1)*5:02d}s")

            # Check for completion indicators
            try:
                body_text = page.evaluate("() => document.body.innerText")
                if any(kw in body_text for kw in ['SUMMARY', 'experiments completed', 'PASS', 'FAIL', 'Results saved']):
                    print(f"Completion indicator found at {(i+1)*5}s!")
                    break
            except Exception:
                pass

        # Final screenshot
        take_screenshot(page, "final_output")

        # Try to switch to Code Viewer output channel
        switch_output_channel(page, "Code Viewer Bridge")
        time.sleep(1)
        take_screenshot(page, "final_output_channel")

        # Extract all relevant text
        print("\n=== Extracting page content ===")
        try:
            full_text = page.evaluate("""
                () => {
                    // Try to get output panel content
                    const outputContainer = document.querySelector('.output-view-container');
                    if (outputContainer) {
                        return {source: 'output-panel', text: outputContainer.innerText};
                    }
                    const panel = document.querySelector('.panel');
                    if (panel) {
                        return {source: 'panel', text: panel.innerText};
                    }
                    return {source: 'none', text: ''};
                }
            """)
            print(f"Source: {full_text['source']}")
            print(full_text['text'][:5000])
        except Exception as e:
            print(f"Text extraction error: {e}")

        print("\nDone.")
        browser.close()

if __name__ == '__main__':
    main()
