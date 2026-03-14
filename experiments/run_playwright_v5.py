#!/usr/bin/env python3
"""
Playwright script v5 - correct trust dialog handling + command palette.
"""

import time
import os
import json
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

SCREENSHOT_DIR = "/Users/rickwen/code/code-viewer/experiments/.progress"

def ss(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=False)
    print(f"Screenshot: {name}")
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
        ss(page, "v5_01_initial")

        # ========================
        # Step 1: Handle trust dialog
        # The trust button is <a class="monaco-button" role="button">Yes, I trust the authors</a>
        # ========================
        print("\n=== Step 1: Handle trust dialog ===")

        # Try using Playwright locator which handles role="button"
        try:
            trust_btn = page.locator('role=button[name="Yes, I trust the authors"]')
            if trust_btn.count() > 0:
                print("Found trust button via role locator")
                trust_btn.click()
                time.sleep(3)
                ss(page, "v5_02_after_trust")
            else:
                # Try by text content on <a> elements
                print("Trying <a> element with trust text...")
                result = page.evaluate("""
                    () => {
                        // Look for <a> elements with trust text
                        const links = Array.from(document.querySelectorAll('a[role="button"], .monaco-button'));
                        const trustLink = links.find(l => l.textContent.includes('Yes, I trust'));
                        if (trustLink) {
                            const r = trustLink.getBoundingClientRect();
                            return {found: true, x: r.x + r.width/2, y: r.y + r.height/2, text: trustLink.textContent.trim()};
                        }
                        // Also try all anchors
                        const allLinks = Array.from(document.querySelectorAll('a'));
                        const tl2 = allLinks.find(l => l.textContent.includes('Yes, I trust'));
                        if (tl2) {
                            const r = tl2.getBoundingClientRect();
                            return {found: true, x: r.x + r.width/2, y: r.y + r.height/2, text: tl2.textContent.trim()};
                        }
                        return {found: false};
                    }
                """)
                print(f"Trust link search: {result}")
                if result.get('found'):
                    print(f"Clicking trust button at ({result['x']}, {result['y']})")
                    page.mouse.click(result['x'], result['y'])
                    time.sleep(3)
                    ss(page, "v5_02_after_trust")
        except Exception as e:
            print(f"Trust dialog error: {e}")

        # Check if dialog is gone
        try:
            dialog = page.query_selector('.monaco-dialog-box')
            if dialog and dialog.is_visible():
                print("Dialog still visible, trying keyboard Tab + Enter approach...")
                # The dialog is focused (tabindex=-1), Tab to navigate to Yes button
                # Based on the HTML: first button is "No", second is "Yes"
                page.keyboard.press('Tab')
                time.sleep(0.3)
                page.keyboard.press('Tab')
                time.sleep(0.3)
                page.keyboard.press('Enter')
                time.sleep(2)
                ss(page, "v5_02b_after_tab_trust")
            else:
                print("Dialog dismissed successfully!")
        except Exception as e:
            print(f"Dialog check error: {e}")

        # Wait for page to stabilize after trust
        time.sleep(3)
        ss(page, "v5_03_post_trust")

        # ========================
        # Step 2: Open Command Palette
        # After trust dialog is dismissed, try F1/keyboard shortcuts
        # ========================
        print("\n=== Step 2: Open command palette ===")

        # Click the main editor/workbench area to make sure we have focus
        # Based on earlier debug: after clicking, active element should be workbench (not dialog)
        page.mouse.click(960, 400)
        time.sleep(0.5)

        # Check active element
        active = page.evaluate("() => { const el = document.activeElement; return el ? {tag: el.tagName, class: el.className.substring(0,50)} : null; }")
        print(f"Active element: {active}")

        palette_opened = False

        for attempt in range(5):
            print(f"\nPalette attempt {attempt+1}...")

            page.mouse.click(960, 400)
            time.sleep(0.3)

            if attempt == 0:
                page.keyboard.press('F1')
            elif attempt == 1:
                page.keyboard.press('Control+Shift+P')
            elif attempt == 2:
                # Try clicking the actual header/menu bar area
                # code-server in web mode has a hamburger menu at top-left
                # Try clicking on the workbench and then pressing shortcut
                page.keyboard.down('Shift')
                page.keyboard.down('Control')
                page.keyboard.press('p')
                page.keyboard.up('Control')
                page.keyboard.up('Shift')
            elif attempt == 3:
                # Dispatch event via JavaScript on the focused workbench element
                page.evaluate("""
                    () => {
                        const workbench = document.querySelector('.monaco-workbench');
                        if (workbench) {
                            workbench.focus();
                            const evt = new KeyboardEvent('keydown', {
                                key: 'F1', code: 'F1', keyCode: 112, which: 112,
                                bubbles: true, cancelable: true, composed: true
                            });
                            workbench.dispatchEvent(evt);
                            document.dispatchEvent(evt);
                        }
                    }
                """)
            elif attempt == 4:
                # Try the code-server specific "Go to Command Palette" via the top-right menu
                # code-server shows a "..." menu at the top right
                page.keyboard.press('F1')

            time.sleep(2)
            ss(page, f"v5_palette_{attempt+1}")

            try:
                widget = page.query_selector('.quick-input-widget')
                if widget and widget.is_visible():
                    print(f"Command palette OPENED on attempt {attempt+1}!")
                    palette_opened = True
                    break
            except Exception:
                pass

            page.keyboard.press('Escape')
            time.sleep(0.3)

        if not palette_opened:
            print("\nKeyboard approach failed. Trying via URL-based trigger...")
            # code-server has a feature where it can open command palette via URL param
            # Actually, let's try using the workbench actions via the three-dots menu in web

            # Try clicking the hamburger/menu at top-left corner
            print("Looking for menu bar / hamburger button...")
            menu_result = page.evaluate("""
                () => {
                    // Look for hamburger menu or menu bar toggle
                    const selectors = [
                        '.menubar-menu-button',
                        '[aria-label="Application Menu"]',
                        '.action-item.menubar-menu-button',
                        'div.menubar',
                        '[title="Show All Commands"]',
                        '.global-toolbar-container',
                        '.titlebar-left',
                        '[aria-label*="View"]',
                        '.action-label[aria-label*="View"]'
                    ];
                    const results = [];
                    for (const sel of selectors) {
                        const els = document.querySelectorAll(sel);
                        for (const el of els) {
                            const r = el.getBoundingClientRect();
                            if (r.width > 0 && r.height > 0) {
                                results.push({sel, tag: el.tagName, text: el.textContent.trim().substring(0,30), x: r.x, y: r.y, w: r.width, h: r.height});
                            }
                        }
                    }
                    return results;
                }
            """)
            print(f"Menu elements: {menu_result}")

            for el in menu_result[:5]:
                print(f"  Trying to click: {el}")
                page.mouse.click(el['x'] + el['w']/2, el['y'] + el['h']/2)
                time.sleep(1.5)
                ss(page, f"v5_menu_click_{menu_result.index(el)}")

                try:
                    widget = page.query_selector('.quick-input-widget')
                    if widget and widget.is_visible():
                        print("Command palette opened via menu!")
                        palette_opened = True
                        break
                except Exception:
                    pass

                # Try keyboard after clicking the menu
                if not palette_opened:
                    page.keyboard.press('F1')
                    time.sleep(1.5)
                    try:
                        widget = page.query_selector('.quick-input-widget')
                        if widget and widget.is_visible():
                            print("Command palette opened via F1 after menu click!")
                            palette_opened = True
                            break
                    except Exception:
                        pass
                    page.keyboard.press('Escape')
                    time.sleep(0.3)

        if palette_opened:
            print("\n=== Step 3: Type and run command ===")
            time.sleep(0.5)

            # The palette input should be focused now
            # Clear any existing content
            page.keyboard.press('Control+a')
            time.sleep(0.2)

            # Type the command (without '>' prefix for command search)
            command = 'Code Viewer: Run All Experiments'
            print(f"Typing: '{command}'")
            page.keyboard.type(command, delay=60)
            time.sleep(2.5)
            ss(page, "v5_typed")

            # Read palette content
            try:
                palette_content = page.evaluate("""
                    () => {
                        const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
                        return Array.from(rows).slice(0,8).map(r => {
                            const label = r.querySelector('.label-name, .monaco-highlighted-label, .label-description');
                            return label ? label.innerText : r.innerText.trim().substring(0, 60);
                        });
                    }
                """)
                print(f"Palette results ({len(palette_content)}):")
                for item in palette_content:
                    print(f"  - {item}")
            except Exception as e:
                print(f"Palette read error: {e}")

            print("Pressing Enter...")
            page.keyboard.press('Enter')
            time.sleep(3)
            ss(page, "v5_entered")
        else:
            print("\nCould not open command palette. Checking if experiment can be triggered another way...")
            ss(page, "v5_palette_failed")

        # ========================
        # Step 4: Open Output panel
        # ========================
        print("\n=== Step 4: Open Output panel ===")
        page.keyboard.press('Escape')
        time.sleep(0.5)
        page.mouse.click(960, 400)
        time.sleep(0.3)
        page.keyboard.press('Control+Shift+U')
        time.sleep(2)
        ss(page, "v5_output_open")

        # ========================
        # Step 5: Wait for experiments
        # ========================
        print("\n=== Step 5: Waiting 25s for experiments ===")
        for i in range(5):
            time.sleep(5)
            elapsed = (i + 1) * 5
            print(f"  {elapsed}s...")
            ss(page, f"v5_progress_{elapsed:02d}s")

            try:
                body = page.evaluate("() => document.body.innerText")
                for kw in ['Results saved', 'experiment-results', 'SUMMARY', 'All experiments', 'WebSocket connected']:
                    if kw in body:
                        print(f"Found: '{kw}'")
                        break
            except Exception:
                pass

        ss(page, "v5_final")

        # ========================
        # Extract all output
        # ========================
        print("\n=== Output panel content ===")
        try:
            result = page.evaluate("""
                () => {
                    const sels = [
                        '.output-view-container',
                        '.panel .view-lines',
                        '.panel',
                        '.pane-body',
                    ];
                    for (const sel of sels) {
                        const el = document.querySelector(sel);
                        const text = el && el.innerText && el.innerText.trim();
                        if (text && text.length > 5 && text !== 'Drag a view here to display.') {
                            return {sel, text: text.substring(0, 5000)};
                        }
                    }
                    return {sel: 'none', text: 'No meaningful output found'};
                }
            """)
            print(f"[{result['sel']}]:")
            print(result['text'])
        except Exception as e:
            print(f"Extract error: {e}")

        browser.close()
        print("\nPlaywright done.")

if __name__ == '__main__':
    main()
