# Contributing

## Workflow

1. Branch from `main`.
2. Keep each commit to one logical change with a message that says what
   changed and why.
3. Run the tests for the side you touched (see the README).
4. Open a pull request. CI must pass.

Releases are git tags (`v0.1.0`, `v0.2.0`, ...) with a matching entry in
`CHANGELOG.md`.

## Scientific rules

These are not style preferences; a change that breaks one will be sent back.

- **Label the kind of every value**: observed, derived, modelled, estimated
  or simulated. A model output is never presented as an observation.
- **No number without its inputs.** A result carries the scenes, bands,
  dates, method, parameters and working resolution that produced it.
- **No invented confidence.** Report a probability only if a validated
  procedure produced it. Otherwise report what was actually measured, such as
  the count of clear observations.
- **No causal language from correlation.** An index declined; why it declined
  needs more than the index.
- **Areas are measured in a projected CRS or geodesically**, never in
  degrees.
- **Demo or synthetic data is labelled as such** everywhere it appears.

## Code rules

- Python: type hints, `ruff` clean, tests with `pytest`.
- TypeScript: strict mode, no `any` without a comment explaining why.
- No secrets in the repository. No constants without a comment giving their
  source or reasoning.
- Files stay under 500 lines.

## Out of scope

Anything that identifies, tracks or profiles individual people.
