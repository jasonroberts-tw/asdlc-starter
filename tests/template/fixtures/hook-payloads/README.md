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
| `guard-delivery.refuse.json` | Edits a test the unprovisioned worktree's list protects |
| `guard-delivery.allow.json` | Writes plain echo source in Bob's primary checkout |

Before the hooks run, the checker commits one line to the protected-tests list on the unprovisioned
worktree's branch, and moves the clone's `origin/main` ref onto that commit for the step, so
`guard-delivery`'s refusal has a protected test to refuse. The checker confirms refusal leaves the
worktree registry unchanged.
