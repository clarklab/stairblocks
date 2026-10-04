/** Inches and USD throughout. This is a budgeting/layout model, not a structural design. */
export type Material = 'treated' | 'cedar' | 'composite'
export type Tread = 'two6' | 'one12'
export type Ending = 'open' | 'planter' | 'turn'
export type PriceOverrides = Record<string, number>

export interface StairConfig {
  rise: number
  run: number
  width: number
  risers: number
  material: Material
  tread: Tread
  ending: Ending
  railing: boolean
  closedRisers: boolean
}

export const DEFAULT_CONFIG: StairConfig = {
  rise: 35, run: 44, width: 96, risers: 5,
  material: 'treated', tread: 'two6', ending: 'open',
  railing: false, closedRisers: true,
}

export const CODE_SOURCES = [
  { title: 'ICC · 2021 IRC stair requirements', url: 'https://www.iccsafe.org/wp-content/uploads/Session-41-and-67-2021-IRC-Plan-Review.pdf' },
  { title: 'American Wood Council · DCA 6 deck guide', url: 'https://web-media.awc.org/wp-content/uploads/2022/02/17210514/AWC-DCA62015-DeckGuide-1804.pdf' },
]

export interface MaterialItem {
  id: string
  name: string
  detail: string
  quantity: number
  unit: string
  unitPrice: number
  total: number
  category: 'lumber' | 'hardware' | 'options'
}

export interface CutItem {
  id: string
  name: string
  quantity: number
  /** Finished piece length in inches; final field measurement still required. */
  length: number
  /** Purchased stock length in inches. Zero means an unresolved custom member. */
  stockLength: number
  detail: string
}

export interface PlanCheck {
  id: string
  status: 'pass' | 'warn' | 'info'
  title: string
  detail: string
}

export interface StairPlan {
  config: StairConfig
  geometry: {
    riserHeight: number
    going: number
    treadDepth: number
    treadThickness: number
    boardsPerTread: number
    boardWidth: number
    boardGap: number
    treadCount: number
    stringerCount: number
    totalStringerCount: number
    stringerSpacing: number
    stringerLength: number
    /** Centers measured from the left edge of the tread. */
    stringerPositions: number[]
    blockingRows: number
    blockingLength: number
    landingSize: number
    landingBoardGap: number
    landingDeckBoards: number
    lowerRisers: number
    upperRisers: number
    lowerRun: number
    upperRun: number
    lowerStringerLength: number
    upperStringerLength: number
    lowerBlockingRows: number
    upperBlockingRows: number
    noseProjection: number
  }
  materials: MaterialItem[]
  cutList: CutItem[]
  checks: PlanCheck[]
  subtotal: number
  contingency: number
  total: number
  screwCount: number
  assumptions: string[]
}

export const STOCK_LENGTHS = [96, 120, 144, 192] as const
export const SAW_KERF = 0.125
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const inchLabel = (value: number) => `${Number(value.toFixed(2))}″`
const materialNames: Record<Material, string> = { treated: 'Pressure-treated', cedar: 'Cedar', composite: 'Composite' }

/** A true crosscut count: two 48-inch cuts do not fit an exact 8-foot board. */
export function cutsPerBoard(stockLength: number, cutLength: number, kerf = SAW_KERF): number {
  if (!Number.isFinite(stockLength) || !Number.isFinite(cutLength) || cutLength <= 0 || stockLength <= 0 || kerf < 0) return 0
  return Math.max(0, Math.floor((stockLength + kerf + 1e-8) / (cutLength + kerf)))
}

type StockAllocation = { stockLength: number; boards: number; cuts: number }

