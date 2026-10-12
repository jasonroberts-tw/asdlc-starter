**Each deployed command hook has a refusal input and an allowed input that the Guards step runs.**

[The Template test plan](../../../../plans/template-test-plan.md) defines the behavior these fixtures
must exercise. `checks.mjs` reads the actual deployed commands rather than invoking named files itself.

| File | Behavior |
|---|---|
| `README.md` | Coverage and fixture ownership |
| `expectations.json` | Required exit status and stderr reason for each refusal |
| `guard-git.refuse.json` | Requests the prohibited `gh pr create` command |
| `guard-git.allow.json` | Reads Git status |
| `guard-unprovisioned-worktree.refuse.json` | Edits in a linked worktree without an `agent/*` branch |
| `guard-unprovisioned-worktree.allow.json` | Edits in Bob's primary checkout |
| `block-generated-edit.refuse.json` | Writes a file marked as generated |
| `block-generated-edit.allow.json` | Writes plain echo source |
| `worktree-create.refuse.json` | Supplies a name with two path segments |
| `worktree-create.allow.json` | Creates the provisioned `agent/probe` worktree |
| `worktree-remove.refuse.json` | Omits `worktree_path` |
| `worktree-remove.allow.json` | Removes the just-created worktree, retaining its branch |

The checker confirms refusal leaves the worktree registry unchanged, confirms the allowed create
and remove effects, and deletes the probe branch afterwards so it cannot satisfy Work-run evidence.
