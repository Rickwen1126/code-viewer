#!/usr/bin/env python3
"""Debug script to understand the DOM structure."""

import time
import os
import json
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

SCREENSHOT_DIR = "/Users/rickwen/code/code-viewer/experiments/.progress"

def main():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        )

        context = browser.new_context(viewport={'width': 1920, 'height': 1080}, ignore_https_errors=True)
        page = context.new_page()
        page.goto('http://localhost:8080', wait_until='domcontentloaded', timeout=30000)
        time.sleep(3)

        # Wait for workbench
        try:
            page.wait_for_selector('.monaco-workbench', timeout=60000)
        except PlaywrightTimeout:
            pass
        time.sleep(5)

        # Debug: get ALL elements that could be the trust dialog buttons
        print("=== Debug: Trust dialog structure ===")
        result = page.evaluate("""
            () => {
                // Look for all dialog-related elements
                const info = {};

                // Check for overlay widget or dialog
                const overlay = document.querySelector('.monaco-dialog-box');
                info.dialogBox = overlay ? overlay.outerHTML.substring(0, 2000) : 'not found';

                // Check dialog shadow
                const dialogs = document.querySelectorAll('.dialog-message-container, .dialog-buttons-row');
                info.dialogParts = Array.from(dialogs).map(d => d.outerHTML.substring(0, 500));

                // Get the trust workspace container
                const trustEl = Array.from(document.querySelectorAll('*')).find(el =>
                    el.textContent.includes('Do you trust the authors') && el.children.length < 10
                );
                info.trustContainer = trustEl ? trustEl.outerHTML.substring(0, 2000) : 'not found';

                // Check all button elements with coordinates
                const buttons = Array.from(document.querySelectorAll('button'));
                info.allButtons = buttons.map(b => {
                    const r = b.getBoundingClientRect();
                    return {
                        text: b.textContent.trim().substring(0, 50),
                        x: r.x, y: r.y, w: r.width, h: r.height,
                        visible: r.width > 0 && r.height > 0,
                        classes: b.className.substring(0, 100)
                    };
                }).filter(b => b.visible);

                return info;
            }
        """)

        print(f"Dialog box: {result['dialogBox'][:500] if result['dialogBox'] != 'not found' else 'NOT FOUND'}")
        print(f"\nDialog parts: {result['dialogParts']}")
        print(f"\nTrust container: {result['trustContainer'][:500] if result['trustContainer'] != 'not found' else 'NOT FOUND'}")
        print(f"\nAll visible buttons:")
        for btn in result['allButtons']:
            print(f"  text='{btn['text']}', pos=({btn['x']:.0f},{btn['y']:.0f}), size={btn['w']:.0f}x{btn['h']:.0f}, classes={btn['classes'][:50]}")

        # Also dump the dialogs section of the DOM
        print("\n=== Looking for workspace trust in iframes ===")
        frames = page.frames
        print(f"Number of frames: {len(frames)}")
        for i, frame in enumerate(frames):
            try:
                url = frame.url
                print(f"Frame {i}: {url}")
                # Check if this frame has the trust dialog
                try:
                    trust_in_frame = frame.evaluate("""
                        () => {
                            const buttons = Array.from(document.querySelectorAll('button'));
                            const trustBtn = buttons.find(b => b.textContent.includes('Yes, I trust'));
                            if (trustBtn) {
                                const r = trustBtn.getBoundingClientRect();
                                return {found: true, text: trustBtn.textContent, x: r.x, y: r.y};
                            }
                            return {found: false};
                        }
                    """)
                    if trust_in_frame.get('found'):
                        print(f"  FOUND TRUST BUTTON IN FRAME {i}!")
                        print(f"  {trust_in_frame}")
                except Exception as e:
                    print(f"  Frame {i} error: {e}")
            except Exception as e:
                print(f"Frame {i} error: {e}")

        # Check what the keyboard events look like
        print("\n=== Testing keyboard event dispatch ===")
        page.mouse.click(960, 400)
        time.sleep(0.5)

        # Get focused element
        focused_info = page.evaluate("""
            () => {
                const el = document.activeElement;
                if (!el) return 'no active element';
                return {
                    tag: el.tagName,
                    class: el.className.substring(0, 100),
                    id: el.id,
                    tabIndex: el.tabIndex
                };
            }
        """)
        print(f"Active element after click: {focused_info}")

        page.screenshot(path=f"{SCREENSHOT_DIR}/debug_state.png")
        print(f"\nDebug screenshot saved")

        browser.close()

if __name__ == '__main__':
    main()
