# .etna/ — Agent Etna's footprint

This directory is maintained by **Agent Etna**. It's the single, recognizable
place where Etna records how it shapes this agent — so its footprint is easy to
find, review, and audit, and travels with your code.

- **`agent.json`** — the canonical, machine-readable contract: the behavioral
  calibration (purpose, audience, in/out of scope, difficulty), the derived
  guardrails, and the full change history.
- **`agent.md`** — the same in plain language: a behavioral "constitution"
  plus a newest-first log of every change Etna has applied.

These files contain no secrets and are safe to read and keep. You can stop
using Agent Etna at any time and this record stays in your repo.
