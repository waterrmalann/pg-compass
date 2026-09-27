# Overview

This is a **Turborepo** powered monorepo for **PG Compass**, a **MongoDB Compass** inspired database viewer for **PostgreSQL** built with **React and Electron**
- `apps/desktop`: The desktop application built with Electron.

> [!IMPORTANT]
> Before performing any task, implementation or code change, you **MUST** internalize: `docs/PROJECT_CONTEXT.md` to understand the project context (needs). Any frontend UI work should also be aligned with `docs/DESIGN.md` (the Quiet Utility design system). **No implementation may violate these documents.**

>[!IMPORTANT]
> You **must** read the `AGENTS.md` if-present inside the relevant codebase mono-repositories (`/apps/*`) you're working with to understand the architectural and design decisions.

> ℹ️ Meaningful changes must also update the relevant documentation to reflect the new state. The documents themselves should be kept concise and to the point, avoiding unnecessary verbosity.

## Tech Stack

> 📦 We use `pnpm` as our package manager. Always use `pnpm` and `pnpm dlx` when running commands.

Since we're on a monorepo, never `cd` into a package to run commands. Always run commands from the root of the repository, and use `--filter` flags to specify the package.

**Electron**

## Coding Guidelines

1. **KISS (Keep it Simple, Stupid):** Favor the simplest correct solution. Avoid unnecessary abstraction, indirection, or premature optimization.
2. **YAGNI (You Ain't Gonna Need This):** Do not add functionality, abstractions, or complexity until it is actually required.
3. **DRY (Don't Repeat Yourself):** Avoid code duplication. Extract reusable logic into functions, hooks, or components.
4. **PRY (Please Repeat Yourself):** While DRY is important, it is more important to write code that has the least cognitive overhead. Repetition is often better than a complex abstraction.
5. **Explicit > Implicit:** Avoid implicit logic, clever tricks, or compact expressions. Prefer self-describing intermediate variables to reduce working memory load.
6. **Linear Readability:** Avoid deeply nested blocks, prefer early returns, keep happy paths obvious.

## Decision Records

Everytime you make an architectural or project-wide decision, you should document it in `docs/decisions/{NAME}_ADR.md` with a title, a short description, the decision itself, rationale, status, and consequences. This helps maintain a clear record of why certain choices were made.

## Tasks

If you're operating from a task file (`docs/tasks/*.md`), make sure to update the relevant task file with any progress, implementation details, and completion status. This ensures that all stakeholders are informed of the current state of the task and can refer back to it for context. Avoid writing file paths or code snippets in the task files that may become outdated; instead, focus on describing the implementation and linking to the relevant code if necessary.