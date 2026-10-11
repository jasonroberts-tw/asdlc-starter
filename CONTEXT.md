# ASDLC Starter

A template repository for bootstrapping an agentic SDLC harness into new projects, plus the pluggable components and tests that go with it.

## Language

### The harness

**Template**:
The files under `template/` that become a Target project's harness once deployed.
_Avoid_: starter, skeleton, scaffold

**Target project**:
A git repository the Template has been deployed into.
_Avoid_: target repo, consumer, downstream project

**Pluggable component**:
An optional part of the harness, planned under `plans/` and built under `components/`, that can be deployed alongside the Template.
_Avoid_: "component" on its own, module, plugin (a Claude Code term)

**Deploy**:
The one-time act of putting the Template into a Target project when the project is created.
_Avoid_: bootstrap, install, scaffold, instantiate

**Bootstrap**:
Setting up one machine to work in an existing Target project; repeated on every machine.
_Avoid_: deploy, setup, provision

**Tracker**:
A Target project's beads issue database, shared through origin; Deploy creates it and Bootstrap hydrates it.
_Avoid_: task store, issue database, beads DB

### Testing

**Template test**:
The test that deploys the Template into a fresh Target project, validates the result, and has an agent do a small piece of work there.
_Avoid_: component test, e2e test, smoke test

**Canary**:
The Template test's first agent run: a bare headless prompt with no harness workflow, in a throwaway clone, that proves the agent can work in the Target project at all.
_Avoid_: smoke run, raw run

**Work run**:
The Template test's second agent run: the same small piece of work done through the harness's own issue-to-merge workflow.
_Avoid_: full run, harness run
