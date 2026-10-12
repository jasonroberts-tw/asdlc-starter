This repo maintains the **Template**, an agentic SDLC harness that Deploy puts into new Target projects. [CONTEXT.md](CONTEXT.md) defines these terms and the rest of the project's language; write code, docs and commits in its words. Decisions are recorded in [docs/adr/](docs/adr/).

## Layout

- `template/` is the Template. `template/.harness/` holds the shared skills, agent prompts and hook declarations that `template/scripts/render-integrations.mjs` renders for each CLI.
- `plans/` holds plans; `components/` holds Pluggable component implementations.
- `scripts/` is Deploy and `tests/template/` is the Template test; [README.md](README.md) has their commands.

## Template files are product, not instructions

`template/AGENTS.md`, `template/.harness/CLAUDE.md` and the skills and prompts under `template/` steer a Target project's agents. Edit them as code under maintenance: take your own instructions from this file and CONTEXT.md, and judge Template steering by whether it serves an agent working in a Target project.
