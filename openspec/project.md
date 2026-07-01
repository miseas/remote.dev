# Project Context

## Purpose
Portable — a local-first Claude Code runtime. The backend (`packages/api`) runs on the user's own
PC; the launcher (`packages/launcher`, `portable start`) publishes it via a Cloudflare Quick Tunnel
+ hosted relay; the Expo/RN app (`packages/mobile`) is the only client. See the root `CLAUDE.md` and
`README.md`.

## Tech Stack
- Bun monorepo — packages: `shared`, `api`, `launcher`, `mobile`.
- **api**: Bun + Express + Socket.IO + `bun:sqlite`, Claude Agent SDK (direct to api.anthropic.com).
- **launcher**: Bun + Ink (React terminal UI); owns cloudflared + the pairing QR. Heavy DI (every
  collaborator is an injectable seam so the lifecycle is testable with fakes).
- **mobile**: Expo SDK 56 / React Native.

## Conventions (Spec-Driven Development)
- SDD lives under `openspec/`. Each change: `openspec/changes/<id>/{proposal,design,tasks}.md` plus
  delta specs under `changes/<id>/specs/<capability>/spec.md`.
- **Acceptance criteria are the requirement scenarios** (`#### Scenario:` WHEN/THEN blocks). A change
  passes when every scenario is demonstrably satisfied (by an automated test or the manual QA steps).
- Requirements use SHALL. Delta headers: `## ADDED Requirements` / `## MODIFIED Requirements`.
- Per-package deep rules live in each package's `CLAUDE.md`.
