# InsightHub (app-09-ai-saas)

InsightHub compares npm packages by their real daily downloads. You pick one to four packages and a window (past month, three months or year). The page draws the downloads, marks the unusual days and matches each one to the releases just before it. A model then writes a short explanation for each package, and every figure in that text is checked against the npm numbers.

Live: https://jdgafx-app-09-ai-saas.netlify.app

**What this showcases:** an AI explanation whose numbers are never trusted. The model sets claim fields only. Code computes the totals, growth, peaks and package comparisons, formats every figure, and re-checks each claim against the raw rows (checked, wrong or unchecked).

## Try it

The page opens on the Try it comparison: react, vite, zod and @anthropic-ai/sdk over the past year, drawn live from npm with no model call. Press Try it to run the explanation. If a fresh stored real run of that comparison exists, it is played back on load through the page's own code (labelled as a replay), and the downloads still come from npm. The figure check below the explanation lists each figure with the model's value, the npm value and how to check it by hand. You can also type your own package names, or open Ready-made comparisons.

## How it works

- The browser fetches downloads from the npm API and release dates through `GET /api/releases` (`netlify/functions/releases.ts`, a fixed npm registry host).
- Code computes the window, aggregates, growth and unusual days (`shared/`).
- `POST /api/explain` (`netlify/functions/explain.ts`) makes one model call per package through OpenRouter, with the alias `~anthropic/claude-haiku-latest` and a 26 second limit. The page shows the model that answered. The reply is parsed and tidied in `netlify/shared/boundary.ts`: a claim about another package, a repeated figure, or a claim with no words beside it is dropped, and so is the whole sentence that a dropped claim would leave half written.
- The browser fills each growth value and comparison from the facts, then judges every claim against the raw rows (`shared/claims.ts`, `shared/recompute.ts`).
- Requests are checked for origin, method, a rate limit of 20 a minute per client on each warm instance, and body size before any model call.

## Run locally

```bash
npm ci
npm run dev          # the page only (Vite)
npx netlify dev      # the page and the functions together; needs the variable below
npm test
npm run lint
npm run typecheck
npm run build
npm run preview
```

Environment variable, by name only: `OPENROUTER_API_KEY` (server side only; the browser never receives it). Tests do not reach the network.

## Known limits

- The stored Try it replay is a recording made earlier, so it shows the explanation as it was when recorded until a new recording is made.
- The explanation is a model's text. Figures are checked; the prose around them is not.
