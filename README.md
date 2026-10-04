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
- Coupled height, total run, and rise-count controls: run edits keep porch height fixed and choose the nearest covered tread layout; independent width control; planter end caps and a two-flight 90-degree landing option.
- Open sides, decorative lattice, or wood side panels, with access and drainage kept in the finishing plan.
- Optional 90-degree side/end trim returns toward the porch, separate from the turning-stair layout.
- A portable wood stair frame beside an existing concrete porch: rear 2 × 4 drops, forward bottom runners, crossrails, and bracing.
- Stringers, tread planks, riser boards, blocking, hardware, and optional railing estimates.
- Configuration-specific animated building segments with part counts, pause/resume/replay, optional auto-advance, and reduced-motion support.
- Treated pine or cedar for wood walking boards, risers, and decorative finishes, with a pressure-treated structural frame and optional colored composite walking boards; actual nominal-versus-finished board sizes.
- Editable illustrative USD prices, stock-board quantities, kerf-aware cut lists, and 10% contingency.
- Local autosave, JSON project export/import, CSV shopping/cut lists, and print-to-PDF.
- Responsive mobile controls and dimension/geometry checks.

## Planning model and limitations

The starter layout is 96 inches wide, 36 inches from finished ground to porch surface, with no handrails selected. Width is adjustable from 30 to 192 inches (16 feet); stock quantities and support positions change as the stairs widen. Existing saved dimensions are preserved. All dimensions are inches. Straight stairs have one fewer tread than rises because the porch is the upper landing. Turning stairs have two fewer treads plus an intermediate landing; their total run is the sum of both flight runs, excluding the landing. Changing height recalculates a suitable rise count and run. Changing run preserves the measured porch height, chooses a feasible rise count, and snaps to the nearest run the selected tread boards can cover. The actual result and any adjustment are shown explicitly; not every requested height/run combination is available. Manual rise counts, tread changes, and layout changes use the same dimension solver. Switching layouts preserves the tread going when possible within the input limits. Imported dimensions remain unchanged until a layout control is edited or a layout is suggested.

Wood treads use two 5.5-inch boards with a 0.125-inch gap, or a single 11.25-inch board. The app warns if these boards cannot cover the requested going. Optional composite walking boards use two 5.5-inch-wide, 1-inch-thick decking boards with a 0.25-inch gap; risers retain the selected wood and structural framing stays pressure-treated wood. Composite color changes appearance without replacing those wood parts. The 9-inch composite support assumption is an illustrative Trex Enhance-style layout, not a universal product specification. Wood stringers are spaced at no more than 16 inches in this model; tread species, grade, thickness, and actual product requirements still govern.

Prices are editable example allowances, **not live retailer quotes**. Frame connections, bracing, railing systems, and turning-landing details remain preliminary. The existing concrete porch is context and is not included as new construction. Cut-stringer blanks include a rough layout allowance; final stringer templates, tread-thickness adjustments, support contact, and connections must be verified on site. Decorative planter end caps do not replace support or guards. Lattice and solid side panels are decorative cladding; they must preserve drainage and inspection access and are not counted as structural bracing. Optional 90-degree trim returns are side/end caps toward the porch, not a new walking surface or structural connection.

Model-code checks reference the 2021 IRC and AWC DCA 6 and do not establish permit approval or structural adequacy. Verify locally adopted rules, manufacturer instructions, local availability, species/grade, the bearing surface, and the portable frame design before purchasing or building.

The portable-frame concept places rear 2 × 4 drops at both outer stringers and alternating interior stringers. Bottom 2 × 4 runners extend forward at right angles to the drops; crossrails and diagonal bracing tie the assembly together. The model specifies no concrete footings, anchored bases, or porch attachment. Abutting the existing porch is not assumed to prevent sliding or racking: the 2 × 4 joints, bearing, stability, and any turning-landing frame require a verified detail before use. “Portable” describes the frame arrangement, not a claim that the finished unit is safe to lift alone or structurally certified.

The animated walkthrough starts with the L-shaped drop-and-runner frames, then fits stringers, blocking, risers, and walking boards. It adapts to the selected configuration and skips closed-riser work when those boards are off. Treat concealed field cuts before assembly and install specified fasteners during each stage; the fastener segment is a final inspection. Dimensions and counts are a planning aid, not fabrication-ready instructions.

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
- `src/lib/layout.ts`: coupled dimension solver and feasible control limits
- `src/lib/project.ts`: saved-project validation
- `src/lib/*.test.ts`: calculation and persistence validation tests
- `src/styles.css`: responsive interface and print styles

Projects are stored only in the current browser. Save a JSON file to move a project between devices. The app sends no project data to a server.
