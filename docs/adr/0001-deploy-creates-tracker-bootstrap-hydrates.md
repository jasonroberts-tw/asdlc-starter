# Deploy creates the Tracker; Bootstrap only hydrates it

A Target project's Tracker is created exactly once, by Deploy (`bd init`), which pushes it to origin with the initial commit; Bootstrap, on every machine, only ever hydrates it from origin (`bd bootstrap`) and never runs `bd init`. If Bootstrap created a Tracker whenever it found none, two machines bootstrapping a new project would each create their own and diverge, which is why the Template's entrypoint already says never to `bd init`.

## Considered Options

- **Bootstrap runs `bd init` when origin has no Tracker.** Rejected: "no Tracker on origin" also describes a failed fetch, or a Deploy that never pushed, and guessing wrong splits the Tracker in two without a word.
- **The person creating the project runs `bd init` by hand.** Rejected: a step only a person remembers is the drift the harness exists to remove, and the Template test could not check it.

## Consequences

- Deploy needs an origin that exists and that it can push to, because the Tracker is pushed there.
- A Bootstrap that finds no Tracker on origin warns and creates nothing; that warning means Deploy did not finish.
