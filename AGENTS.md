# Codex Instructions

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

## Plan artifacts

- When the user asks for a plan, default to creating a polished standalone `.html` file rather than a Markdown file.
- Make the plan easy to scan and visually useful, with clear structure, thoughtful styling, and diagrams, flows, timelines, tables, or other visuals wherever they improve understanding.
- Keep the HTML self-contained and directly viewable in a browser.
- Use another format only when the user explicitly requests it or when HTML would not be usable in the requested context.
