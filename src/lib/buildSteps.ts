import type { StairPlan } from './planner'

export type BuildStage = 'site' | 'supports' | 'stringers' | 'blocking' | 'risers' | 'treads' | 'fasteners' | 'complete'
export interface BuildStep {
  id: BuildStage
  title: string
  subtitle: string
  metric: string
  tasks: string[]
  note: string
}
const inches = (value: number) => value === 0.125 ? '⅛″' : value === 0.25 ? '¼″' : `${Number(value.toFixed(2))}″`

export function getBuildParts(plan: StairPlan, stage: BuildStage): { count: number; label: string }[] {
  const { config: c, geometry: g } = plan
  const rows = g.supportFlights.flatMap(flight => flight.rows)
  const posts = rows.reduce((total, row) => total + row.postPositions.length, 0)
  switch (stage) {
    case 'supports': return [
      { count: rows.length * 2, label: '2 × 8 beam plies' },
      { count: posts, label: 'stair support posts' },
      { count: rows.length * 4, label: 'brace blanks' },
      ...(c.ending === 'turn' ? [{ count: 1, label: 'landing frame kit' }] : []),
    ].filter(part => part.count > 0)
    case 'stringers': return [{ count: g.totalStringerCount, label: '2 × 12 stringers' }]
    case 'blocking': return [{ count: g.blockingRows * (g.stringerCount - 1), label: 'blocking pieces' }]
    case 'risers': return c.closedRisers ? [{ count: c.risers, label: 'riser boards' }] : []
    case 'treads': return [
      { count: g.treadCount * g.boardsPerTread, label: 'tread planks' },
      ...(g.landingDeckBoards ? [{ count: g.landingDeckBoards, label: 'landing boards' }] : []),
    ]
    case 'fasteners': return [{ count: plan.screwCount, label: 'board screws incl. spares' }]
    case 'complete': return c.ending === 'planter' ? [{ count: 2, label: 'planter boxes' }] : []
    default: return []
  }
}

