This is a template repository for bootstrapping an agentic SDLC harness.

## Structure

- 'template/' contains common files copied to a Target project; '.harness/' holds shared CLI definitions rendered by scripts/render-integrations.mjs
- 'plans/' contains plans for pluggable components that will be used by the target
- 'components/' is where the component implementations go

The template folder contains copied and hand edited files from an experimental repo. 
They should not (yet) be trusted as authoritative, and the work here will be adjusting, 
validating, and testing them for the moment.
