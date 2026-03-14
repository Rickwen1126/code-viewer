#!/usr/bin/env python3
"""Phase A: Chat Session format reverse engineering.

Reads VS Code 1.111.0 SQLite databases directly (no Extension needed).
Outputs structured JSON to experiments/desktop-results/a*.json.
"""

import json
import sqlite3
import sys
import base64
import os
from pathlib import Path
from datetime import datetime

WORKSPACE_STORAGE = Path.home() / "Library/Application Support/Code/User/workspaceStorage"
TARGET_WORKSPACE = "225bf85cde240ff7fb78927c4f23b4ea"
OUTPUT_DIR = Path(__file__).parent / "desktop-results"


def read_sqlite_value(db_path: str, key: str) -> str | None:
    """Read a single value from VS Code's ItemTable."""
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cursor = conn.execute("SELECT value FROM ItemTable WHERE key = ?", (key,))
        row = cursor.fetchone()
        conn.close()
        return row[0] if row else None
    except sqlite3.Error as e:
        print(f"  SQLite error reading {key}: {e}", file=sys.stderr)
        return None


def read_sqlite_keys(db_path: str, pattern: str = "%") -> list[str]:
    """List keys matching a pattern from VS Code's ItemTable."""
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cursor = conn.execute(
            "SELECT key FROM ItemTable WHERE key LIKE ?", (pattern,)
        )
        keys = [row[0] for row in cursor.fetchall()]
        conn.close()
        return keys
    except sqlite3.Error as e:
        print(f"  SQLite error listing keys: {e}", file=sys.stderr)
        return []


def decode_resource_uri(resource: str) -> dict:
    """Decode a vscode-chat-session:// resource URI."""
    result = {"raw": resource}
    try:
        # Format: vscode-chat-session://local/<base64_session_id>
        parts = resource.split("/")
        if len(parts) >= 4:
            b64_part = parts[-1]
            # Add padding if needed
            padded = b64_part + "=" * (4 - len(b64_part) % 4) if len(b64_part) % 4 else b64_part
            decoded = base64.b64decode(padded).decode("utf-8")
            result["decoded_session_id"] = decoded
            result["provider"] = parts[2] if len(parts) > 2 else None
    except Exception as e:
        result["decode_error"] = str(e)
    return result


# ─── A1: Parse memento/interactive-session ────────────────────────────

