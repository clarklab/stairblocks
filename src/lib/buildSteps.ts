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
  const cuts = (...prefixes: string[]) => plan.cutList
    .filter(part => prefixes.some(prefix => part.id.startsWith(prefix)))
    .reduce((total, part) => total + part.quantity, 0)
  switch (stage) {
    case 'supports': return [
      { count: cuts('portable-drops-', 'landing-drops-'), label: '2 × 4 vertical drops' },
      { count: cuts('portable-runners-', 'landing-runners-'), label: '2 × 4 bottom runners' },
      { count: cuts('portable-crossrails-'), label: '2 × 4 crossrails' },
      { count: cuts('landing-frame-'), label: 'landing frame members' },
    ].filter(part => part.count > 0)
    case 'stringers': return [{ count: g.totalStringerCount, label: '2 × 12 stringers' }]
    case 'blocking': return [
      { count: g.blockingRows * (g.stringerCount - 1), label: 'blocking pieces' },
      { count: cuts('portable-braces-'), label: 'diagonal brace blanks' },
    ].filter(part => part.count > 0)
    case 'risers': return c.closedRisers ? [{ count: c.risers, label: 'wood riser boards' }] : []
    case 'treads': return [
      { count: g.treadCount * g.boardsPerTread, label: c.compositeTreads ? 'composite tread boards' : 'wood tread planks' },
      ...(g.landingDeckBoards ? [{ count: g.landingDeckBoards, label: c.compositeTreads ? 'composite landing boards' : 'wood landing boards' }] : []),
    ]
    case 'fasteners': return [
      { count: plan.woodScrewCount, label: 'wood screws incl. spares' },
      { count: plan.compositeScrewCount, label: 'composite screws incl. spares' },
    ].filter(part => part.count > 0)
    case 'complete': return [
      ...(c.ending === 'planter' ? [{ count: 2, label: 'planter end caps' }] : []),
      { count: plan.materials.filter(part => part.id.startsWith('side-panel-lattice-')).reduce((total, part) => total + part.quantity, 0), label: '4 × 8 lattice stock panels' },
      { count: cuts('side-panel-solid-'), label: 'wood side-cladding pieces' },
      { count: cuts('side-panel-battens-'), label: 'panel edge battens' },
      { count: cuts('return-cap-long-'), label: 'sloped edge caps' },
      { count: cuts('return-cap-short-'), label: '90° trim returns' },
    ].filter(part => part.count > 0)
    default: return []
  }
}

