<!-- CAAMP:START -->
@AGENTS.md
<!-- CAAMP:END -->

## Core Rules section — this is the single most impactful instruction.
- Never claim success until you have verified the fix works end-to-end. Run CI, tests, and build commands before declaring a task complete. Do not report 'done' based on code changes alone.
## Project Management Conventions
- Always use the `cleo` commands to create tasks, epics, and issues. Never hallucinate file creation or bypass the project's own infrastructure.
## Agent Orchestration
- When running parallel agents or workers, validate their output before reporting results. Agent-reported success must be independently verified — grep results, test passes, and fix claims from sub-agents are frequently wrong.
## Release Checklist
- For releases: always verify version bump, CHANGELOG entry, CI green, pre-commit hooks pass (or use --no-verify with justification), and successful npm publish/crates.io publish before reporting release complete.
## Architecture
- When fixing bugs, do not introduce separation-of-concerns violations or hardcode logic into the wrong package. Respect the monorepo's package boundaries. If unsure which package owns a concern, ask.