def experiment_a1() -> dict:
    """Parse the complete interactive-session structure from workspace SQLite."""
    print("━━━ A1: Parse memento/interactive-session ━━━")

    db_path = WORKSPACE_STORAGE / TARGET_WORKSPACE / "state.vscdb"
    if not db_path.exists():
        return {"status": "fail", "error": f"Database not found: {db_path}"}

    raw = read_sqlite_value(str(db_path), "memento/interactive-session")
    if not raw:
        return {"status": "fail", "error": "Key not found in database"}

    data = json.loads(raw)
    result = {
        "status": "pass",
        "workspace": TARGET_WORKSPACE,
        "db_path": str(db_path),
        "raw_size_bytes": len(raw),
        "top_level_keys": list(data.keys()),
    }

    # Analyze history structure
    if "history" in data:
        history = data["history"]
        result["history_providers"] = list(history.keys())

        for provider, entries in history.items():
            provider_analysis = {
                "entry_count": len(entries),
                "sample_fields": [],
                "has_copilot_responses": False,
                "models_used": set(),
                "modes_used": set(),
            }

            for i, entry in enumerate(entries):
                if i == 0:
                    provider_analysis["sample_fields"] = list(entry.keys())

                # Track models
                if "selectedModel" in entry:
                    model = entry["selectedModel"]
                    if isinstance(model, dict) and "identifier" in model:
                        provider_analysis["models_used"].add(model["identifier"])

                # Track modes
                if "mode" in entry:
                    mode = entry["mode"]
                    if isinstance(mode, dict) and "kind" in mode:
                        provider_analysis["modes_used"].add(mode["kind"])

                # Check for response content (not just user input)
                if entry.get("inputText"):
                    provider_analysis["has_copilot_responses"] = True

            # Convert sets to lists for JSON
            provider_analysis["models_used"] = sorted(provider_analysis["models_used"])
            provider_analysis["modes_used"] = sorted(provider_analysis["modes_used"])

            result[f"provider_{provider}"] = provider_analysis

    # Also check interactive-session-view-copilot
    view_raw = read_sqlite_value(str(db_path), "memento/interactive-session-view-copilot")
    if view_raw:
        view_data = json.loads(view_raw)
        result["view_copilot"] = {
            "exists": True,
            "top_level_keys": list(view_data.keys()) if isinstance(view_data, dict) else type(view_data).__name__,
            "size_bytes": len(view_raw),
        }
        # Analyze if it contains full conversations with responses
        if isinstance(view_data, dict) and "history" in view_data:
            view_history = view_data["history"]
            for provider, entries in view_history.items():
                result[f"view_{provider}_count"] = len(entries)
    else:
        result["view_copilot"] = {"exists": False}

    # Check ChatSessionStore.index for session ID mapping
    index_raw = read_sqlite_value(str(db_path), "chat.ChatSessionStore.index")
    if index_raw:
        index_data = json.loads(index_raw)
        result["session_store_index"] = {
            "version": index_data.get("version"),
            "session_count": len(index_data.get("entries", {})),
            "session_fields": [],
            "sessions": [],
        }
        entries = index_data.get("entries", {})
        for session_id, session_meta in list(entries.items())[:5]:
            if not result["session_store_index"]["session_fields"]:
                result["session_store_index"]["session_fields"] = list(session_meta.keys())
            result["session_store_index"]["sessions"].append({
                "sessionId": session_id,
                "title": session_meta.get("title", ""),
                "created": session_meta.get("timing", {}).get("created"),
                "lastRequestStarted": session_meta.get("timing", {}).get("lastRequestStarted"),
                "lastResponseState": session_meta.get("lastResponseState"),
                "isEmpty": session_meta.get("isEmpty"),
                "initialLocation": session_meta.get("initialLocation"),
            })

    # Check agentSessions for corresponding data
    agent_state_raw = read_sqlite_value(str(db_path), "agentSessions.state.cache")
    if agent_state_raw:
        agent_state = json.loads(agent_state_raw)
        result["agent_sessions_state"] = {
            "exists": True,
            "type": type(agent_state).__name__,
            "size_bytes": len(agent_state_raw),
        }
        if isinstance(agent_state, list):
            result["agent_sessions_state"]["count"] = len(agent_state)
        elif isinstance(agent_state, dict):
            result["agent_sessions_state"]["keys"] = list(agent_state.keys())[:10]

    print(f"  ✓ Parsed {len(raw)} bytes, {len(data.get('history', {}))} history providers")
    return result


# ─── A2: Parse agentSessions.model.cache ──────────────────────────────

