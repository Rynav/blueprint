# blueprint

A web playground for building and simulating electronics projects: a blueprint-style
canvas, a parts library, wiring, labels/notes, and in-browser Arduino C++ compilation.

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui

## Package manager: bun

This project uses **bun**. `node` and `npm` are intentionally not used — `bun.lock`
is the lockfile and must be committed. Use `bun` / `bunx` for everything.

## Scripts

| Command                | What it does                                             |
| ---------------------- | -------------------------------------------------------- |
| `bun dev`              | Start the Vite dev server with HMR.                      |
| `bun run build`        | Type-check (`tsc -b`) and build for production.          |
| `bun run lint`         | Run oxlint.                                              |
| `bun run changelog`    | Regenerate `CHANGELOG.md` from Conventional Commits.     |

Other scripts: `bun run preview` (serve the production build), `bun run changelog:preview`
(print unreleased entries without writing the file).

## Status / roadmap

| Phase | Scope                                  | Status |
| ----- | -------------------------------------- | ------ |
| P0    | App shell (four-panel blueprint layout) | done   |
| P1    | Canvas editor (pan, zoom, parts, wiring) | –      |
| P2    | SPICE core (analog simulation)          | –      |
| P3    | Blink end-to-end (in-browser Arduino C++ compile) | – |
| P4    | Library expansion                       | –      |
| P5    | Pico simulation                         | –      |

## Conventional Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org)
(`type(scope): summary`). Deliberate simplifications are noted in the commit body with a
`shortcut: ...` line.

`CHANGELOG.md` is **generated from these commits by git-cliff** (config in `cliff.toml`) —
do not hand-edit it. Run `bun run changelog` to regenerate.