/** Minimize estimated stock cost, then total purchased length. Never splice pieces. */
export function allocateStock(cutLength: number, quantity: number, pricePerFoot: number): StockAllocation[] {
  if (quantity <= 0 || !Number.isFinite(quantity)) return []
  const count = Math.ceil(quantity)
  const options = STOCK_LENGTHS.map((length) => ({ length, capacity: cutsPerBoard(length, cutLength), cost: length / 12 * pricePerFoot }))
    .filter((option) => option.capacity > 0)
  if (!options.length) return []
  const best: ({ cost: number; inches: number; option: number; previous: number } | undefined)[] = new Array(count + 1)
  best[0] = { cost: 0, inches: 0, option: -1, previous: -1 }
  for (let needed = 1; needed <= count; needed++) {
    options.forEach((option, index) => {
      const previous = Math.max(0, needed - option.capacity)
      const before = best[previous]!
      const candidate = { cost: before.cost + option.cost, inches: before.inches + option.length, option: index, previous }
      const current = best[needed]
      if (!current || candidate.cost < current.cost - 0.00001 || (Math.abs(candidate.cost - current.cost) < 0.00001 && candidate.inches < current.inches)) best[needed] = candidate
    })
  }
  const allocations = new Map<number, StockAllocation>()
  let remaining = count
  while (remaining > 0) {
    const selection = best[remaining]!
    const option = options[selection.option]
    const item = allocations.get(option.length) ?? { stockLength: option.length, boards: 0, cuts: 0 }
    item.boards++
    item.cuts += remaining - selection.previous
    allocations.set(option.length, item)
    remaining = selection.previous
  }
  return [...allocations.values()].sort((a, b) => a.stockLength - b.stockLength)
}

function normalizeConfig(input: StairConfig): StairConfig {
  const positive = (value: number, fallback: number, max: number) => Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback
  return {
    rise: positive(input.rise, DEFAULT_CONFIG.rise, 240),
    run: positive(input.run, DEFAULT_CONFIG.run, 360),
    width: Math.max(12, positive(input.width, DEFAULT_CONFIG.width, 144)),
    risers: Math.max(input.ending === 'turn' ? 4 : 2, Math.min(36, Math.round(positive(input.risers, DEFAULT_CONFIG.risers, 36)))),
    material: ['treated', 'cedar', 'composite'].includes(input.material) ? input.material : 'treated',
    tread: input.tread === 'one12' ? 'one12' : 'two6',
    ending: ['open', 'planter', 'turn'].includes(input.ending) ? input.ending : 'open',
    railing: Boolean(input.railing),
    closedRisers: Boolean(input.closedRisers),
  }
}