def experiment_a2() -> dict:
    """Parse the agentSessions model cache structure."""
    print("━━━ A2: Parse agentSessions.model.cache ━━━")

    db_path = WORKSPACE_STORAGE / TARGET_WORKSPACE / "state.vscdb"
    raw = read_sqlite_value(str(db_path), "agentSessions.model.cache")
    if not raw:
        return {"status": "fail", "error": "agentSessions.model.cache not found"}

    data = json.loads(raw)
    result = {
        "status": "pass",
        "raw_size_bytes": len(raw),
        "data_type": type(data).__name__,
    }

    if isinstance(data, list):
        result["total_sessions"] = len(data)

        # Analyze session type distribution
        type_distribution = {}
        status_distribution = {}
        provider_distribution = {}
        models_used = {}
        sessions_with_content = 0
        sessions_sample = []

        for i, session in enumerate(data):
            # Decode resource URI
            resource = session.get("resource", "")
            decoded = decode_resource_uri(resource)

            # Track provider types
            provider = session.get("providerType", "unknown")
            provider_distribution[provider] = provider_distribution.get(provider, 0) + 1

            # Track status
            status = session.get("status", "unknown")
            status_distribution[str(status)] = status_distribution.get(str(status), 0) + 1

            # Track labels/types
            label = session.get("label", "")
            if label:
                sessions_with_content += 1

            # Track icon (often indicates type)
            icon = session.get("icon", "unknown")
            type_distribution[icon] = type_distribution.get(icon, 0) + 1

            # Sample first 5 sessions with decoded URIs
            if i < 5:
                sample = {
                    "index": i,
                    "label": label[:80] if label else "",
                    "providerType": provider,
                    "providerLabel": session.get("providerLabel", ""),
                    "icon": icon,
                    "status": status,
                    "resource_decoded": decoded,
                }
                if "timing" in session:
                    timing = session["timing"]
                    sample["timing"] = {
                        "created": datetime.fromtimestamp(timing["created"] / 1000).isoformat() if timing.get("created") else None,
                        "lastRequestStarted": datetime.fromtimestamp(timing["lastRequestStarted"] / 1000).isoformat() if timing.get("lastRequestStarted") else None,
                    }
                sessions_sample.append(sample)

        result["type_distribution"] = type_distribution
        result["status_distribution"] = status_distribution
        result["provider_distribution"] = provider_distribution
        result["sessions_with_labels"] = sessions_with_content
        result["sample_sessions"] = sessions_sample

        # Get the full field list from first session
        if data:
            result["session_fields"] = list(data[0].keys())

    print(f"  ✓ Parsed {len(raw)} bytes, {result.get('total_sessions', 0)} sessions")
    return result


# ─── A3: Cross-workspace comparison ──────────────────────────────────