/** Instructions describe the selected assembly; connections remain product/site specific. */
export function getBuildSteps(plan: StairPlan): BuildStep[] {
  const { config: c, geometry: g } = plan
  const woodName = c.material === 'cedar' ? 'cedar' : 'treated wood'
  const dropCount = plan.cutList.filter(part => part.id.startsWith('portable-drops-')).reduce((total, part) => total + part.quantity, 0)
  const steps: BuildStep[] = [
    {
      id: 'site', title: 'Measure & mark the site', subtitle: 'Start at the finished surfaces.',
      metric: `${inches(c.rise)} rise · ${inches(c.run)} tread run · ${inches(c.width)} width`,
      tasks: [
        `Measure ${inches(c.rise)} from the finished lower landing to the concrete porch surface. The porch is the top landing.`,
        `Mark the ${inches(c.width)} stair width and ${inches(c.run)} tread run${c.ending === 'turn' ? `, plus the ${inches(g.landingSize)} square turn landing` : ''}. Include room for the lower landing.`,
        'Check that the proposed bearing surface is firm, level, and drains freely. Confirm the whole runner footprint and local requirements before ordering lumber.',
      ],
      note: 'The existing concrete porch is the upper landing. Resting against its face is not assumed to keep the stair unit from sliding or racking.',
    },
    {
      id: 'supports', title: 'Assemble the L-shaped frames', subtitle: 'Rear drops → forward runners → crossrails.',
      metric: `${dropCount} rear drops · 2 × 4 portable frame`,
      tasks: [
        'Cut the rear drops and bottom runners to the verified cut plan. Treat field cuts before joining the pieces.',
        'Make a right-angle L frame at each marked position: one vertical rear drop and one runner extending forward. Include both outer stringers and alternating interior stringers.',
        `Join the L frames with crossrails, check the diagonals for square, and keep them supported while assembling.${c.ending === 'turn' ? ' Assemble the separate drop-and-runner frame beneath the turn landing too.' : ''}`,
      ],
      note: 'Use the verified connection detail and install its fasteners as each joint is assembled. The illustrated 2 × 4 joints and portable frame still need a load and stability check.',
    },
    {
      id: 'stringers', title: 'Fit the stringers', subtitle: c.ending === 'turn' ? 'Template each flight separately.' : 'Make one template, then repeat.',
      metric: `${g.totalStringerCount} stringers · ${inches(g.stringerSpacing)} center spacing`,
      tasks: [
        `Lay out ${inches(g.riserHeight)} finished rises and ${inches(g.going)} goings on a test stringer. Account for the ${inches(g.treadThickness)} tread thickness and the frame’s bearing height at the bottom cut.`,
        `${c.ending === 'turn' ? 'Dry-fit a separate template for each flight, including the turn landing.' : 'Dry-fit the template to the drop-and-runner frame.'} Check every finished rise, cut the remaining stringers, and treat field cuts before assembly.`,
        'Align the stringers across the frame and check their contact with the rear supports and bottom runners. Install the specified wood-frame connections as each stringer is fitted.',
      ],
      note: 'The concrete porch has no modeled stair attachment. Resolve stringer bearing and connection details before cutting extra notches or relying on the frame.',
    },
    {
      id: 'blocking', title: 'Tie the framing together', subtitle: 'Blocking keeps the stringers aligned.',
      metric: `${g.blockingRows} blocking rows · ${inches(g.blockingLength)} between stringers`,
      tasks: [
        'Measure between adjacent stringers, cut each blocking piece to fit, and treat the cut ends before assembly.',
        'Install the blocking rows, keeping the stringers parallel and the tread seats in line across the full stair width.',
        'Fit the diagonal brace pieces and their specified connections. Check that the assembled frame stays square before adding boards.',
      ],
      note: 'Blocking aligns the stringers; diagonal bracing resists racking. Their joints and the unit’s resistance to sliding need verification.',
    },
  ]
  if (c.closedRisers) steps.push({
    id: 'risers', title: 'Close the riser openings', subtitle: `Fit the ${woodName} vertical boards.`,
    metric: `${c.risers} riser boards · ${inches(c.width)} across`,
    tasks: [
      'Measure each opening and rip the riser boards to fit the selected tread profile and overlap.',
      'Fit the boards against the stringer faces. Pilot-drill where required and use suitable exterior fasteners into the supports.',
      'Allow the gaps and movement required by your board manufacturer; keep every finished rise consistent.',
    ],
    note: `${c.compositeTreads ? 'Composite is used only on the walking surfaces; these risers remain wood. ' : ''}Follow the selected tread detail if it requires a different riser installation order.`,
  })
  steps.push(
    {
      id: 'treads', title: 'Lay the tread planks', subtitle: 'Work from the bottom upward.',
      metric: `${g.treadCount} treads · ${g.boardsPerTread} ${g.boardsPerTread === 1 ? 'plank' : 'planks'} per tread`,
      tasks: [
        `Cut tread planks to ${inches(c.width)} and dry-fit them across all stringers. ${g.boardsPerTread === 2 ? `The model uses a ${inches(g.boardGap)} gap between the two boards.` : 'The model uses one actual 11¼″ wide board per tread.'}`,
        `${c.compositeTreads ? 'Use the selected composite manufacturer’s stair-specific support spacing, end gaps, and approved composite screws. Keep the wood risers and frame in place.' : 'Fasten each board at every stringer using exterior screws, with edge distances and pilot holes appropriate to the lumber.'}`,
        `Check tread level, consistent nosing, and finished rise as each tread goes in.${c.ending === 'turn' ? ' Deck the turn landing using its own joist supports.' : ''}`,
      ],
      note: 'The animation separates boards to explain the assembly. Secure each board as you install it.',
    },
    {
      id: 'fasteners', title: 'Inspect every connection', subtitle: 'A close look at the fixing points.',
      metric: `${plan.screwCount} estimated board screws, including spare allowance`,
      tasks: [
        'Check tread and riser fixing points. The dots illustrate locations; use the exact schedule for your board product.',
        'Check every stringer joint, rear drop, runner, crossrail, and brace against the verified frame connection detail.',
        'Use connector-rated nails or screws for metal hardware. General deck screws do not replace structural connector fasteners.',
      ],
      note: 'This is an inspection stage. Structural hardware must already be installed as each framing stage is assembled.',
    },
    {
      id: 'complete', title: 'Finish & review the whole stair', subtitle: 'Walk through the checks before use.',
      metric: `${c.ending === 'turn' ? '90° turn' : c.ending === 'planter' ? 'Planter end caps' : 'Straight run'} · ${c.railing ? 'rails selected' : 'no rails selected'}`,
      tasks: [
        c.ending === 'planter' ? 'Fit the separate planter end caps and liners. Keep drainage clear and soil weight off the stair frame.' : 'Touch up exposed lumber and apply the selected finish as directed by its manufacturer. Concealed field cuts should already have been treated.',
        ...(c.sidePanel !== 'open' ? [`Fit the decorative ${c.sidePanel === 'lattice' ? 'lattice' : 'solid wood'} side panels. Leave drainage and inspection access; these panels do not replace structural bracing.`] : []),
        ...(c.returnCaps ? ['Fit the 90° side/end trim returns toward the concrete porch. These caps are decorative; they add no walking surface, support, or porch connection.'] : []),
        c.railing ? 'Install the required handrails and guards with their designed post connections.' : 'Review the handrail and guard checks. The no-rail selection is a design preference, not a code approval.',
        'Measure finished rises and goings. Verify support contact, sliding and racking resistance, landings, and drainage; complete any required inspection before use.',
      ],
      note: 'Use the planning checks and material list alongside these animation segments. They are an assembly overview, not a permit-ready construction plan.',
    },
  )
  return steps
}
