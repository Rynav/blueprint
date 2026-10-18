# Changelog

All notable changes to this project. Generated from Conventional Commits.
## [Unreleased]

### Maintenance
- enforce conventional commits with a commit-msg hook
- shortcut: hook only checks the subject line, not body/footer format; tighten if footers start drifting

## [0.1.0] - 2026-10-18

### Features
- (**ui**) four-panel blueprint app shell
- shortcut: version string hardcoded in panels.tsx as VERSION; inject from package.json at build time when release automation needs a single source of truth


### Maintenance
- scaffold vite + react + typescript
- add tailwind v4, shadcn/ui and blueprint theme

