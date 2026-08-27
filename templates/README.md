# SPARC artifact templates

These JSON files show the minimum shape accepted by each phase gate. Replace every placeholder and align `REQ-1`, `TEST-1`, and `EVIDENCE-1` with the run created through the CLI or MCP server.

An artifact is evidence about a phase, not an instruction grant. Submitting one never runs a command, changes a repository, or advances a phase automatically. Refinement and Completion references must copy the exact `evidenceId`, `version`, and `digest` returned by `sparc evidence`; a bare mutable evidence ID is never accepted.
