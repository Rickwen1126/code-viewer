# Repo-local Agent Skills

This repo keeps a local mirror of selected Claude skills under `.agents/skills/`.

Source of truth:
- `.claude/skills/<name>/SKILL.md`

Repo-local Codex/agent target:
- `.agents/skills/<name>/SKILL.md`

Sync rules for this repo:
- Sync one skill at a time unless the source skill has an explicit prerequisite.
- Keep the repo-local copy as close to the source as possible; adapt only pathing or wording that is specific to the local agent runtime.
- If `/e2e-test` is synced, sync `/codeview-dev` together because E2E depends on dev startup.
- Prefer repo-local skills for repo-specific workflows instead of editing global `~/.codex/skills`.
