# Cutpilot - Claude Code Project Notes

## Architecture

CEP extension for Adobe Premiere Pro:
- `client/` - HTML/CSS/JS panel (vanilla, no build step)
- `host/` - ExtendScript JSX (ES3, runs in Premiere's scripting engine)
- `CSXS/manifest.xml` - Extension manifest (ID: com.cutpilot.app)
- `scripts/` - Install scripts (macOS / Windows)
- `assets/` - Static assets (banner.svg)

## Critical ES3 Rules (host/index.jsx)

ExtendScript runs ES3 (1999). Violations silently break the entire file:
- **ASCII only** — no Unicode, no Turkish characters, even in comments
- **`var` only** — no let, const, arrow functions, template literals
- **No block-scoped function declarations** — `function foo() {}` inside `if`/`try`/`for` rejects the whole file
- No default parameters, no destructuring, no spread operator

After every `host/index.jsx` change run these three checks (all must pass):
```bash
LC_ALL=C grep -c '[^[:print:][:space:]]' host/index.jsx   # Must output 0
grep -c '\](http' host/index.jsx                           # Must output 0
awk '/^[[:space:]]+function [a-zA-Z]/' host/index.jsx      # Must output nothing
```

## Key Architecture Decisions

- **Whisper word-level timestamps**: `timestamp_granularities[]=word` + `timestamp_granularities[]=segment` in multipart form
- **Re-import strategy**: Never mutate original projectItem. Always `importFiles([path])` then `findMostRecentImport()` to get a fresh independent item
- **Word enrichment**: Each word carries `srcStart/srcEnd` (raw media positions) + `seqStart/seqEnd` (sequence positions) + `mediaPath`
- **Frame rounding**: Read `lastClip.end.ticks` after each `overwriteClip` instead of computing from duration
- **TICKS_PER_SEC**: 254016000000
- **setInPoint/setOutPoint mode 4**: Sets both audio and video
- **Multi-media interval grouping**: Words grouped by `mediaPath`; gap > 1s in src triggers new interval
- **Defensive AI filtering**: Request `viralCount + 5` candidates, filter by duration in JS
- **TalkyClip_ sequence naming**: Kept in host/index.jsx for sequence identification (do not rename without migration plan)

## State

`client/app.js` keeps all runtime state in a single `state` object:
- `state.segments` — Whisper segments `{ start, end, text, translated? }`
- `state.words` — Word-level enriched data `{ word, srcStart, srcEnd, seqStart, seqEnd, mediaPath }`
- `state.viralCandidates` — AI Shorts results
- `state.lastJumpCut` — Reference for subtitle resync `{ sequenceName, speechIntervals }`
- `state.settings` — User config, persisted to localStorage as `cutpilot_settings`

localStorage keys: `cutpilot_api_key`, `cutpilot_settings`, `cutpilot_lang`

## Test workflow

1. Edit files in `~/Desktop/talky/`
2. Syntax check: `node --check client/app.js`
3. Copy: `cp -R ~/Desktop/talky/{client,host,CSXS} ~/Library/Application\ Support/Adobe/CEP/extensions/com.cutpilot.app/`
4. Restart Premiere Pro fully (Cmd+Q, then reopen)
5. Open panel: Window > Extensions > Cutpilot
6. Debug console: Chrome at `http://localhost:7777`

Or run the install script for a full reinstall: `./scripts/install.sh`
