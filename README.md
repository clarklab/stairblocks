# Stairblocks

An interactive 3D porch-stair planner built with React, TypeScript, Three.js, and Vite. Prepared for static hosting on Netlify.

## Run locally

```sh
npm install
npm run dev
```

## Validate and build

```sh
npm test
npm run build
npm run preview
```

## Netlify

Production URL: [boards.wims.vc](https://boards.wims.vc).

Netlify project `stairblocks` is connected to [clarklab/stairblocks](https://github.com/clarklab/stairblocks). Pushes to `main` automatically build and publish production; pull requests create deploy previews. The included `netlify.toml` selects Node 22, runs `npm run build`, and publishes `dist`. No server, environment variables, API keys, or database are required.

## Features

- Live orbitable 3D stairs with finished, framing, exploded, and fastener views.
- Height, total run, width, and rise-count controls; planters and a two-flight 90-degree landing option.
- Stringers, tread planks, riser boards, blocking, hardware, and optional railing estimates.
- Treated pine, cedar, and composite comparisons; actual nominal-versus-finished board sizes.
- Editable illustrative USD prices, stock-board quantities, kerf-aware cut lists, and 10% contingency.
- Local autosave, JSON project export/import, CSV shopping/cut lists, and print-to-PDF.
- Responsive mobile controls and dimension/geometry checks.

## Planning model and limitations

All dimensions are inches. Straight stairs have one fewer tread than rises because the porch is the upper landing. Turning stairs have two fewer treads plus an intermediate landing; their total run is the sum of both flight runs, excluding the landing. Switching layouts preserves the tread going when possible within the input limits.

Physical treads use two 5.5-inch boards with a 0.125-inch gap, or a single 11.25-inch wood board. The app warns if these boards cannot cover the requested going. Composite uses two 1-inch decking boards with a 0.25-inch gap over treated structural framing. The 9-inch composite support assumption is an illustrative Trex Enhance-style layout, not a universal product specification.

Prices are editable example allowances, **not live retailer quotes**. Structural connections, footing sizing, railing systems, and landing framing include preliminary allowances. The porch shown is context and is not included as new construction. Cut-stringer blanks include a rough layout allowance; final stringer templates, bearing cuts, tread-thickness adjustments and connections must be verified on site. Decorative planters do not replace support or guards.

Model-code checks reference the 2021 IRC and AWC DCA 6 and do not establish permit approval or structural adequacy. Verify locally adopted rules, manufacturer instructions, local availability, species/grade, ground conditions, and porch attachment before purchasing or building.

Reference sources:

- [ICC 2021 IRC plan review, stairs](https://www.iccsafe.org/wp-content/uploads/Session-41-and-67-2021-IRC-Plan-Review.pdf)
- [AWC DCA 6 residential wood deck construction guide](https://web-media.awc.org/wp-content/uploads/2022/02/17210514/AWC-DCA62015-DeckGuide-1804.pdf)
- [Trex installation guides](https://www.trex.com/customer-support/trex-owners/downloads/)
- [Simpson connector fastener schedules](https://www.strongtie.com/products/fastening-systems/technical-notes/sd-connector-screw-approved-connectors)

## Code map

- `src/App.tsx`: configuration, estimates, shopping list, guide, and exports
- `src/components/StairScene.tsx`: 3D geometry and interactive assembly
- `src/lib/planner.ts`: shared dimensions, takeoff, cutting stock, prices, and checks
- `src/lib/project.ts`: saved-project validation
- `src/lib/*.test.ts`: calculation and persistence validation tests
- `src/styles.css`: responsive interface and print styles

Projects are stored only in the current browser. Save a JSON file to move a project between devices. The app sends no project data to a server.
