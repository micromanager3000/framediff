# Codex Instructions

## Dev servers & previews

- Always bind dev/preview servers to `0.0.0.0` so they are reachable from other devices on the local network — Vikas frequently views work from a different machine than the one running the server.
- Whenever you start a server, hand back the LAN URL, not just localhost. Prefer the mDNS hostname: `http://$(scutil --get LocalHostName).local:<port>` — on the Mac mini that is `http://reddy2macmini.local:<port>`. Include the IP fallback from `ipconfig getifaddr en0` — on the Mac mini this is `192.168.7.33`, reserved in eero for the Ethernet MAC (Wi-Fi is deliberately off so the mini has a single network identity).
- `.claude/launch.json` configs follow this rule (`--bind 0.0.0.0` / `--host 0.0.0.0`); keep new launch configs consistent.

## Git workflow

- Work directly on the `main` branch by default.
- Do not create or switch to another branch or worktree unless the user explicitly asks for one.
- If the current checkout is not on `main`, return to `main` before making changes unless doing so could overwrite or disrupt existing work; in that case, stop and explain the conflict.
- After completing requested work, commit and push the scoped changes to `main` by default, even when the user does not separately ask for a commit or push.
- Skip the automatic commit or push only when there is a clear reason to believe it would cause a serious problem, such as publishing secrets, losing or mixing unrelated work, pushing broken critical functionality, or overwriting remote changes. In that case, preserve the work and explain the blocker.

## UI conventions

- **Never use a colored accent rule along the left edge of a block** — no
  `border-left: 2px solid var(--accent)` on rows, cards, list items, callouts, or
  quoted text, and no `box-shadow: inset 2px 0 0` / `inset 3px 0 0` standing in for
  one. The user has rejected this pattern outright; it reads as a stray bracket
  floating beside the content, and on anything with a `border-radius` it curves into
  an obvious artifact. This applies to the studio CSS, prototypes, docs, and any
  generated HTML.
- Indicate **selected / active / current** state with a background tint, or by
  lighting up something the row already owns (its index badge, its icon, its label)
  — not with an edge rule.
- Indicate **kind or severity** (VO vs dialog, warning vs error) with the chip,
  badge, or icon that already labels it, plus type styling such as italics. Do not
  add a colored rule as a second, redundant signal.
- Plain neutral hairlines are still fine where they genuinely divide — separators
  between adjacent inline items, rules between table rows, panel borders. The rule
  above is about colored accent bars used as decoration or state on one edge of a
  block.
- Run `npm run check:ui` after changing Studio, example, prototype, or documentation
  styles. The check rejects the known 2–3px left/inset accent-bar patterns.

## Implementation quality

- Treat every browser/runtime/project adapter call as a failure boundary. User-facing
  async operations must catch rejected promises, restore `loading` / `busy` /
  `editing` flags, and expose an actionable error instead of leaving controls inert.
- Protect refreshes and polling from stale responses. When requests can overlap or
  the selected composition can change, use a generation token and ignore superseded
  results.
- Add a regression test for every bug fix. For async state bugs, include a rejecting
  adapter test and assert that transient flags return to `false`.
- Preserve package direction: examples consume reusable code from `packages/`;
  reusable behavior must not be duplicated across examples or moved into app-specific
  code.
- Keep UI components focused on rendering and interaction. Put project operations,
  persistence, race handling, and error normalization in Studio model managers or
  runtime adapters.
- Keep optional heavyweight browser capabilities behind dynamic imports close to the
  operation that needs them. In particular, animation source parsing, video
  export/capture, and Three.js scene setup must not become eager Studio dependencies.
- Do not import the same module both statically and dynamically in a browser entry
  graph. Put shared lightweight types or registries in a separate module so the
  expensive implementation remains a real lazy boundary.

## Validation

- For model/runtime changes, run the focused test first, then `npm run check`.
- For Studio interaction changes, also run the relevant Playwright spec. Run the
  complete E2E suite before pushing when the change affects shared navigation,
  preview, timeline, Inspector, generation, or rendering behavior.
- Review `git diff --check` and the final scoped diff before committing. Do not
  weaken tests, type checks, accessibility diagnostics, or validation scripts to
  make a change pass.
- After changing browser imports, package exports, or Vite chunking, run a production
  build followed by `npm run check:bundles`. Keep every emitted JavaScript chunk
  within 800 kB and every eagerly loaded route chunk within 500 kB.

## Plan artifacts

- When the user asks for a plan, default to creating a polished standalone `.html` file rather than a Markdown file.
- Make the plan easy to scan and visually useful, with clear structure, thoughtful styling, and diagrams, flows, timelines, tables, or other visuals wherever they improve understanding.
- Keep the HTML self-contained and directly viewable in a browser.
- Use another format only when the user explicitly requests it or when HTML would not be usable in the requested context.
