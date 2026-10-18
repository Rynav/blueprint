# Changelog

All notable changes to this project. Generated from Conventional Commits.
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