/** Instructions describe the selected assembly; connections remain product/site specific. */
export function getBuildSteps(plan: StairPlan): BuildStep[] {
  const { config: c, geometry: g } = plan
  const steps: BuildStep[] = [
    {
      id: 'site', title: 'Measure & mark the site', subtitle: 'Start at the finished surfaces.',
      metric: `${inches(c.rise)} rise · ${inches(c.run)} tread run · ${inches(c.width)} width`,
      tasks: [
        `Measure ${inches(c.rise)} from the finished lower landing to the concrete porch surface. The porch is the top landing.`,
        `Mark the ${inches(c.width)} stair width and ${inches(c.run)} tread run${c.ending === 'turn' ? `, plus the ${inches(g.landingSize)} square turn landing` : ''}. Include room for the lower landing.`,
        'Check the support layout, soil, drainage, buried services, and local requirements before excavation or ordering lumber.',
      ],
      note: 'The concrete porch is existing context. This plan assumes the stairs carry their weight on their own foundations.',
    },
    {
      id: 'supports', title: 'Set the independent supports', subtitle: 'Footings → posts → beams.',
      metric: 'A separate frame beneath the stair run',
      tasks: [
        'Build the approved footings and lower bearing pad. Let concrete reach the required strength before loading it.',
        'Treat field cuts before assembly. Set rated bases, posts, beam seats, and beams at the planned elevations, clear of standing water and soil.',
        `Brace the frame against movement in both directions and install each connection’s specified fasteners now.${c.ending === 'turn' ? ' Build and brace the independent turn-landing frame too.' : ''}`,
      ],
      note: 'Beam sizes, footings, bearing seats, and lateral restraint need a site-specific design. The illustrated frame is a budgeting layout.',
    },
    {
      id: 'stringers', title: 'Fit the stringers', subtitle: c.ending === 'turn' ? 'Template each flight separately.' : 'Make one template, then repeat.',
      metric: `${g.totalStringerCount} stringers · ${inches(g.stringerSpacing)} center spacing`,
      tasks: [
        `Lay out ${inches(g.riserHeight)} finished rises and ${inches(g.going)} goings on a test stringer. Account for the ${inches(g.treadThickness)} tread thickness at the bottom cut.`,
        `${c.ending === 'turn' ? 'Dry-fit a separate template for each flight, including the turn landing.' : 'Dry-fit the template to the support frame and lower landing.'} Check every finished rise, cut the remaining stringers, and treat field cuts before assembly.`,
        'Set every stringer on its designed bearing seat and secure it against slipping, uplift, and sideways movement using approved hardware.',
      ],
      note: 'Do not improvise an underside notch or screw the stringers into the concrete edge. The bearing and restraint detail must be resolved first.',
    },
    {
      id: 'blocking', title: 'Tie the framing together', subtitle: 'Blocking keeps the stringers aligned.',
      metric: `${g.blockingRows} blocking rows · ${inches(g.blockingLength)} between stringers`,
      tasks: [
        'Measure between adjacent stringers, cut each blocking piece to fit, and treat the cut ends before assembly.',
        'Install the blocking rows, keeping the stringers parallel and the tread seats in line across the full stair width.',
        'Install the designed blocking connections and check the independent frame’s diagonal bracing before adding boards.',
      ],
      note: 'Blocking between stringers and diagonal frame bracing do different jobs. Both are part of this assembly.',
    },
  ]
  if (c.closedRisers) steps.push({
    id: 'risers', title: 'Close the riser openings', subtitle: 'Fit the vertical boards.',
    metric: `${c.risers} riser boards · ${inches(c.width)} across`,
    tasks: [
      'Measure each opening and rip the riser boards to fit the selected tread profile and overlap.',
      'Fit the boards against the stringer faces. Pilot-drill where required and use suitable exterior fasteners into the supports.',
      'Allow the gaps and movement required by your board manufacturer; keep every finished rise consistent.',
    ],
    note: 'Some decking systems specify a different tread/riser installation order. Follow that product’s instructions.',
  })
  steps.push(
    {
      id: 'treads', title: 'Lay the tread planks', subtitle: 'Work from the bottom upward.',
      metric: `${g.treadCount} treads · ${g.boardsPerTread} ${g.boardsPerTread === 1 ? 'plank' : 'planks'} per tread`,
      tasks: [
        `Cut tread planks to ${inches(c.width)} and dry-fit them across all stringers. ${g.boardsPerTread === 2 ? `The model uses a ${inches(g.boardGap)} gap between the two boards.` : 'The model uses one actual 11¼″ wide board per tread.'}`,
        `${c.material === 'composite' ? 'Use the selected composite manufacturer’s stair-specific support spacing, end gaps, and approved screws.' : 'Fasten each board at every stringer using exterior screws, with edge distances and pilot holes appropriate to the lumber.'}`,
        `Check tread level, consistent nosing, and finished rise as each tread goes in.${c.ending === 'turn' ? ' Deck the turn landing using its own joist supports.' : ''}`,
      ],
      note: 'The animation separates boards to explain the assembly. Secure each board as you install it.',
    },
    {
      id: 'fasteners', title: 'Inspect every connection', subtitle: 'A close look at the fixing points.',
      metric: `${plan.screwCount} estimated board screws, including spare allowance`,
      tasks: [
        'Check tread and riser fixing points. The dots illustrate locations; use the exact schedule for your board product.',
        'Check every stringer restraint, beam/post connection, base anchor, and brace against its approved installation detail.',
        'Use connector-rated nails or screws for metal hardware. General deck screws do not replace structural connector fasteners.',
      ],
      note: 'This is an inspection stage. Structural hardware must already be installed as each framing stage is assembled.',
    },
    {
      id: 'complete', title: 'Finish & review the whole stair', subtitle: 'Walk through the checks before use.',
      metric: `${c.ending === 'turn' ? '90° turn' : c.ending === 'planter' ? 'Planter ends' : 'Straight run'} · ${c.railing ? 'rails selected' : 'no rails selected'}`,
      tasks: [
        c.ending === 'planter' ? 'Add the separate planter boxes and liners without trapping water against the stair framing.' : 'Touch up exposed lumber and apply the selected finish as directed by its manufacturer. Concealed field cuts should already have been treated.',
        c.railing ? 'Install the required handrails and guards with their designed post connections.' : 'Review the handrail and guard checks. The no-rail selection is a design preference, not a code approval.',
        'Measure all finished rises and goings, check landings and drainage, and complete any required inspection before using the stairs.',
      ],
      note: 'Use the planning checks and material list alongside these animation segments. They are an assembly overview, not a permit-ready construction plan.',
    },
  )
  return steps
}
