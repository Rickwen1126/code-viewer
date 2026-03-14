"""
Lifecycle Spike Experiment
Tests Extension Host lifecycle: start on connect, survive after disconnect?
"""

import asyncio
import subprocess
import time
from playwright.async_api import async_playwright

PS_CMD = [
    "docker", "compose",
    "-f", "/Users/rickwen/code/code-viewer/experiments/docker-compose.yml",
    "exec", "code-server",
    "ps", "aux"
]

def run_ps_grep(label: str) -> str:
    """Run ps aux and grep for extension host processes."""
    print(f"\n{'='*60}")
    print(f"[{label}] Running ps aux | grep extension...")
    print(f"{'='*60}")
    try:
        ps_result = subprocess.run(PS_CMD, capture_output=True, text=True, timeout=30)
        full_output = ps_result.stdout + ps_result.stderr
        # Filter for extension-related lines
        lines = full_output.splitlines()
        ext_lines = [l for l in lines if any(
            term in l.lower() for term in ["extensionhost", "exthost", "extension"]
        )]
        if ext_lines:
            filtered = "\n".join(ext_lines)
        else:
            filtered = "(no extension host processes found)"
        print(filtered)
        return filtered
    except Exception as e:
        msg = f"ERROR running ps: {e}"
        print(msg)
        return msg

def run_logs() -> str:
    """Get test-backend logs."""
    print(f"\n{'='*60}")
    print("[STEP 4] Fetching test-backend logs...")
    print(f"{'='*60}")
    try:
        result = subprocess.run(
            [
                "docker", "compose",
                "-f", "/Users/rickwen/code/code-viewer/experiments/docker-compose.yml",
                "logs", "test-backend"
            ],
            capture_output=True, text=True, timeout=30
        )
        output = result.stdout + result.stderr
        print(output)
        return output
    except Exception as e:
        msg = f"ERROR fetching logs: {e}"
        print(msg)
        return msg

async def main():
    results = {}

    # ----------------------------------------------------------------
    # STEP 1: Open browser, handle trust dialog, wait 10s, check ps
    # ----------------------------------------------------------------
    print("\n" + "="*60)
    print("STEP 1: Opening browser and connecting to http://localhost:8080")
    print("="*60)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        print("Navigating to http://localhost:8080 ...")
        await page.goto("http://localhost:8080", wait_until="domcontentloaded", timeout=30000)

        # Handle trust dialog if it appears
        print("Checking for trust dialog...")
        try:
            trust_btn = page.get_by_role("button", name="Yes, I trust the authors")
            await trust_btn.wait_for(timeout=8000)
            print("Trust dialog found - clicking 'Yes, I trust the authors'")
            await trust_btn.click()
            print("Trust dialog dismissed.")
        except Exception:
            print("No trust dialog found (or already trusted).")

        print("Waiting 10 seconds for Extension Host to fully start...")
        await asyncio.sleep(10)

        results["step1"] = run_ps_grep("STEP 1 - Browser connected, 10s after load")

        # ----------------------------------------------------------------
        # STEP 2: Close browser and check ps after 5s
        # ----------------------------------------------------------------
        print("\n" + "="*60)
        print("STEP 2: Closing browser completely...")
        print("="*60)
        await browser.close()
        print("Browser closed.")

    print("Waiting 5 seconds after browser close...")
    await asyncio.sleep(5)

    results["step2"] = run_ps_grep("STEP 2 - 5s after browser disconnect")

    # ----------------------------------------------------------------
    # STEP 3: Wait another 15s (total 20s) and check again
    # ----------------------------------------------------------------
    print("\nWaiting another 15 seconds (total ~20s after disconnect)...")
    await asyncio.sleep(15)

    results["step3"] = run_ps_grep("STEP 3 - 20s after browser disconnect")

    # ----------------------------------------------------------------
    # STEP 4: Check test-backend WebSocket logs
    # ----------------------------------------------------------------
    results["step4"] = run_logs()

    # ----------------------------------------------------------------
    # FINAL SUMMARY
    # ----------------------------------------------------------------
    print("\n\n" + "="*60)
    print("FINAL SUMMARY")
    print("="*60)
    print("\n[STEP 1 - Browser connected, 10s after load]")
    print(results["step1"])
    print("\n[STEP 2 - 5s after browser disconnect]")
    print(results["step2"])
    print("\n[STEP 3 - 20s after browser disconnect]")
    print(results["step3"])
    print("\n[STEP 4 - test-backend WebSocket logs]")
    print(results["step4"])

if __name__ == "__main__":
    asyncio.run(main())