def experiment_a3() -> dict:
    """Compare chat data structure across multiple workspaces."""
    print("━━━ A3: Cross-workspace comparison ━━━")

    result = {
        "status": "pass",
        "workspaces_checked": 0,
        "workspaces_with_chat": 0,
        "chat_sessions_dirs_empty": 0,
        "chat_sessions_dirs_with_files": 0,
        "key_structure_consistent": True,
        "workspace_details": [],
    }

    # Find workspaces with state.vscdb
    workspace_dirs = []
    if WORKSPACE_STORAGE.exists():
        for d in WORKSPACE_STORAGE.iterdir():
            if d.is_dir() and (d / "state.vscdb").exists():
                workspace_dirs.append(d)

    # Sample up to 10 workspaces (including target)
    sampled = workspace_dirs[:10]
    reference_keys = None

    for ws_dir in sampled:
        result["workspaces_checked"] += 1
        ws_id = ws_dir.name
        db_path = ws_dir / "state.vscdb"

        ws_info = {
            "workspace_id": ws_id,
            "is_target": ws_id == TARGET_WORKSPACE,
        }

        # Check for chat-related keys
        chat_keys = read_sqlite_keys(str(db_path), "%chat%")
        session_keys = read_sqlite_keys(str(db_path), "%session%")
        copilot_keys = read_sqlite_keys(str(db_path), "%copilot%")
        agent_keys = read_sqlite_keys(str(db_path), "%agent%")

        all_relevant_keys = sorted(set(chat_keys + session_keys + copilot_keys + agent_keys))
        ws_info["relevant_keys"] = all_relevant_keys
        ws_info["key_count"] = len(all_relevant_keys)

        if all_relevant_keys:
            result["workspaces_with_chat"] += 1

            # Check consistency with reference
            if reference_keys is None:
                reference_keys = set(all_relevant_keys)
            else:
                if set(all_relevant_keys) != reference_keys:
                    result["key_structure_consistent"] = False
                    ws_info["missing_vs_reference"] = sorted(reference_keys - set(all_relevant_keys))
                    ws_info["extra_vs_reference"] = sorted(set(all_relevant_keys) - reference_keys)

        # Check chatSessions directory
        chat_sessions_dir = ws_dir / "chatSessions"
        if chat_sessions_dir.exists():
            files = list(chat_sessions_dir.iterdir())
            ws_info["chatSessions_dir_exists"] = True
            ws_info["chatSessions_file_count"] = len(files)

            # Check if files are empty
            non_empty = 0
            for f in files[:20]:
                if f.is_file() and f.stat().st_size > 0:
                    non_empty += 1
            ws_info["chatSessions_non_empty_files"] = non_empty

            if non_empty > 0:
                result["chat_sessions_dirs_with_files"] += 1
            else:
                result["chat_sessions_dirs_empty"] += 1
        else:
            ws_info["chatSessions_dir_exists"] = False

        # Check session count from index
        index_raw = read_sqlite_value(str(db_path), "chat.ChatSessionStore.index")
        if index_raw:
            try:
                index_data = json.loads(index_raw)
                ws_info["session_index_version"] = index_data.get("version")
                ws_info["session_count"] = len(index_data.get("entries", {}))
            except json.JSONDecodeError:
                ws_info["session_index_parse_error"] = True

        # Try to identify workspace path from workspace.json
        workspace_json = ws_dir / "workspace.json"
        if workspace_json.exists():
            try:
                wj = json.loads(workspace_json.read_text())
                ws_info["workspace_path"] = wj.get("folder", wj.get("configuration", "unknown"))
            except (json.JSONDecodeError, IOError):
                pass

        result["workspace_details"].append(ws_info)

    # Summary
    result["format_migration_confirmed"] = (
        result["chat_sessions_dirs_empty"] > 0
        and result["chat_sessions_dirs_with_files"] == 0
    )
    result["summary"] = (
        f"Checked {result['workspaces_checked']} workspaces, "
        f"{result['workspaces_with_chat']} have chat data, "
        f"key structure {'consistent' if result['key_structure_consistent'] else 'varies'}, "
        f"chatSessions dirs: {result['chat_sessions_dirs_empty']} empty, "
        f"{result['chat_sessions_dirs_with_files']} with files"
    )

    print(f"  ✓ {result['summary']}")
    return result


# ─── Main ─────────────────────────────────────────────────────────────

def main():
    print("╔══════════════════════════════════════════╗")
    print("║  Phase A: Chat Session Format Analysis   ║")
    print("╚══════════════════════════════════════════╝")
    print(f"Workspace storage: {WORKSPACE_STORAGE}")
    print(f"Target workspace: {TARGET_WORKSPACE}")
    print(f"Output directory: {OUTPUT_DIR}")
    print()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    experiments = [
        ("a1-session-format.json", experiment_a1),
        ("a2-agent-sessions.json", experiment_a2),
        ("a3-cross-workspace.json", experiment_a3),
    ]

    all_results = {
        "timestamp": datetime.now().isoformat(),
        "phase": "A",
        "description": "Chat Session format reverse engineering",
    }

    for filename, fn in experiments:
        try:
            result = fn()
        except Exception as e:
            result = {"status": "fail", "error": str(e)}
            print(f"  ✗ FAIL: {e}")

        output_path = OUTPUT_DIR / filename
        output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False))
        print(f"  → {output_path}")
        all_results[filename.replace(".json", "")] = result["status"]
        print()

    # Summary
    print("╔══════════════════════════════════════════╗")
    print("║              SUMMARY                     ║")
    print("╚══════════════════════════════════════════╝")
    for key, status in all_results.items():
        if key in ("timestamp", "phase", "description"):
            continue
        icon = "✓" if status == "pass" else "✗"
        print(f"  {icon} {key}: {status}")


if __name__ == "__main__":
    main()
