---
name: doc-sync
description: Automatically sync documentation with code changes. Use when code changes affect APIs, actions, SDK methods, MUP manifests, or protocol behavior.
user-invocable: true
---

# Doc Sync

Automatically detect and update documentation that is out of sync with code changes.

## Documentation Update Principles

### What triggers a doc update

| Code Change | Docs to Update |
|-------------|---------------|
| New/removed MCP action in handlers.ts | spec/MUP-Spec.md (Actions section), README.md |
| New/removed MUP SDK method (mup-sdk.js) | spec/MUP-Spec.md (SDK section) |
| New/removed system action (bridge.ts) | spec/MUP-Spec.md (System Actions section) |
| New MUP added to mups/ | README.md (MUP list), spec/MUP-Examples.md |
| MUP removed or renamed | README.md, spec/MUP-Examples.md |
| Manifest schema change | spec/schema/manifest.schema.json |
| New function in MUP manifest | That MUP's description in docs |
| Version bump in package.json | README.md badge/version references |
| CLAUDE.md instructions change | Verify alignment with actual behavior |

### What NOT to update

- Internal refactoring (no API change) → no doc update needed
- Test-only changes → no doc update needed
- CSS/styling changes → no doc update needed
- Bug fixes that don't change behavior → no doc update needed

### Doc file responsibilities

| File | Purpose | Update frequency |
|------|---------|-----------------|
| `spec/MUP-Spec.md` | Protocol specification — messages, lifecycle, SDK | On protocol changes |
| `spec/MUP-Examples.md` | Usage examples for MUP developers | On new MUPs or patterns |
| `spec/MUP-Philosophy.md` | Design philosophy — rarely changes | Almost never |
| `README.md` | Project overview, feature list, MUP catalog | On new features/MUPs |
| `SETUP.md` | Installation guide | On dependency/setup changes |
| `mup-mcp-server/README.md` | Server-specific docs, npm usage | On server API changes |
| `CLAUDE.md` | Claude Code instructions | On workflow changes |

### Bilingual rule

- `spec/MUP-Spec.md` ↔ `spec/MUP-Spec.zh-TW.md` must stay in sync
- `spec/MUP-Examples.md` ↔ `spec/MUP-Examples.zh-TW.md` must stay in sync
- `README.md` ↔ `README.zh-TW.md` must stay in sync
- When updating English, also update Traditional Chinese (or flag it)

## Workflow

1. Read `git diff --cached` or recent changes
2. Identify which code changes map to doc updates (using the table above)
3. For each affected doc:
   - Read the current doc
   - Find the specific section that needs updating
   - Make the minimal edit to bring it in sync
   - If bilingual pair exists, update both
4. Report what was updated

## Quick check command

```bash
# Show what actions exist in code vs what's documented
grep -oP 'args\.action === "\K[^"]+' mup-mcp-server/src/handlers.ts | sort
grep -oP 'system\("\K[^"]+' mup-mcp-server/ui/mup-sdk.js | sort
ls mups/
```
