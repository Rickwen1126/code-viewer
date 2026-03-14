#!/usr/bin/env python3
"""
Final Playwright script - correct command palette handling with > prefix.
"""

import time
import os
import json
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
        time.sleep(5)
        ss(page, "final_01_loaded")

        # ========================
        # Step 1: Handle trust dialog using role locator
        # ========================
        print("\n[Step 1] Dismissing trust dialog...")
        try:
            trust_btn = page.locator('role=button[name="Yes, I trust the authors"]')
            count = trust_btn.count()
            print(f"  Trust buttons found: {count}")
            if count > 0:
                trust_btn.first.click()
                time.sleep(3)
                print("  Trust dialog dismissed.")
            else:
                # Try direct evaluate with <a> elements
                r = page.evaluate("""
                    () => {
                        const els = document.querySelectorAll('a[role="button"], .monaco-button');
                        for (const el of els) {
                            if (el.textContent.includes('Yes, I trust')) {
                                const rect = el.getBoundingClientRect();
                                el.click();
                                return {clicked: true, text: el.textContent.trim(), x: rect.x, y: rect.y};
                            }
                        }
                        return {clicked: false};
                    }
                """)
                print(f"  JS click result: {r}")
                if r.get('clicked'):
                    time.sleep(3)
        except Exception as e:
            print(f"  Trust error: {e}")

        ss(page, "final_02_post_trust")

        # Check if dialog is gone
        dialog_gone = True
        try:
            dialog = page.query_selector('.monaco-dialog-box')
            if dialog and dialog.is_visible():
                print("  Dialog still visible - pressing Tab+Tab+Enter...")
                # Focus is on dialog-box (tabindex=-1)
                # Tab to cycle through buttons, Enter to click
                page.keyboard.press('Tab')
                time.sleep(0.3)
                page.keyboard.press('Tab')
                time.sleep(0.3)
                page.keyboard.press('Enter')
                time.sleep(2)
                dialog_gone = True
        except Exception:
            pass

        time.sleep(2)

        # ========================
        # Step 2: Open command palette and run command
        # ========================
        print("\n[Step 2] Opening command palette...")

        # Click on the editor area
        page.mouse.click(960, 400)
        time.sleep(0.5)

        # In F1 mode, the palette opens with '>' prefix already
        # Just type the command name after clearing
        palette_opened = False

        for attempt in range(4):
            print(f"  Attempt {attempt+1}...")

            page.mouse.click(960, 400)
            time.sleep(0.3)

            if attempt == 0:
                page.keyboard.press('F1')
            elif attempt == 1:
                page.keyboard.press('Control+Shift+P')
            elif attempt == 2:
                page.keyboard.press('Meta+Shift+P')
            else:
                # Try focus on workbench explicitly
                page.evaluate("() => document.querySelector('.monaco-workbench')?.focus()")
                time.sleep(0.2)
                page.keyboard.press('F1')

            time.sleep(2)
            ss(page, f"final_palette_{attempt+1}")

            try:
                widget = page.wait_for_selector('.quick-input-widget', timeout=1500)
                if widget and widget.is_visible():
                    print(f"  Command palette opened!")
                    palette_opened = True
                    break
            except PlaywrightTimeout:
                pass

            page.keyboard.press('Escape')
            time.sleep(0.3)

        if palette_opened:
            # The F1 palette already has '>' - just read/clear and type command
            # First check what's in the input
            try:
                input_val = page.evaluate("""
                    () => {
                        const input = document.querySelector('.quick-input-box input');
                        return input ? {val: input.value, placeholder: input.placeholder} : null;
                    }
                """)
                print(f"  Palette input: {input_val}")
            except Exception:
                pass

            # Select all and type command (F1 already adds '>', so just type command name)
            # Actually F1 opens with '>' prefix in the box, we need to clear and type
            page.keyboard.press('Control+a')
            time.sleep(0.2)

            # Check if we need the '>' prefix or not
            # F1 opens command palette (with '>') - so typing after should work
            # But let's just type the full command including leading >
            command = 'Code Viewer: Run All Experiments'
            print(f"  Typing: '{command}'")
            page.keyboard.type(command, delay=50)
            time.sleep(3)
            ss(page, "final_typed")

            # Check palette results
            results_info = page.evaluate("""
                () => {
                    const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
                    const input = document.querySelector('.quick-input-box input');
                    return {
                        count: rows.length,
                        inputVal: input ? input.value : '',
                        items: Array.from(rows).slice(0,10).map(r => {
                            const labels = r.querySelectorAll('.label-name, .monaco-highlighted-label');
                            return Array.from(labels).map(l => l.innerText).join(' | ');
                        })
                    };
                }
            """)
            print(f"  Palette results: count={results_info['count']}, input='{results_info['inputVal']}'")
            for item in results_info['items']:
                print(f"    - {item}")

            if results_info['count'] == 0 or (results_info['count'] == 1 and 'No matching' in str(results_info['items'])):
                print("  No results found! Trying with just partial command name...")
                # Clear and try partial search
                page.keyboard.press('Control+a')
                time.sleep(0.2)
                page.keyboard.type('Code Viewer', delay=50)
                time.sleep(2)
                ss(page, "final_partial_search")

                partial_results = page.evaluate("""
                    () => {
                        const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
                        return Array.from(rows).slice(0,10).map(r => {
                            const label = r.querySelector('.label-name, .monaco-highlighted-label');
                            return label ? label.innerText : r.innerText.trim().substring(0, 80);
                        });
                    }
                """)
                print(f"  Partial search results ({len(partial_results)}):")
                for item in partial_results:
                    print(f"    - {item}")

                if partial_results:
                    # Type full command again
                    page.keyboard.press('Control+a')
                    time.sleep(0.2)
                    page.keyboard.type('Run All Experiments', delay=50)
                    time.sleep(2)
                    ss(page, "final_full_search")

            print("  Pressing Enter to execute...")
            page.keyboard.press('Enter')
            time.sleep(3)
            ss(page, "final_entered")
        else:
            print("  Command palette could not be opened!")
            ss(page, "final_palette_failed")

            # Try triggering via the extension's AUTO_RUN by reloading with env variable
            # This would require modifying docker-compose which we can't do easily
            # Instead, let's try using exec in docker to trigger the command
            print("  Will try bash alternative...")

        # ========================
        # Step 3: Show output panel
        # ========================
        print("\n[Step 3] Opening Output panel...")
        page.mouse.click(960, 400)
        time.sleep(0.3)
        page.keyboard.press('Control+Shift+U')
        time.sleep(2)
        ss(page, "final_output_panel")

        # Switch to "Code Viewer Experiments" channel if available
        try:
            dropdown = page.query_selector('.output-view-container select, .output-view-container .monaco-select-box')
            if dropdown:
                print("  Found output dropdown, selecting Code Viewer channel...")
                dropdown.select_option(label='Code Viewer Experiments')
                time.sleep(1)
        except Exception as e:
            print(f"  Dropdown error: {e}")

        # ========================
        # Step 4: Wait for experiments
        # ========================
        print("\n[Step 4] Waiting 25s for experiments to complete...")
        for i in range(5):
            time.sleep(5)
            elapsed = (i + 1) * 5
            print(f"  {elapsed}s elapsed...")
            ss(page, f"final_wait_{elapsed:02d}s")

            try:
                body = page.evaluate("() => document.body.innerText")
                for kw in ['Results written to', 'SUMMARY', 'All experiments', '╔']:
                    if kw in body:
                        print(f"    Found '{kw}' - experiments may be complete!")
                        break
            except Exception:
                pass

        ss(page, "final_screenshot")

        # ========================
        # Extract output
        # ========================
        print("\n=== Output Panel Content ===")
        try:
            content = page.evaluate("""
                () => {
                    // Try output view container first
                    const output = document.querySelector('.output-view-container');
                    if (output && output.innerText.trim().length > 5) {
                        return {sel: 'output-view', text: output.innerText.substring(0, 8000)};
                    }
                    const panel = document.querySelector('.panel');
                    if (panel && panel.innerText.trim().length > 5) {
                        const text = panel.innerText.trim();
                        if (text !== 'Drag a view here to display.') {
                            return {sel: 'panel', text: text.substring(0, 8000)};
                        }
                    }
                    // Look for any view-lines with experiment output
                    const viewLines = document.querySelectorAll('.view-lines');
                    for (const vl of viewLines) {
                        const text = vl.innerText.trim();
                        if (text.length > 20) {
                            return {sel: 'view-lines', text: text.substring(0, 8000)};
                        }
                    }
                    return {sel: 'none', text: 'No output found'};
                }
            """)
            print(f"[From: {content['sel']}]")
            print(content['text'])
        except Exception as e:
            print(f"  Content extraction error: {e}")

        browser.close()
        print("\nPlaywright completed.")

if __name__ == '__main__':
    main()
