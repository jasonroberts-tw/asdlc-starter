**These fixtures supply independent, nonsecret inputs and pinned expectations for the Template test.**

[The Template test plan](../../../plans/template-test-plan.md) wins if a fixture disagrees with its
contract. Hook fixtures are executed through the commands in the deployed Claude settings.

| File | Role |
|---|---|
| `README.md` | Fixture purpose and ownership |
| `values.json` | Dummy project and App identity; omits Tracker remote to exercise the origin default |
| `issue.md` | Work-run task body and echo acceptance criteria |
| `tracker-README.md` | Exact README bytes added by pinned bd 1.3.0 during init |
| `hook-payloads/` | Refuse/allow JSON inputs for every deployed command hook and refusal expectations |

Path markers `__BOB__`, `__UNPROVISIONED__` and `__WORKTREE__` are substituted by the guard checker,
independently of Deploy's named project placeholders. A new command hook requires a fixture pair;
missing coverage fails the Guards step.
