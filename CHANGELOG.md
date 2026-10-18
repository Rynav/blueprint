# Changelog

All notable changes to this project. Generated from Conventional Commits.
## [0.3.0] - 2026-10-18

### Bug Fixes
- (**canvas**) keep wires on the pin, and fix rotation units
- shortcut: routing has no obstacle avoidance and only the source end is edge-aligned; upgrade when wires cross parts often.


### Features
- (**spice**) dense LU and modified nodal analysis solver
- shortcut: fixed absolute pivot floor; a conductance below ~1e-12 S would read as singular. Upgrade to a scaled pivot when sub-nanoamp paths matter.
- (**netlist**) union-find connectivity with internal part nets
- shortcut: breadboard rails are a single pin each rather than a row of holes; widen when the rails are redrawn.


### Tests
- (**netlist**) netlist suite and breadboard wiring assertions
- (**spice**) solver suite plus independent cross-checks

## [0.2.0] - 2026-10-18

### Features
- (**canvas**) diagram model, rotation geometry and zustand store
- (**parts**) data-driven registry of 15 components
- shortcut: breadboard models hole pins only, no internal row/rail bus nets; add nets in P2
- (**canvas**) interactive canvas with wiring, selection and notes
- shortcut: elbow routing has no obstacle avoidance and the marquee uses AABB; upgrade if routing quality matters
- (**ui**) parts palette, selection inspector and local persistence


### Maintenance
- enforce conventional commits with a commit-msg hook
- shortcut: hook only checks the subject line, not body/footer format; tighten if footers start drifting


### Tests
- headless integration check

## [0.1.0] - 2026-10-18

### Features
- (**ui**) four-panel blueprint app shell
- shortcut: version string hardcoded in panels.tsx as VERSION; inject from package.json at build time when release automation needs a single source of truth


### Maintenance
- scaffold vite + react + typescript
- add tailwind v4, shadcn/ui and blueprint theme

