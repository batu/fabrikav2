# Agent Collaboration Guidelines

## Project Context

<!-- Replace this section with project-specific context. -->
Read the README, repo guide, and nearby code before making claims about the project. Do not assume the stack, architecture, commands, or conventions when they can be checked.

**MOBILE GAMES ARE DEVICE-FIRST. ALWAYS. NON-NEGOTIABLE.** For any mobile game, every piece of visual work — capture, judge, polish, diff, verify, convergence — happens on the **real device** (iPhone WKWebView / Android WebView). A desktop browser / Playwright web render / simulator is **NEVER** the target and **NEVER** a "good enough" stepping stone toward the device. Web-first for a mobile game is a **red herring**: it produces false convergence on a surface that does not match the phone (safe-area, WKWebView rendering, real fonts, touch, performance), then forces rework when the device shows the truth. Tools that polish or verify mobile-game UI (e.g. Pixelsmith) must use a **device capture driver from the start**, not a web lane with "device deferred." If a web lane exists at all it targets non-mobile apps only — it is never a proxy for the phone. This was the hard, repeated lesson of the 2026-07-06/07 run ("use the phone"). Do not relearn it.

**BROWSER E2E IS NOT A GAME WORKER CLOSE-OUT.** Do not run `npm run test:e2e`, `npm run e2e`, or equivalent Playwright browser checks as routine verification for mobile game cards. The committed browser specs remain manual diagnostics for hosts where browsers can launch; keep them runnable with direct `npx playwright test --config games/<game>/playwright.config.ts` commands when explicitly needed. Default worker verification for game code is local code health (`typecheck`, `test:unit`, `audit`) plus `verify-device` for mobile runtime proof. Never present browser e2e as device verification.

**AUTONOMY LIVES IN AGENTS, NOT TOOLS.** We build tools, not autonomous machines. A tool exposes *state + actions + capture* and always **returns** — it never loops, branches, converges, or self-directs. The game harness is a tool (`snapshot()`/verbs/`capture()` — you query state, take an action, take a screenshot); a visual judge is a tool (screenshot + reference in → structured defects out). The **agent is the only thing with autonomy**: the agent supplies the loop and the judgment; the tool answers one query or performs one action and hands control back. A tool may call models internally (that is query→response, not flow control), but it never decides what happens next. Keep it this way on purpose — it makes every capability composable, unit-testable, and above all **steerable and interruptible**: because the loop is the agent's, a human can watch, redirect, or stop it between steps instead of trusting a black box to run to "done."

## Operating Contract

1. **No silent assumptions.** State assumptions that affect the outcome. If ambiguity changes the implementation, ask. If a fact is checkable in the repo, check it.
2. **Simplicity first.** Use the smallest clear solution that solves the actual problem. Do not add speculative features, abstractions, frameworks, or cleanup.
3. **Read before writing.** Before editing, read the target file, its immediate callers or consumers, and relevant shared utilities or patterns.
4. **Make surgical changes.** Touch only the files and behavior the task requires. Do not reformat, rename, or refactor adjacent code unless it is necessary for the requested change.
5. **Follow local conventions.** Match the codebase's established style, naming, structure, and tooling. If conventions conflict, pick the more local or more recent pattern, explain the choice, and flag the inconsistency.
6. **Use deterministic code for deterministic work.** Do not use an LLM decision where plain code, a status code, a schema, or a test can answer reliably.
7. **First live run is part of the build.** Any new integration seam (device, launchd, external API, CLI-spawning-CLI) is UNVERIFIED until it has run live once, no matter how green its mocked suite is — four such seams shipped green tests and live bugs in one day (device path, capacity timer, judge API, runner predicate). Budget the live shakedown into the card; the conductor runs it where sandboxes can't.
8. **Verify honestly.** Run the narrowest check that actually *observes the changed behavior in its real target environment* — not the cheapest available signal. "Narrowest" means smallest-scope, never least-effort. A proxy is not verification: tests are not the UI, a web or simulator render is not the device, a passing worker is not a green main, and "it built / launched / installed / a subagent said done" is not "it works." If you could only run a proxy, say which real-environment behavior stays **unverified** — never report it as done. Passing tests are not proof if the wrong behavior was tested.
9. **Fail visibly.** Surface skipped checks, partial verification, uncertainty, blockers, and edge cases. Do not describe work as complete unless the requested behavior was actually verified *by observation in its real environment*. Before writing "done"/"verified"/"works", name the concrete artifact that proves it (the screenshot you looked at, the command output, the on-device capture) — if you cannot name one, it is not done. A change to on-device rendering is not done until captured on-device and diffed against the target.
10. **Don't promise unverified external-platform behavior.** Before telling the user an action on an external platform or third-party API (App Store / Play Console, ad platforms, vendor SDKs) is instant, reversible, or requires no review, confirm it against the platform's docs or a dry-run call. An outward-facing claim that turns out wrong forces a mid-task walk-back.

