# Stairblocks

An interactive 3D porch-stair planner built with React, TypeScript, Three.js, and Vite. Hosted on Netlify. Like LEGO with power tools.

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

- CPU-projected SVG 3D stairs with finished, framing, exploded, and fastener views. Three.js provides camera and vector math; no WebGL context or GPU renderer is needed.
- Mouse/touch orbit, pinch/scroll zoom, and side/top camera views for desktop and mobile browsers.
- Height, total run, width, and rise-count controls; planters and a two-flight 90-degree landing option.
- Independent under-stair beams, posts, bases, footing and bracing allowances beside an existing concrete porch.
- Stringers, tread planks, riser boards, blocking, hardware, and optional railing estimates.
- Configuration-specific animated building segments with part counts, pause/resume/replay, optional auto-advance, and reduced-motion support.
- Treated pine, cedar, and composite comparisons; actual nominal-versus-finished board sizes.
- Editable illustrative USD prices, stock-board quantities, kerf-aware cut lists, and 10% contingency.
- Local autosave, JSON project export/import, CSV shopping/cut lists, and print-to-PDF.
- Responsive mobile controls and dimension/geometry checks.

## Planning model and limitations

The starter layout is 96 inches wide, 36 inches from finished ground to porch surface, with no handrails selected. Width is adjustable from 30 to 192 inches (16 feet); longer stock boards and additional supports are included as the stairs widen. Existing saved dimensions are preserved. All dimensions are inches. Straight stairs have one fewer tread than rises because the porch is the upper landing. Turning stairs have two fewer treads plus an intermediate landing; their total run is the sum of both flight runs, excluding the landing. Switching layouts preserves the tread going when possible within the input limits.

Physical treads use two 5.5-inch boards with a 0.125-inch gap, or a single 11.25-inch wood board. The app warns if these boards cannot cover the requested going. Composite uses two 1-inch decking boards with a 0.25-inch gap over treated structural framing. The 9-inch composite support assumption is an illustrative Trex Enhance-style layout, not a universal product specification.

Prices are editable example allowances, **not live retailer quotes**. Structural connections, footing sizing, railing systems, and landing framing include preliminary allowances. The porch shown is context and is not included as new construction. Cut-stringer blanks include a rough layout allowance; final stringer templates, bearing cuts, tread-thickness adjustments and connections must be verified on site. Decorative planters do not replace support or guards.

Model-code checks reference the 2021 IRC and AWC DCA 6 and do not establish permit approval or structural adequacy. Verify locally adopted rules, manufacturer instructions, local availability, species/grade, ground conditions, and the independent support design before purchasing or building.

Independent support beams and posts illustrate a gravity-load concept; they are not a validated freestanding structural system. The shared doubled 2 × 8 beams, bearing seats, top overhang, foundations, and bracing in both directions need a site-specific design. Low flights that lack space for the illustrated supports remain unresolved allowances. The existing concrete porch carries no modeled stair load, and no concrete anchors are specified.

The animated walkthrough adapts to the selected configuration and skips closed-riser work when those boards are off. Install structural fasteners during each stage; the fastener segment is a final inspection. Dimensions and counts are a planning aid, not fabrication-ready instructions.

Reference sources:

- [ICC 2021 IRC plan review, stairs](https://www.iccsafe.org/wp-content/uploads/Session-41-and-67-2021-IRC-Plan-Review.pdf)
- [AWC DCA 6 residential wood deck construction guide](https://web-media.awc.org/wp-content/uploads/2022/02/17210514/AWC-DCA62015-DeckGuide-1804.pdf)
- [Trex installation guides](https://www.trex.com/customer-support/trex-owners/downloads/)
- [Simpson connector fastener schedules](https://www.strongtie.com/products/fastening-systems/technical-notes/sd-connector-screw-approved-connectors)

## Code map

- `src/App.tsx`: configuration, estimates, shopping list, guide, and exports
- `src/components/StairScene.tsx`: viewer entry point
- `src/components/CpuStairScene.tsx`: SVG projection, touch/orbit controls, and animation
- `src/lib/sceneGeometry.ts`: renderer-independent 3D parts
- `src/components/BuildWalkthrough.tsx`: segment controls and assembly instructions
- `src/lib/buildSteps.ts`: configuration-specific instructions and parts
- `src/lib/planner.ts`: shared dimensions, takeoff, cutting stock, prices, and checks
- `src/lib/project.ts`: saved-project validation
- `src/lib/*.test.ts`: calculation and persistence validation tests
- `src/styles.css`: responsive interface and print styles

Projects are stored only in the current browser. Save a JSON file to move a project between devices. The app sends no project data to a server.
