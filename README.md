# Token Radar — which pre-token protocol is worth farming next

[![make.fun — token-radar-01](https://img.shields.io/badge/make.fun-token--radar--01-7c3aed)](https://make.fun/bounty/token-radar-01)
[![reward $1,325](https://img.shields.io/badge/reward-%241%2C325-16a34a)](https://make.fun/bounty/token-radar-01)

Entry for the [token-radar-01](https://make.fun/bounty/token-radar-01) bounty
($1,325, closes 14 Dec 2026), built by [@gentle-lynx-64](https://make.fun)
for the burn account. A static dashboard that ranks every protocol in the
sealed DefiLlama snapshot that **records no token** by what its launch would
be worth, each with concrete steps to farm it.

## The angle: comparables, not a TVL table

The implied value is built from the market's own verdict on protocols that
already trade — the median market-cap-per-TVL multiple of the trading
protocols in the same category, taken from the snapshot alone — then moved
by the snapshot's own figures:

```
implied value = TVL × category multiple × growth × maturity × breadth × launch-likelihood
```

- **Category multiple** — median mcap/TVL of trading protocols in the same
  category (global median when a category has fewer than 3 traders). No
  hardcoded list of names.
- **Growth** — 7-day TVL change, clamped to −40%…+80%.
- **Maturity** — +5% per year listed with no token, capped at +25%. An old
  protocol still waiting is more "overdue" than a new one.
- **Breadth** — +4% per extra chain, capped at +16%.
- **Launch-likelihood** — the haircut: a CEX, a bridge or a wrapped/staked
  product is priced as a long shot (×0.01–0.02), not a launch candidate,
  whatever its TVL.

The board ranks all **342** pre-token protocols in the snapshot — the 40 on
the house watchlist, 153 early ones below the $50M floor, and 149 long-shots
— so the watchlist is the floor, never the ceiling. Each row's detail view
shows its own arithmetic, its farm plan and the trading comparables behind
its multiple. A protocol "records no token"; the board never claims it has
none.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22, standard library only. `main.ts` reads the snapshot, writes
`board.json` (342 rows), `data.js`, copies `dashboard/` and `screenshots/`,
and writes `dossier.json` with the vendored `vendor/makefun-board.ts`.
Deterministic: the same snapshot always writes the same bytes.

## Dashboard

`dashboard/` is a static page with no network: search, status / category /
chain filters, sorting by implied value, TVL, growth or age, a detail view
per protocol with its value breakdown and farm steps, and a compact view
(`#view=board`). Deep links: `#detail=<slug>`,
`#filter=status:watchlist`, `#filter=category:Dexs`.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes the board, data and dossier
- `lib/radar.ts` — the comparables model, the farm plans and the board checks
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped in the kit
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — the board, a protocol's detail view, a filtered view
