# Codex Instructions

## Dev servers & previews

- Always bind dev/preview servers to `0.0.0.0` so they are reachable from other devices on the local network — Vikas frequently views work from a different machine than the one running the server.
- Whenever you start a server, hand back the LAN URL, not just localhost. Prefer the mDNS hostname: `http://$(scutil --get LocalHostName).local:<port>` — on the Mac mini that is `http://reddy2macmini.local:<port>`. Include the IP fallback from `ipconfig getifaddr en0` (currently `192.168.7.33` on the Mac mini; DHCP can change it).
- `.claude/launch.json` configs follow this rule (`--bind 0.0.0.0` / `--host 0.0.0.0`); keep new launch configs consistent.

## Git workflow

- Work directly on the `main` branch by default.
- Do not create or switch to another branch or worktree unless the user explicitly asks for one.
- If the current checkout is not on `main`, return to `main` before making changes unless doing so could overwrite or disrupt existing work; in that case, stop and explain the conflict.
- After completing requested work, commit and push the scoped changes to `main` by default, even when the user does not separately ask for a commit or push.
- Skip the automatic commit or push only when there is a clear reason to believe it would cause a serious problem, such as publishing secrets, losing or mixing unrelated work, pushing broken critical functionality, or overwriting remote changes. In that case, preserve the work and explain the blocker.

## Plan artifacts

- When the user asks for a plan, default to creating a polished standalone `.html` file rather than a Markdown file.
- Make the plan easy to scan and visually useful, with clear structure, thoughtful styling, and diagrams, flows, timelines, tables, or other visuals wherever they improve understanding.
- Keep the HTML self-contained and directly viewable in a browser.
- Use another format only when the user explicitly requests it or when HTML would not be usable in the requested context.
