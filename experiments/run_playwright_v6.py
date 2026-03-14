#!/usr/bin/env python3
"""
Playwright v6 - Fix palette input handling + debug command registration.
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

def dismiss_trust(page):
    """Dismiss trust dialog using role locator."""
    try:
        btn = page.locator('role=button[name="Yes, I trust the authors"]')
        if btn.count() > 0:
            btn.first.click()
            time.sleep(3)
            print("  Trust dialog dismissed.")
            return True
    except Exception as e:
        print(f"  Trust error: {e}")
    return False

def open_palette(page):
    """Open command palette and return True if successful."""
    page.mouse.click(960, 400)
    time.sleep(0.5)

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
                return True
        except PlaywrightTimeout:
            pass

        page.keyboard.press('Escape')
        time.sleep(0.3)

    return False

def type_in_palette(page, text):
    """Type into the palette input field by clearing it first using the input element."""
    # Focus the input directly and set value
    result = page.evaluate(f"""
        () => {{
            const input = document.querySelector('.quick-input-box input');
            if (!input) return 'no input found';

            // Focus input
            input.focus();

            // Clear existing value
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, '');
            input.dispatchEvent(new Event('input', {{ bubbles: true }}));

            return 'cleared, ready';
        }}
    """)
    print(f"  Palette clear: {result}")
    time.sleep(0.3)

    # Type the text
    print(f"  Typing: '{text}'")
    page.keyboard.type(text, delay=60)
    time.sleep(3)

def check_palette_results(page):
    """Get list of results in command palette."""
    return page.evaluate("""
        () => {
            const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
            const input = document.querySelector('.quick-input-box input');
            return {
                inputVal: input ? input.value : '',
                count: rows.length,
                items: Array.from(rows).map(r => {
                    const label = r.querySelector('.label-name, .monaco-highlighted-label');
                    const desc = r.querySelector('.label-description');
                    return {
                        label: label ? label.innerText : '',
                        desc: desc ? desc.innerText : '',
                        full: r.innerText.trim().substring(0, 100)
                    };
                })
            };
        }
    """)

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
        time.sleep(8)  # Extra wait for extension to fully initialize
        ss(page, "v6_01_loaded")

        # Step 1: Trust dialog
        print("\n[1] Trust dialog...")
        dismiss_trust(page)
        time.sleep(3)
        ss(page, "v6_02_trust_done")

        # Extra wait for extension host to fully activate
        print("  Waiting extra 10s for extension host to stabilize...")
        time.sleep(10)
        ss(page, "v6_03_after_wait")

        # Step 2: Debug - check what commands are registered
        print("\n[2] Debugging command registration...")
        page.mouse.click(960, 400)
        time.sleep(0.5)

        palette_opened = open_palette(page)
        if palette_opened:
            ss(page, "v6_palette_open")

            # Check palette input value
            init_val = page.evaluate("() => { const i = document.querySelector('.quick-input-box input'); return i ? i.value : 'no input'; }")
            print(f"  Palette initial value: '{init_val}'")

            # Try searching for 'code viewer' without clearing
            page.keyboard.type('code viewer', delay=60)
            time.sleep(2)
            ss(page, "v6_search_codeviewer")

            results1 = check_palette_results(page)
            print(f"  Search 'code viewer': input='{results1['inputVal']}', count={results1['count']}")
            for item in results1['items']:
                print(f"    - {item['label']} | {item['desc']} | {item['full'][:50]}")

            # Try with just '>code viewer' from scratch
            page.keyboard.press('Escape')
            time.sleep(0.5)

            palette_opened = open_palette(page)
            if palette_opened:
                ss(page, "v6_palette_2")
                # Now use the direct input setter to clear
                type_in_palette(page, '>code viewer')
                ss(page, "v6_search_gt_codeviewer")

                results2 = check_palette_results(page)
                print(f"  Search '>code viewer': input='{results2['inputVal']}', count={results2['count']}")
                for item in results2['items']:
                    print(f"    - {item['label']} | {item['full'][:60]}")

                # Try just 'codeViewer' (the command ID prefix)
                page.keyboard.press('Escape')
                time.sleep(0.5)
                palette_opened = open_palette(page)
                if palette_opened:
                    type_in_palette(page, 'Run All')
                    ss(page, "v6_search_runall")
                    results3 = check_palette_results(page)
                    print(f"  Search 'Run All': input='{results3['inputVal']}', count={results3['count']}")
                    for item in results3['items']:
                        print(f"    - {item['label']} | {item['full'][:60]}")

                    page.keyboard.press('Escape')
                    time.sleep(0.5)

        # Step 3: Try running via command ID directly in palette
        print("\n[3] Trying to run command via ID...")
        page.mouse.click(960, 400)
        time.sleep(0.5)
        palette_opened = open_palette(page)
        if palette_opened:
            # In VS Code, you can type the command ID directly with '>' prefix
            type_in_palette(page, '>codeViewerBridge.runAllExperiments')
            ss(page, "v6_cmd_id")
            results_id = check_palette_results(page)
            print(f"  Command ID results: {results_id['count']} items, input='{results_id['inputVal']}'")
            for item in results_id['items']:
                print(f"    - {item['full'][:80]}")

            page.keyboard.press('Escape')
            time.sleep(0.5)

        # Step 4: Try via the extension's executeCommand via the web console
        print("\n[4] Trying to trigger command via workbench service...")
        result = page.evaluate("""
            async () => {
                try {
                    // Try to access the VS Code workbench services
                    // In code-server, the workbench is globally accessible
                    if (window.require) {
                        try {
                            const commandService = require('vs/platform/commands/common/commands');
                            return 'require available: ' + JSON.stringify(Object.keys(commandService).slice(0,5));
                        } catch(e) {
                            // Try the AMD loader
                        }
                    }
                    return 'window.require not available';
                } catch(e) {
                    return 'error: ' + e.message;
                }
            }
        """)
        print(f"  Workbench service check: {result}")

        # Try accessing vscode API from main frame
        api_result = page.evaluate("""
            () => {
                // Check if acquireVsCodeApi is available
                if (typeof acquireVsCodeApi === 'function') {
                    const vscodeApi = acquireVsCodeApi();
                    return 'vscodeApi available: ' + JSON.stringify(Object.keys(vscodeApi));
                }
                // Check for workbench global
                if (window.workbench) {
                    return 'workbench global: ' + JSON.stringify(Object.keys(window.workbench).slice(0,5));
                }
                return 'no VS Code API accessible from browser context';
            }
        """)
        print(f"  VS Code API check: {api_result}")

        # Step 5: Try opening Output panel and see current state
        print("\n[5] Opening output panel to see current extension state...")
        page.mouse.click(960, 400)
        time.sleep(0.3)
        page.keyboard.press('Control+Shift+U')
        time.sleep(2)
        ss(page, "v6_output")

        # Try to switch to Code Viewer Experiments channel
        try:
            # Select the output channel
            select_result = page.evaluate("""
                () => {
                    const selects = document.querySelectorAll('select');
                    for (const sel of selects) {
                        const opts = Array.from(sel.options).map(o => o.text);
                        if (opts.some(o => o.includes('Code Viewer'))) {
                            // Find and select the Code Viewer option
                            for (let i = 0; i < sel.options.length; i++) {
                                if (sel.options[i].text.includes('Code Viewer')) {
                                    sel.selectedIndex = i;
                                    sel.dispatchEvent(new Event('change', {bubbles: true}));
                                    return 'selected: ' + sel.options[i].text;
                                }
                            }
                        }
                        return 'available: ' + opts.join(', ');
                    }
                    return 'no select found';
                }
            """)
            print(f"  Output channel select: {select_result}")
        except Exception as e:
            print(f"  Channel select error: {e}")

        time.sleep(1)
        ss(page, "v6_output_channel")

        # Step 6: Try running command via the command palette one more time with correct approach
        print("\n[6] Final attempt to run command...")

        # First, let's check if the extension is visible by looking at extension panel
        page.keyboard.press('Escape')
        time.sleep(0.5)

        page.mouse.click(960, 400)
        time.sleep(0.3)

        # Open command palette properly
        palette_opened = open_palette(page)
        if palette_opened:
            # Get initial state
            init_state = page.evaluate("""
                () => {
                    const input = document.querySelector('.quick-input-box input');
                    return {
                        val: input ? input.value : '',
                        placeholder: input ? input.placeholder : ''
                    };
                }
            """)
            print(f"  Initial state: {init_state}")

            # Clear using keyboard then type command
            # Select all, delete, then type
            page.keyboard.press('Control+a')
            time.sleep(0.1)
            page.keyboard.press('Delete')
            time.sleep(0.1)
            page.keyboard.press('Backspace')
            time.sleep(0.1)

            # Type the command name directly (no '>' needed when opened with F1)
            # Actually in VS Code, F1 opens command palette with '>' already present
            # The input shows '>' and placeholder "Type the name of a command to run."
            # So we should NOT add '>' prefix

            command = 'Code Viewer: Run All Experiments'
            print(f"  Typing command: '{command}'")
            for ch in command:
                page.keyboard.type(ch)
                time.sleep(0.03)
            time.sleep(3)

            final_state = page.evaluate("""
                () => {
                    const input = document.querySelector('.quick-input-box input');
                    const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
                    return {
                        val: input ? input.value : '',
                        rowCount: rows.length,
                        rows: Array.from(rows).map(r => r.innerText.trim().substring(0, 100))
                    };
                }
            """)
            print(f"  Final state: val='{final_state['val']}', rows={final_state['rowCount']}")
            for row in final_state['rows']:
                print(f"    - {row}")

            ss(page, "v6_final_cmd")

            # Even if no matching, press Enter
            page.keyboard.press('Enter')
            time.sleep(3)

        # Step 7: Wait and check output
        print("\n[7] Waiting 20s for any experiments to complete...")
        for i in range(4):
            time.sleep(5)
            elapsed = (i + 1) * 5
            print(f"  {elapsed}s...")
            ss(page, f"v6_wait_{elapsed:02d}s")

        ss(page, "v6_final")

        # Get output
        print("\n=== Output ===")
        content = page.evaluate("""
            () => {
                const sels = ['.output-view-container', '.panel .view-lines', '.panel'];
                for (const sel of sels) {
                    const el = document.querySelector(sel);
                    if (el) {
                        const text = el.innerText.trim();
                        if (text && text.length > 5 && !text.startsWith('Drag a view')) {
                            return {sel, text: text.substring(0, 10000)};
                        }
                    }
                }
                return {sel: 'none', text: ''};
            }
        """)
        print(f"[{content['sel']}]:")
        print(content['text'])

        browser.close()
        print("\nDone.")

if __name__ == '__main__':
    main()