export function calculatePlan(input: StairConfig = DEFAULT_CONFIG, priceOverrides: PriceOverrides = {}): StairPlan {
  const config = normalizeConfig(input)
  const { rise, run, width, risers, material, tread, ending, railing, closedRisers } = config
  const isTurn = ending === 'turn'
  // A turn landing replaces one tread. Run is the sum of both flights, excluding the landing.
  const treadCount = risers - (isTurn ? 2 : 1)
  const riserHeight = rise / risers
  const going = run / treadCount
  // Wide composite fascia is not a structural tread. Composite uses two decking boards.
  const boardsPerTread = material === 'composite' || tread === 'two6' ? 2 : 1
  const boardWidth = boardsPerTread === 2 ? 5.5 : 11.25
  const deckingGap = material === 'composite' ? 0.25 : 0.125
  const boardGap = boardsPerTread === 2 ? deckingGap : 0
  const treadDepth = boardsPerTread * boardWidth + (boardsPerTread - 1) * boardGap
  const treadThickness = material === 'composite' ? 1 : 1.5
  const maxSpacing = material === 'composite' ? 9 : 16
  const stringerCount = Math.max(3, Math.ceil((width - 1.5) / maxSpacing) + 1)
  const stringerSpacing = (width - 1.5) / (stringerCount - 1)
  const stringerPositions = Array.from({ length: stringerCount }, (_, index) => 0.75 + index * stringerSpacing)
  const lowerRisers = isTurn ? Math.floor(risers / 2) : 0
  const upperRisers = isTurn ? risers - lowerRisers : 0
  const lowerRun = isTurn ? (lowerRisers - 1) * going : 0
  const upperRun = isTurn ? (upperRisers - 1) * going : 0
  const lowerStringerLength = isTurn ? Math.hypot(lowerRisers * riserHeight, lowerRun) + 12 : 0
  const upperStringerLength = isTurn ? Math.hypot(upperRisers * riserHeight, upperRun) + 12 : 0
  const stringerLength = isTurn ? Math.max(lowerStringerLength, upperStringerLength) : Math.hypot(rise, run) + 12
  const totalStringerCount = stringerCount * (isTurn ? 2 : 1)
  const lowerBlockingRows = isTurn ? Math.max(2, Math.ceil(lowerRun / 48) + 1) : 0
  const upperBlockingRows = isTurn ? Math.max(2, Math.ceil(upperRun / 48) + 1) : 0
  const blockingRows = isTurn ? lowerBlockingRows + upperBlockingRows : Math.max(2, Math.ceil(run / 48) + 1)
  const blockingLength = stringerSpacing - 1.5
  const landingSize = ending === 'turn' ? Math.max(36, width) : 0
  const materials: MaterialItem[] = []
  const cutList: CutItem[] = []
  const checks: PlanCheck[] = []

  const add = (id: string, name: string, detail: string, quantity: number, unit: string, basePrice: number, category: MaterialItem['category']) => {
    const override = priceOverrides[id]
    const unitPrice = Number.isFinite(override) && override >= 0 ? roundMoney(override) : roundMoney(basePrice)
    materials.push({ id, name, detail, quantity, unit, unitPrice, total: roundMoney(quantity * unitPrice), category })
  }
  const lumber = (id: string, name: string, detail: string, count: number, length: number, pricePerFoot: number, category: MaterialItem['category'] = 'lumber') => {
    if (count <= 0) return
    const allocation = allocateStock(length, count, pricePerFoot)
    if (!allocation.length) {
      // Oversize members are explicitly unresolved, not represented as spliced 16-foot boards.
      add(`${id}-custom`, `${name} · custom length`, `${count} pieces at ${inchLabel(length)}. Longer than modeled stock; supplier/structural design required.`, count, 'allowance', Math.ceil(length / 12) * pricePerFoot, category)
      cutList.push({ id: `${id}-custom`, name, quantity: count, length, stockLength: 0, detail: 'Unresolved custom member; do not splice stringers.' })
      checks.push({ id: `${id}-stock`, status: 'warn', title: 'Longer than stocked lumber', detail: `${name} needs ${inchLabel(length)}; this exceeds the 16-foot stock model.` })
      return
    }
    allocation.forEach(({ stockLength, boards, cuts }) => {
      const rowId = `${id}-${stockLength / 12}ft`
      add(rowId, `${name} × ${stockLength / 12}′`, `${detail} ${cuts} cuts at ${inchLabel(length)} from ${boards} board${boards === 1 ? '' : 's'}.`, boards, 'board', stockLength / 12 * pricePerFoot, category)
      cutList.push({ id: rowId, name, quantity: cuts, length, stockLength, detail: `${boards} × ${stockLength / 12}′ stock; ${SAW_KERF}″ saw kerf included. ${detail}` })
    })
  }

  const treadRate = material === 'treated' ? (boardsPerTread === 2 ? 1.24 : 2.65) : material === 'cedar' ? (boardsPerTread === 2 ? 3.25 : 6.4) : 4.1
  const nominalTread = material === 'composite' ? '1 × 6 deck board' : boardsPerTread === 2 ? '2 × 6' : '2 × 12'
  lumber(`${material}-treads-${boardsPerTread}`, `Tread planks · ${materialNames[material]} ${nominalTread}`, `Tread decking, actual ${inchLabel(boardWidth)} wide.`, treadCount * boardsPerTread, width, treadRate)
  if (isTurn) {
    lumber('stringers-lower', 'Lower-flight stringers · treated 2 × 12', `${lowerRisers} rises; rough blank includes 12″ layout allowance. Verify template and end cuts.`, stringerCount, lowerStringerLength, 2.65)
    lumber('stringers-upper', 'Upper-flight stringers · treated 2 × 12', `${upperRisers} rises; rough blank includes 12″ layout allowance. Verify template and end cuts.`, stringerCount, upperStringerLength, 2.65)
  } else {
    lumber('stringers', 'Stringers · treated 2 × 12', 'Rough blank includes 12″ layout allowance; template and end cuts need field verification.', stringerCount, stringerLength, 2.65)
  }
  lumber('blocking', 'Back bracing / blocking · treated 2 × 6', `${blockingRows} rows between stringers; connection design not specified.`, blockingRows * (stringerCount - 1), blockingLength, 1.24)

  if (closedRisers) {
    const riserRate = material === 'cedar' ? 4.25 : material === 'composite' ? 5.5 : 1.85
    lumber(`${material}-risers`, `Riser boards · ${materialNames[material]} 1 × 12`, `Rip to fit after measuring; ${inchLabel(riserHeight)} finished rise includes tread thickness.`, risers, width, riserRate)
  }

  const landingJoists = landingSize ? Math.ceil((landingSize - 1.5) / maxSpacing) + 1 : 0
  // N boards have only N−1 gaps. Including a fictitious final gap can omit a board.
  const landingDeckBoards = landingSize ? Math.ceil((landingSize + deckingGap) / (5.5 + deckingGap)) : 0
  const treadScrews = treadCount * boardsPerTread * stringerCount * 2
  const riserScrews = closedRisers ? risers * stringerCount * 2 : 0
  const landingScrews = landingDeckBoards * landingJoists * 2
  const screwCount = Math.ceil((treadScrews + riserScrews + landingScrews) * 1.1)
  add(material === 'composite' ? 'composite-screws' : 'deck-screws', material === 'composite' ? 'Composite face screws · 100 pack' : 'Exterior deck screws · 100 pack', `${screwCount} estimated, including 10% spare. Two per board/stringer intersection; product instructions govern.`, Math.ceil(screwCount / 100), 'box', material === 'composite' ? 34 : 18, 'hardware')
  add('stringer-connectors', 'Rated stringer connectors', 'One per stringer at the top of each flight; select an approved connector and its specified fasteners for the actual connection.', totalStringerCount, 'each', 9.8, 'hardware')
  add('connector-fasteners', 'Connector fasteners · allowance', 'Manufacturer-listed nails/screws for hangers and blocking. Deck screws are not connector fasteners.', Math.max(1, Math.ceil(totalStringerCount / 5)), 'box', 24, 'hardware')
  add('base-support', 'Bottom landing / base allowance', 'Budget placeholder for level bearing and landing; footing depth, anchors, concrete quantity and drainage require site assessment.', 1, 'allowance', 95, 'hardware')

  if (railing) {
    const railLength = isTurn ? (Math.hypot(lowerRun, lowerRisers * riserHeight) + Math.hypot(upperRun, upperRisers * riserHeight)) / 12 : Math.hypot(run, rise) / 12
    add('railing', 'Two-sided rail + handrail allowance', 'Posts, infill, graspable handrail, attachment and hardware budget. Final guard system and post connections require design.', 2, 'side', Math.max(95, roundMoney(railLength * 36)), 'options')
  }
  if (ending === 'planter') {
    lumber('planter-cedar', 'Cedar 1 × 6 planter boards', 'Two decorative 18″ square boxes, three courses; liner and independent supports included as an allowance.', 24, 18, 2.45, 'options')
    add('planter-kit', 'Planter liners + bases + hardware', 'Two decorative boxes. Soil weight stays independent of stair structure; plants and soil excluded.', 2, 'kit', 36, 'options')
  }
  if (ending === 'turn') {
    const landingDeckRate = material === 'treated' ? 1.24 : material === 'cedar' ? 3.25 : 4.1
    lumber(`${material}-landing-deck`, `${materialNames[material]} landing decking`, `${inchLabel(landingSize)} square turn landing; rip final board(s) to fit, avoiding narrow edge strips.`, landingDeckBoards, landingSize, landingDeckRate, 'options')
    lumber('landing-joists', 'Treated 2 × 8 landing frame', 'Joists and two rim members; sizing is a budgeting assumption, not a span check.', landingJoists + 2, landingSize, 1.85, 'options')
    lumber('landing-posts', 'Treated 6 × 6 landing post', 'Four rough post blanks; finish height and bearing depend on landing elevation and site.', 4, Math.max(24, lowerRisers * riserHeight + 12), 5.4, 'options')
    add('landing-foundations', 'Landing footings + hardware allowance', 'Four footing locations with post bases, caps and frame connectors. Soil, frost depth, lateral bracing and sizing remain to be designed.', 4, 'allowance', 72, 'options')
    if (railing) add('landing-guard', 'Landing guard allowance', 'Additional exposed landing edge guard budget; includes posts and attachment allowance.', 1, 'allowance', Math.max(100, landingSize / 12 * 45), 'options')
  }

  const check = (id: string, condition: boolean, title: string, detail: string) => checks.push({ id, status: condition ? 'pass' : 'warn', title, detail })
  check('riser', riserHeight <= 7.75, `${inchLabel(riserHeight)} rise per step`, '2021 IRC reference maximum: 7¾″. Keep every finished rise uniform, including top and bottom.')
  if (riserHeight <= treadThickness) checks.push({ id: 'riser-thickness', status: 'warn', title: 'Rise is too small for the tread thickness', detail: `The ${inchLabel(riserHeight)} rise does not clear the ${inchLabel(treadThickness)} tread. Use fewer rises or a greater total height; this assembly cannot be built as shown.` })
  check('going', going >= 10, `${inchLabel(going)} tread going`, 'Measured nose to nose. 2021 IRC reference minimum: 10″; local adopted rules govern.')
  check('width', width >= 36, `${inchLabel(width)} stair width`, '2021 IRC reference: 36″ clear above handrails. Post and rail placement must preserve the required clearance.')
  check('coverage', treadDepth + 0.001 >= going, `${inchLabel(treadDepth)} decking coverage`, treadDepth >= going ? 'Selected boards cover the going. Check front nosing and the gap against your actual board product.' : `These boards leave a ${inchLabel(going - treadDepth)} gap per step. Shorten the run or choose a different tread assembly before building.`)
  if (closedRisers && going < 11) check('nosing', treadDepth - going >= 0.75 && treadDepth - going <= 1.25, 'Check tread nosing', 'For closed risers with going below 11″, the 2021 IRC calls for ¾″–1¼″ nosing. The actual riser-face position affects this detail.')
  check('rail', risers < 4 || railing, railing ? 'Handrail allowance included' : 'Handrail needed at 4+ risers', 'Final handrail must be graspable and continuous; a decorative top rail alone may not qualify.')
  if (rise > 30) check('guard', railing, railing ? 'Guard allowance included' : 'Exposed-side guards need review', 'Open sides more than 30″ above adjacent grade generally need guards; confirm openings, height and attachment locally.')
  if (!closedRisers && rise > 30) check('open-risers', riserHeight - treadThickness < 4, 'Open-riser gap needs review', 'Where an opening is more than 30″ above grade, a 4″ sphere must not pass under the tread under the 2021 IRC reference.')
  const longestRun = isTurn ? Math.max(lowerRun, upperRun) : run
  check('span', longestRun <= 72, longestRun <= 72 ? 'Short-run framing concept' : 'Intermediate support needed', 'AWC DCA 6 cut-stringer reference span is 6′ horizontally per flight, not along the sloped board. This model does not design additional intermediate beams, posts, footings or lateral bracing.')
  if (rise > 151) check('flight-rise', (isTurn ? upperRisers * riserHeight : rise) <= 151, 'Check rise between landings', 'The 2021 IRC reference limits a flight to 12′ 7″ of vertical rise between landings.')
  const throat = 11.25 - going * riserHeight / Math.hypot(going, riserHeight)
  check('throat', throat >= 5, `${inchLabel(throat)} approximate stringer throat`, 'AWC DCA 6 cut-stringer detail retains at least 5″ of wood. Verify species, grade, actual board and final layout before cutting.')
  checks.push({ id: 'spacing', status: 'info', title: `${stringerCount} stringers${isTurn ? ' per flight' : ''} · ${inchLabel(stringerSpacing)} centers`, detail: material === 'composite' ? 'Budget uses a 9″ maximum based on the Trex Enhance stair-spacing example, not a rating for every composite board. Your selected product’s stair-span, fastening and installation instructions govern.' : `Budget uses at most ${maxSpacing}″ centers. Tread species, grade, thickness and the applicable stair-span instructions govern; this spacing is a planning assumption.` })
  if (material === 'composite' && tread === 'one12') checks.push({ id: 'composite-wide', status: 'warn', title: 'Composite uses two deck boards', detail: 'A 12″ composite fascia board is not assumed to be a structural stair tread. The model substitutes two 5½″ decking boards.' })
  if (isTurn) checks.push({ id: 'turn', status: 'info', title: `${lowerRisers} + ${upperRisers} rises with a turn landing`, detail: `The ${inchLabel(lowerRun)} and ${inchLabel(upperRun)} flight runs total ${inchLabel(run)}; the ${inchLabel(landingSize)} landing is extra. Both stringer sets, landing frame, posts and footing allowances are included; connections and lateral bracing still need design.` })
  if (Object.keys(config).some((key) => config[key as keyof StairConfig] !== input[key as keyof StairConfig])) checks.push({ id: 'input', status: 'warn', title: 'Some inputs were adjusted', detail: 'Invalid or out-of-range values were replaced or limited to keep the preview usable. Review the dimensions before using this estimate.' })

  const subtotal = roundMoney(materials.reduce((sum, item) => sum + item.total, 0))
  const contingency = roundMoney(subtotal * 0.1)
  return {
    config,
    geometry: { riserHeight, going, treadDepth, treadThickness, boardsPerTread, boardWidth, boardGap, treadCount, stringerCount, totalStringerCount, stringerSpacing, stringerLength, stringerPositions, blockingRows, blockingLength, landingSize, landingBoardGap: deckingGap, landingDeckBoards, lowerRisers, upperRisers, lowerRun, upperRun, lowerStringerLength, upperStringerLength, lowerBlockingRows, upperBlockingRows, noseProjection: treadDepth - going },
    materials, cutList, checks, subtotal, contingency, total: roundMoney(subtotal + contingency), screwCount,
    assumptions: [
      'Illustrative USD retail prices, not live Home Depot inventory or a supplier quote. Edit unit prices to match your store.',
      'Stock model uses 8′, 10′, 12′ and 16′ boards with a ⅛″ saw kerf; local species, grades, lengths and actual dimensions vary. Offcuts are not shared between different component groups.',
      isTurn ? 'Turn stairs have two flights and an intermediate landing: tread count is two fewer than total risers. Run is both flight runs combined, excluding the intermediate and bottom landings. Rise is finished ground-to-porch height.' : 'Porch surface is the top landing: the model has one fewer tread than risers. Rise is finished ground-to-porch height; run excludes bottom landing space.',
      'The estimate includes a 10% contingency after the listed materials. Tax, delivery, labor, tools, permits, demolition, soil and plants are excluded.',
      'Pressure-treated structural stringers and blocking are budgeted for every finish. Composite is a tread surface, not structural framing.',
      material === 'composite' ? 'Composite preview uses two 5½″ boards with a ¼″ gap and a 9″ maximum stringer spacing, following the Trex Enhance stair example. Verify actual profile, end gaps, temperature requirements and the selected product’s current installation instructions.' : 'Wood decking uses actual 5½″ widths for nominal 2 × 6 and 11¼″ for nominal 2 × 12; paired planks and landing boards use an illustrative ⅛″ gap. Adjust for species, moisture and supplier instructions.',
      'Connection markers and cut lengths illustrate placement only. Verify porch attachment, bottom support, final stringer template, bracing, headroom, landings and local code before building.',
      'Model-code checks are based on the linked 2021 IRC reference and AWC DCA 6; passing these checks is not code approval or structural certification.',
    ],
  }
}