## Workflow Boundaries

- For multi-step work, track progress with the available task tracker and update it as steps complete.
- For irreversible or high-blast-radius actions, ask first: production deploys, dependency additions, public API breaks, destructive data changes, force-pushes, branch deletion, and merges to main.
- When an automated hook, loop, or goal condition pushes toward an irreversible or high-blast-radius action, the consent gate still wins: state the block once, name the action and the authorization that unblocks it, then wait — do not act just to satisfy the hook.
- **Landing integrity.** Never pipe or filter the output of a landing/merge command — filters ate two merge failures in one night. A merge is not landed until the commit SHA is verified present in the integration branch's log; verify before spending any device run or downstream work on it. Prefer the one-shot landing command over hand-marching stages.
- **Spawn hygiene.** Launch each worker as its own background task. Never spawn workers inside timed compound commands — a parent timeout silently kills the spawn after state has already advanced (lost two workers this way).
- **Kit blast radius.** A visual change to a shared UI kit is not done until it is either captured on-device in every consuming game or covered by per-game tests of the kit defaults it changes — a kit-level fix broke an unrelated game's board once already.

## Project Skill Selection

On first sync, or when you inherit a newly initialized agency-managed project, inspect the project skill catalog before assuming the available skills are sufficient. Use `agency list-skills` or read `src/agency/catalog/skills/INDEX.md` from the agency checkout, choose optional skills that match the project domain, install them project-locally with `agency add-skill <name>`, then run `agency sync --write`.

Keep optional skills project-scoped. Do not make a skill global unless the agency catalog marks it `scope: always` and `agency sync-global` is the intended path.

## Human-Facing Artifacts

Default to self-contained HTML for ad hoc human-facing artifacts: reports, explainers, diagrams, comparisons, review summaries, and custom evidence pages. Workflow-specific skills may require Markdown or another format for their own artifacts; follow the skill contract in those cases.

Use Markdown when the file is itself source material, policy, README-style repo documentation, or when the user explicitly asks for Markdown.

For artifact placement, structure, previewing, sharing, and privacy checks, load the `html-artifact` skill.

When the user asks for a public or shareable HTML artifact URL, use the `html-artifact` skill. Do not hand out localhost or `127.0.0.1` URLs as share links.

## Git And Workspace Safety

- Check `git status` before editing. If unrelated user changes exist, leave them alone.
- Never revert changes you did not make unless the user explicitly asks.
- Never run destructive git commands such as `git reset --hard`, `git checkout -- <file>`, or force-push without explicit approval.
- Commit only when the active workflow or user request calls for it.

## Secrets

- Never commit `.env`, `.env.local`, API keys, credentials, tokens, or private customer/user data.
- Warn the user if requested work would expose secrets or private data.

## Tools

- For Python projects, use `uv` as the command runner and package manager. Prefer `uv run python`, `uv run pytest`, `uv run ruff`, and other `uv run <tool>` invocations over bare `python`, `pytest`, or globally installed tools.

<!-- Language-specific tool guidance (ruff/vulture for Python, eslint/knip
     for TypeScript) is injected here by `agency sync` based on root-level
     pyproject.toml / package.json detection. Do not add language-scoped
     tools here by hand. -->

## Self-Improvement

If you notice a repeated failure or a durable improvement to this document, propose a specific edit to `agents/policy/AGENTS.md` and explain why it would help future sessions. After an approved policy edit, run `agency sync --write` to distribute it to synced targets.
