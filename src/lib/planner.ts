/** Inches and USD throughout. This is a budgeting/layout model, not a structural design. */
export type WoodMaterial = 'treated' | 'cedar'
export type Material = WoodMaterial
export const COMPOSITE_COLORS = [
  { id: 'gray', name: 'Light gray', hex: '#898d8e' },
  { id: 'charcoal', name: 'Charcoal', hex: '#505357' },
  { id: 'sand', name: 'Sand', hex: '#baab8d' },
  { id: 'cedar', name: 'Cedar brown', hex: '#b0825b' },
  { id: 'walnut', name: 'Walnut', hex: '#705342' },
  { id: 'redwood', name: 'Redwood', hex: '#a0664b' },
] as const
export type CompositeColor = typeof COMPOSITE_COLORS[number]['id']
export type SidePanel = 'open' | 'lattice' | 'solid'
export type Tread = 'two6' | 'one12'
export type Ending = 'open' | 'planter' | 'turn'
export type PriceOverrides = Record<string, number>
/** Full-width boards can use the longest stock length modeled by the planner. */
export const MAX_STAIR_WIDTH = 192

export interface StairConfig {
  rise: number
  run: number
  width: number
  risers: number
  material: Material
  compositeTreads: boolean
  compositeColor: CompositeColor
  sidePanel: SidePanel
  returnCaps: boolean
  tread: Tread
  ending: Ending
  railing: boolean
  closedRisers: boolean
}

export const DEFAULT_CONFIG: StairConfig = {
  rise: 36, run: 44, width: 96, risers: 5,
  material: 'treated', compositeTreads: false, compositeColor: 'gray', sidePanel: 'open', returnCaps: false, tread: 'two6', ending: 'open',
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

export type Point3 = [number, number, number]
/** Exact illustrative 2×4 members, inches in the owning flight/landing coordinates. */
export interface PortableMember {
  id: string
  kind: 'drop' | 'runner' | 'crossrail' | 'brace' | 'joist'
  center: Point3
  size: Point3
  from?: Point3
  to?: Point3
  cutLength: number
}
export interface PortableFrame {
  stringerIndex: number
  /** Inches from the left tread edge, unlike member centers which use centered x. */
  x: number
  rearZ: number
  topY: number
  dropHeight: number
  runnerStartZ: number
  runnerLength: number
  runnerY: number
  memberWidth: number
  memberDepth: number
}
export interface SupportFlight {
  flight: 'straight' | 'lower' | 'upper'
  baseElevation: number
  run: number
  rise: number
  risers: number
  frames: PortableFrame[]
  members: PortableMember[]
  crossRows: { z: number; y: number; length: number; depth: number; thickness: number }[]
  stringerBaseCut: number
  maxUnsupportedSpan: number
  unresolved: boolean
}
export interface PortableLanding {
  members: PortableMember[]
  unresolved: boolean
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
    supportFlights: SupportFlight[]
    portableLanding: PortableLanding | null
    sidePanelArea: number
  }
  materials: MaterialItem[]
  cutList: CutItem[]
  checks: PlanCheck[]
  subtotal: number
  contingency: number
  total: number
  screwCount: number
  woodScrewCount: number
  compositeScrewCount: number
  assumptions: string[]
}

export const STOCK_LENGTHS = [96, 120, 144, 192] as const
export const SAW_KERF = 0.125
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const inchLabel = (value: number) => `${Number(value.toFixed(2))}″`
const materialNames: Record<Material, string> = { treated: 'Pressure-treated', cedar: 'Cedar' }

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
    width: Math.max(12, positive(input.width, DEFAULT_CONFIG.width, MAX_STAIR_WIDTH)),
    risers: Math.max(input.ending === 'turn' ? 4 : 2, Math.min(36, Math.round(positive(input.risers, DEFAULT_CONFIG.risers, 36)))),
    material: input.material === 'cedar' ? 'cedar' : 'treated',
    compositeTreads: input.compositeTreads === true,
    compositeColor: COMPOSITE_COLORS.some(color => color.id === input.compositeColor) ? input.compositeColor : 'gray',
    sidePanel: input.sidePanel === 'lattice' || input.sidePanel === 'solid' ? input.sidePanel : 'open',
    returnCaps: input.returnCaps === true,
    tread: input.tread === 'one12' ? 'one12' : 'two6',
    ending: ['open', 'planter', 'turn'].includes(input.ending) ? input.ending : 'open',
    railing: Boolean(input.railing),
    closedRisers: Boolean(input.closedRisers),
  }
}

function member(id: string, kind: PortableMember['kind'], center: Point3, size: Point3, cutLength: number): PortableMember {
  return { id, kind, center, size, cutLength }
}
function brace(id: string, from: Point3, to: Point3): PortableMember {
  const cutLength = Math.hypot(...to.map((value, index) => value - from[index]))
  return { id, kind: 'brace', from, to, center: from.map((value, index) => (value + to[index]) / 2) as Point3, size: [1.5, 3.5, cutLength], cutLength }
}
/** Candidate L-frames only: bearing cuts, joints, loading and stability still need design. */
function supportFlight(flight: SupportFlight['flight'], baseElevation: number, run: number, rise: number, risers: number, width: number, treadThickness: number, going: number, stringerPositions: number[]): SupportFlight {
  const members: PortableMember[] = []
  const crossRows: SupportFlight['crossRows'] = []
  const stringerBaseCut = Math.max(0, 3.5 - baseElevation)
  const slope = (rise / risers) / going
  const underside = (z: number) => Math.max(stringerBaseCut, rise - treadThickness - 11.25 * Math.sqrt(1 + slope ** 2) - z * slope)
  const rearZ = 3.25
  const topY = underside(5)
  const dropHeight = Math.max(0, baseElevation + topY - 3.5)
  const runnerLength = Math.max(0, run - 3.75)
  const runnerY = -baseElevation + 1.75
  const selected = stringerPositions.map((_, index) => index).filter(index => index % 2 === 0 || index === stringerPositions.length - 1)
  const frames: PortableFrame[] = selected.map((stringerIndex, index) => {
    const x = stringerPositions[stringerIndex]
    const centeredX = x - width / 2
    if (runnerLength > 0) members.push(member(`${flight}-runner-${index}`, 'runner', [centeredX, runnerY, (run - 0.75) / 2], [1.5, 3.5, runnerLength], runnerLength))
    if (dropHeight > 0.125 && runnerLength >= 3.5) members.push(member(`${flight}-drop-${index}`, 'drop', [centeredX, -baseElevation + 3.5 + dropHeight / 2, rearZ], [1.5, dropHeight, 3.5], dropHeight))
    return { stringerIndex, x, rearZ, topY, dropHeight, runnerStartZ: 1.5, runnerLength, runnerY, memberWidth: 1.5, memberDepth: 3.5 }
  })
  if (run >= 3) {
    for (const [index, z] of [0.75, run - 1.5].entries()) {
      members.push(member(`${flight}-crossrail-floor-${index}`, 'crossrail', [0, runnerY, z], [width, 3.5, 1.5], width))
      crossRows.push({ z, y: runnerY, length: width, depth: 3.5, thickness: 1.5 })
    }
  }
  const rearTieTop = underside(6.5)
  if (run > 7 && baseElevation + rearTieTop > 7) {
    members.push(member(`${flight}-crossrail-rear`, 'crossrail', [0, rearTieTop - 1.75, 5.75], [width, 3.5, 1.5], width))
    crossRows.push({ z: 5.75, y: rearTieTop - 1.75, length: width, depth: 3.5, thickness: 1.5 })
  }
  if (dropHeight > 7 && run > 12) {
    const braceRise = Math.min(24, dropHeight - 1.75)
    const braceRun = Math.min(24, run - 7)
    for (const [index, frame] of [frames[0], frames[frames.length - 1]].entries()) {
      const x = frame.x - width / 2 + (index === 0 ? 1.5 : -1.5)
      members.push(brace(`${flight}-brace-side-${index}`, [x, -baseElevation + 3.5, 5 + braceRun], [x, -baseElevation + 3.5 + braceRise, 5]))
    }
    for (let index = 1; index < frames.length; index++) {
      members.push(brace(`${flight}-brace-rear-${index}`, [frames[index - 1].x - width / 2, -baseElevation + 3.5, 0.75], [frames[index].x - width / 2, -baseElevation + 3.5 + braceRise, 0.75]))
    }
  }
  const maxUnsupportedSpan = Math.max(0, run - 5)
  return { flight, baseElevation, run, rise, risers, frames, members, crossRows, stringerBaseCut, maxUnsupportedSpan, unresolved: run <= 7 || dropHeight < 3.5 || maxUnsupportedSpan > 72 || (baseElevation === 0 && rise / risers - treadThickness < 3.5) }
}

function landingFrame(size: number, elevation: number, treadThickness: number, maxSpacing: number): PortableLanding {
  const members: PortableMember[] = []
  const count = Math.ceil((size - 1.5) / maxSpacing) + 1
  const positions = Array.from({ length: count }, (_, index) => -size / 2 + 0.75 + index * (size - 1.5) / (count - 1))
  const frameY = elevation - treadThickness - 1.75
  for (const [index, x] of positions.entries()) members.push(member(`landing-joist-${index}`, 'joist', [x, frameY, -size / 2], [1.5, 3.5, size - 3], size - 3))
  for (const [index, z] of [-size + 0.75, -0.75].entries()) {
    members.push(member(`landing-crossrail-top-${index}`, 'crossrail', [0, frameY, z], [size, 3.5, 1.5], size))
    members.push(member(`landing-crossrail-floor-${index}`, 'crossrail', [0, 1.75, z], [size, 3.5, 1.5], size))
  }
  const dropHeight = Math.max(0, elevation - treadThickness - 7)
  const selected = positions.filter((_, index) => index % 2 === 0 || index === positions.length - 1)
  for (const [index, x] of selected.entries()) {
    members.push(member(`landing-runner-${index}`, 'runner', [x, 1.75, -size / 2], [1.5, 3.5, size - 3], size - 3))
    if (dropHeight > 0.125) for (const [end, z] of [-size + 3.25, -3.25].entries()) members.push(member(`landing-drop-${index}-${end}`, 'drop', [x, 3.5 + dropHeight / 2, z], [1.5, dropHeight, 3.5], dropHeight))
  }
  if (dropHeight > 7) {
    const braceRise = Math.min(24, dropHeight - 1.75)
    const braceRun = Math.min(24, size - 7)
    for (const [index, x] of [selected[0] + 1.5, selected[selected.length - 1] - 1.5].entries()) {
      members.push(brace(`landing-brace-side-${index}`, [x, 3.5, -5 - braceRun], [x, 3.5 + braceRise, -5]))
    }
    for (let index = 1; index < selected.length; index++) members.push(brace(`landing-brace-rear-${index}`, [selected[index - 1], 3.5, -size + 0.75], [selected[index], 3.5 + braceRise, -size + 0.75]))
  }
  return { members, unresolved: dropHeight < 3.5 || size - 3 > 72 }
}

export function calculatePlan(input: StairConfig = DEFAULT_CONFIG, priceOverrides: PriceOverrides = {}): StairPlan {
  const config = normalizeConfig(input)
  const { rise, run, width, risers, material, tread, ending, railing, closedRisers, compositeTreads, compositeColor, sidePanel, returnCaps } = config
  const isTurn = ending === 'turn'
  // A turn landing replaces one tread. Run is the sum of both flights, excluding the landing.
  const treadCount = risers - (isTurn ? 2 : 1)
  const riserHeight = rise / risers
  const going = run / treadCount
  // Wide composite fascia is not a structural tread. Composite uses two decking boards.
  const boardsPerTread = compositeTreads || tread === 'two6' ? 2 : 1
  const boardWidth = boardsPerTread === 2 ? 5.5 : 11.25
  const deckingGap = compositeTreads ? 0.25 : 0.125
  const boardGap = boardsPerTread === 2 ? deckingGap : 0
  const treadDepth = boardsPerTread * boardWidth + (boardsPerTread - 1) * boardGap
  const treadThickness = compositeTreads ? 1 : 1.5
  const maxSpacing = compositeTreads ? 9 : 16
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
  const supportFlights = isTurn ? [
    supportFlight('lower', 0, lowerRun, lowerRisers * riserHeight, lowerRisers, width, treadThickness, going, stringerPositions),
    supportFlight('upper', lowerRisers * riserHeight, upperRun, upperRisers * riserHeight, upperRisers, width, treadThickness, going, stringerPositions),
  ] : [supportFlight('straight', 0, run, rise, risers, width, treadThickness, going, stringerPositions)]
  const portableLanding = isTurn ? landingFrame(landingSize, lowerRisers * riserHeight, treadThickness, maxSpacing) : null
  const portableMembers = [...supportFlights.flatMap(flight => flight.members), ...(portableLanding?.members ?? [])]
  const sidePanelArea = supportFlights.reduce((total, flight) => total + 2 * flight.run * (Math.max(0, (flight.risers - 1) * riserHeight - treadThickness) / 2 + flight.baseElevation) / 144, 0)
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

  const surfaceMaterial = compositeTreads ? 'composite' : material
  const compositeName = COMPOSITE_COLORS.find(color => color.id === compositeColor)!.name
  const surfaceName = compositeTreads ? `Composite · ${compositeName}` : materialNames[material]
  const treadRate = compositeTreads ? 4.1 : material === 'treated' ? (boardsPerTread === 2 ? 1.24 : 2.65) : (boardsPerTread === 2 ? 3.25 : 6.4)
  const nominalTread = compositeTreads ? '1 × 6 deck board' : boardsPerTread === 2 ? '2 × 6' : '2 × 12'
  lumber(`${surfaceMaterial}-treads-${boardsPerTread}`, `Tread planks · ${surfaceName} ${nominalTread}`, `Tread decking, actual ${inchLabel(boardWidth)} wide.${compositeTreads ? ' Color is approximate; no color price premium assumed.' : ''}`, treadCount * boardsPerTread, width, treadRate)
  if (isTurn) {
    lumber('stringers-lower', 'Lower-flight stringers · treated 2 × 12', `${lowerRisers} rises; rough blank includes 12″ layout allowance. Verify template and end cuts.`, stringerCount, lowerStringerLength, 2.65)
    lumber('stringers-upper', 'Upper-flight stringers · treated 2 × 12', `${upperRisers} rises; rough blank includes 12″ layout allowance. Verify template and end cuts.`, stringerCount, upperStringerLength, 2.65)
  } else {
    lumber('stringers', 'Stringers · treated 2 × 12', 'Rough blank includes 12″ layout allowance; template and end cuts need field verification.', stringerCount, stringerLength, 2.65)
  }
  lumber('blocking', 'Back bracing / blocking · treated 2 × 6', `${blockingRows} rows between stringers; connection design not specified.`, blockingRows * (stringerCount - 1), blockingLength, 1.24)
  // Group identical lengths by part type, so the purchased stock and visible members agree.
  const frameLumber = (prefix: string, name: string, pieces: PortableMember[]) => {
    const groups = new Map<number, number>()
    pieces.forEach(piece => { if (piece.cutLength > 0.125) groups.set(piece.cutLength, (groups.get(piece.cutLength) ?? 0) + 1) })
    let index = 0
    groups.forEach((count, length) => lumber(`${prefix}-${++index}`, `${name} · treated 2 × 4`, 'Actual 1½″ × 3½″. Illustrative member length; verify bearing and joint details before cutting. Ground-contact-rated treatment for runners.', count, length, 0.89))
  }
  const flightMembers = supportFlights.flatMap(flight => flight.members)
  frameLumber('portable-drops', 'Rear vertical drops', flightMembers.filter(part => part.kind === 'drop'))
  frameLumber('portable-runners', 'Bottom runners', flightMembers.filter(part => part.kind === 'runner'))
  frameLumber('portable-crossrails', 'Crossrails tying L frames', flightMembers.filter(part => part.kind === 'crossrail'))
  frameLumber('portable-braces', 'Diagonal frame bracing', portableMembers.filter(part => part.kind === 'brace'))
  if (portableLanding) {
    frameLumber('landing-drops', 'Turn landing vertical drops', portableLanding.members.filter(part => part.kind === 'drop'))
    frameLumber('landing-runners', 'Turn landing bottom runners', portableLanding.members.filter(part => part.kind === 'runner'))
    frameLumber('landing-frame', 'Turn landing frame', portableLanding.members.filter(part => part.kind === 'joist' || part.kind === 'crossrail'))
  }

  if (closedRisers) {
    const riserRate = material === 'cedar' ? 4.25 : 1.85
    lumber(`${material}-risers`, `Riser boards · ${materialNames[material]} 1 × 12`, `Rip to fit after measuring; ${inchLabel(riserHeight)} finished rise includes tread thickness.`, risers, width, riserRate)
  }

  const landingJoists = landingSize ? Math.ceil((landingSize - 1.5) / maxSpacing) + 1 : 0
  // N boards have only N−1 gaps. Including a fictitious final gap can omit a board.
  const landingDeckBoards = landingSize ? Math.ceil((landingSize + deckingGap) / (5.5 + deckingGap)) : 0
  const treadScrews = treadCount * boardsPerTread * stringerCount * 2
  const riserScrews = closedRisers ? risers * stringerCount * 2 : 0
  const landingScrews = landingDeckBoards * landingJoists * 2
  const woodScrewCount = Math.ceil((riserScrews + (compositeTreads ? 0 : treadScrews + landingScrews)) * 1.1)
  const compositeScrewCount = compositeTreads ? Math.ceil((treadScrews + landingScrews) * 1.1) : 0
  const screwCount = woodScrewCount + compositeScrewCount
  if (woodScrewCount) add('deck-screws', 'Exterior wood screws · 100 pack', `${woodScrewCount} estimated, including 10% spare. Two per wood-board/support intersection. Separate from rated structural connection fasteners.`, Math.ceil(woodScrewCount / 100), 'box', 18, 'hardware')
  if (compositeScrewCount) add('composite-screws', 'Composite face screws · 100 pack', `${compositeScrewCount} estimated, including 10% spare. Walking surfaces only; use the selected composite product’s approved stair fasteners.`, Math.ceil(compositeScrewCount / 100), 'box', 34, 'hardware')
  add('portable-connections', 'Portable frame connection allowance', 'Budget for rated screws/bolts and restraint hardware at wood-frame joints. Joint geometry, bearing and fastener selection still require verification; no concrete porch anchors included.', Math.max(1, Math.ceil(portableMembers.length / 8)), 'kit', 24, 'hardware')
  add('connector-fasteners', 'Blocking connector fasteners · allowance', 'Listed structural fasteners for blocking and stringer restraint. Ordinary deck screws are not a substitute for a specified structural connector screw.', Math.max(1, Math.ceil((blockingRows * (stringerCount - 1) * 4 + totalStringerCount * 6) / 100)), 'box', 24, 'hardware')

  if (sidePanel !== 'open') {
    let panelFasteners = 0
    supportFlights.forEach(flight => {
      const rear = Math.max(0, (flight.risers - 1) * riserHeight - treadThickness)
      const height = rear + flight.baseElevation
      if (height <= 0) return
      const perimeter = flight.run + height + Math.hypot(flight.run, rear) + flight.baseElevation
      if (sidePanel === 'lattice') {
        // Budget each side separately from rectangular stock; no assumed triangular-offcut reuse.
        const sheets = 2 * Math.ceil(flight.run / 96) * Math.ceil(height / 48)
        add(`side-panel-lattice-${flight.flight}`, `${materialNames[material]} lattice · 4′ × 8′ panel`, `Two outer sides: ${Number((2 * flight.run * (rear / 2 + flight.baseElevation) / 144).toFixed(2))} ft² net. Rectangular-stock allowance; cut to the sloping outline. Decorative only.`, sheets, 'panel', material === 'cedar' ? 72 : 42, 'options')
        panelFasteners += Math.ceil(2 * perimeter / 8)
      } else {
        let row = 0
        for (let y = -flight.baseElevation; y < rear - 1e-8; y += 5.625) {
          const length = rear > 0 ? flight.run * (1 - Math.max(0, y) / rear) : flight.run
          if (length <= 0) continue
          lumber(`side-panel-solid-${flight.flight}-${++row}`, `${materialNames[material]} side cladding · 1 × 6`, 'Two matching outer sides. Horizontal boards with ⅛″ gaps; cut the sloped end to fit. Decorative cladding, not bracing.', 2, length, material === 'cedar' ? 2.45 : 1.05, 'options')
          panelFasteners += 4 * (Math.ceil(length / 16) + 1)
        }
      }
      for (const [index, length] of [flight.run, height, Math.hypot(flight.run, rear), ...(flight.baseElevation > 0 ? [flight.baseElevation] : [])].entries()) {
        if (length > 0) lumber(`side-panel-battens-${flight.flight}-${index + 1}`, `${materialNames[material]} edge battens · 1 × 2`, 'One perimeter batten per side; trim and mounting only, not structural bracing.', 2, length, material === 'cedar' ? 1.05 : 0.55, 'options')
      }
    })
    if (panelFasteners) add('side-panel-fasteners', 'Side-panel exterior fasteners · 100 pack', 'Separate cladding and batten fastening allowance, with 10% spare; use corrosion-compatible exterior fasteners.', Math.ceil(Math.ceil(panelFasteners * 1.1) / 100), 'box', 18, 'options')
  }
  if (returnCaps) {
    supportFlights.forEach(flight => {
      lumber(`return-cap-long-${flight.flight}`, `${materialNames[material]} sloped edge caps · 1 × 4`, 'Two decorative outer edge caps. Field-miter the ends; these are not tread extensions or structural members.', 2, Math.hypot(flight.run + 0.75, flight.rise - riserHeight), material === 'cedar' ? 1.75 : 0.85, 'options')
      lumber(`return-cap-short-${flight.flight}`, `${materialNames[material]} 90° cap returns · 1 × 4`, 'Two short inward returns at the outer corners, forming L-shaped finish caps. Verify the concrete abutment in the field.', 2, Math.min(8, width / 4), material === 'cedar' ? 1.75 : 0.85, 'options')
    })
    add('return-cap-fasteners', 'Return-cap exterior fasteners · allowance', 'Decorative cap attachment only; no anchors into the concrete porch.', Math.max(1, supportFlights.length), 'pack', 8, 'options')
  }

  if (railing) {
    const railLength = isTurn ? (Math.hypot(lowerRun, lowerRisers * riserHeight) + Math.hypot(upperRun, upperRisers * riserHeight)) / 12 : Math.hypot(run, rise) / 12
    add('railing', 'Two-sided rail + handrail allowance', 'Posts, infill, graspable handrail, attachment and hardware budget. Final guard system and post connections require design.', 2, 'side', Math.max(95, roundMoney(railLength * 36)), 'options')
  }
  if (ending === 'planter') {
    lumber('planter-cedar', 'Cedar 1 × 6 planter boards', 'Two decorative 18″ square boxes, three courses; liner and independent supports included as an allowance.', 24, 18, 2.45, 'options')
    add('planter-kit', 'Planter liners + bases + hardware', 'Two decorative boxes. Soil weight stays independent of stair structure; plants and soil excluded.', 2, 'kit', 36, 'options')
  }
  if (ending === 'turn') {
    const landingDeckRate = compositeTreads ? 4.1 : material === 'treated' ? 1.24 : 3.25
    lumber(`${surfaceMaterial}-landing-deck`, `${surfaceName} landing decking`, `${inchLabel(landingSize)} square turn landing; rip final board(s) to fit, avoiding narrow edge strips.`, landingDeckBoards, landingSize, landingDeckRate, 'options')
    if (railing) add('landing-guard', 'Landing guard allowance', 'Both exposed landing edges; includes posts and attachment allowance.', 1, 'allowance', Math.max(100, 2 * landingSize / 12 * 45), 'options')
  }

  const check = (id: string, condition: boolean, title: string, detail: string) => checks.push({ id, status: condition ? 'pass' : 'warn', title, detail })
  check('riser', riserHeight <= 7.75, `${inchLabel(riserHeight)} rise per step`, '2021 IRC reference maximum: 7¾″. Keep every finished rise uniform, including top and bottom.')
  if (riserHeight <= treadThickness) checks.push({ id: 'riser-thickness', status: 'warn', title: 'Rise is too small for the tread thickness', detail: `The ${inchLabel(riserHeight)} rise does not clear the ${inchLabel(treadThickness)} tread. Use fewer rises or a greater total height; this assembly cannot be built as shown.` })
  if (riserHeight - treadThickness < 3.5) checks.push({ id: 'portable-clearance', status: 'warn', title: 'First tread does not clear the bottom frame', detail: `Only ${inchLabel(Math.max(0, riserHeight - treadThickness))} remains beneath the first tread, less than the 3½″ runner/crossrail height. Increase the finished rise per step or revise the portable base design; the illustrated frame cannot fit.` })
  check('going', going >= 10, `${inchLabel(going)} tread going`, 'Measured nose to nose. 2021 IRC reference minimum: 10″; local adopted rules govern.')
  check('width', width >= 36, `${inchLabel(width)} stair width`, '2021 IRC reference: 36″ clear above handrails. Post and rail placement must preserve the required clearance.')
  check('coverage', treadDepth + 0.001 >= going, `${inchLabel(treadDepth)} decking coverage`, treadDepth >= going ? 'Selected boards cover the going. Check front nosing and the gap against your actual board product.' : `These boards leave a ${inchLabel(going - treadDepth)} gap per step. Shorten the run or choose a different tread assembly before building.`)
  if (closedRisers && going < 11) check('nosing', treadDepth - going >= 0.75 && treadDepth - going <= 1.25, 'Check tread nosing', 'For closed risers with going below 11″, the 2021 IRC calls for ¾″–1¼″ nosing. The actual riser-face position affects this detail.')
  check('rail', risers < 4 || railing, railing ? 'Handrail allowance included' : 'Handrail needed at 4+ risers', 'Final handrail must be graspable and continuous; a decorative top rail alone may not qualify.')
  if (rise > 30) check('guard', railing, railing ? 'Guard allowance included' : 'Exposed-side guards need review', 'Open sides more than 30″ above adjacent grade generally need guards; confirm openings, height and attachment locally.')
  if (!closedRisers && rise > 30) check('open-risers', riserHeight - treadThickness < 4, 'Open-riser gap needs review', 'Where an opening is more than 30″ above grade, a 4″ sphere must not pass under the tread under the 2021 IRC reference.')
  const supportLayoutFits = supportFlights.every(flight => !flight.unresolved)
  checks.push({ id: 'span', status: supportLayoutFits ? 'info' : 'warn', title: supportLayoutFits ? 'Rear drops and bottom runners are included' : 'Portable frame needs a revised support detail', detail: supportLayoutFits ? `The largest horizontal gap from the rear drop to the toe is ${inchLabel(Math.max(...supportFlights.map(flight => flight.maxUnsupportedSpan)))}. The DCA 6 6′ cut-stringer span reference is only a screening check; it does not validate this portable frame.` : 'A flight has insufficient clearance for usable rear drops or a horizontal support gap over 6′. The proposed portable unit needs a revised support detail and quote; no extra intermediate foundation is assumed.' })
  checks.push({ id: 'freestanding', status: 'warn', title: 'Portable frame stability and bearing need verification', detail: 'The stair unit only abuts the concrete porch. Verify 2 × 4 member sizing, every-other-stringer load transfer, joints, toe bearing cuts, top overhang, sliding and racking resistance. Neither porch anchoring nor foundations are assumed. These details must be designed for the site and loads.' })
  if (width > 96 || isTurn) checks.push({ id: 'portability', status: 'info', title: 'Movable does not mean hand-portable', detail: 'A wide or turning stair unit can be very heavy. Plan lifting, access and modular connections before assembly; the estimate does not include lifting equipment.' })
  if (sidePanel !== 'open' || returnCaps) checks.push({ id: 'finish-options', status: 'info', title: 'Side panels and return caps are decorative', detail: 'Cladding, lattice, edge battens and 90° return caps provide no assumed load support, guard protection or structural bracing. Preserve drainage, ground clearance and access to inspect connections.' })
  if (rise > 151) check('flight-rise', (isTurn ? upperRisers * riserHeight : rise) <= 151, 'Check rise between landings', 'The 2021 IRC reference limits a flight to 12′ 7″ of vertical rise between landings.')
  const throat = 11.25 - going * riserHeight / Math.hypot(going, riserHeight)
  check('throat', throat >= 5, `${inchLabel(throat)} approximate stringer throat`, 'AWC DCA 6 cut-stringer detail retains at least 5″ of wood. Verify species, grade, actual board and final layout before cutting. This estimate excludes the effect of the separate toe bearing cut; that residual section needs its own check.')
  checks.push({ id: 'spacing', status: 'info', title: `${stringerCount} stringers${isTurn ? ' per flight' : ''} · ${inchLabel(stringerSpacing)} centers`, detail: compositeTreads ? 'Budget uses a 9″ maximum based on the Trex Enhance stair-spacing example, not a rating for every composite board. Your selected product’s stair-span, fastening and installation instructions govern.' : `Budget uses at most ${maxSpacing}″ centers. Tread species, grade, thickness and the applicable stair-span instructions govern; this spacing is a planning assumption.` })
  if (compositeTreads && tread === 'one12') checks.push({ id: 'composite-wide', status: 'info', title: 'Composite uses two deck boards', detail: 'A 12″ composite fascia board is not assumed to be a structural stair tread. The model uses two 5½″ decking boards while preserving your wood tread choice for when composite is switched off.' })
  if (isTurn) checks.push({ id: 'turn', status: 'info', title: `${lowerRisers} + ${upperRisers} rises with a turn landing`, detail: `The ${inchLabel(lowerRun)} and ${inchLabel(upperRun)} flight runs total ${inchLabel(run)}; the ${inchLabel(landingSize)} landing is extra. Both stringer sets and the landing’s 2 × 4 drop-and-runner frame are included; load capacity, connections and stability still need design.` })
  if (isTurn) checks.push({ id: 'landing-support', status: 'warn', title: 'Turn landing support needs design', detail: `This ${inchLabel(landingSize)} square landing uses an illustrative 2 × 4 frame, drops and ground runners. Its joist spans, support layout, connections and lateral stability have not been engineered. Larger members or a revised layout may be needed and would change this allowance.` })
  if (Object.keys(config).some((key) => config[key as keyof StairConfig] !== input[key as keyof StairConfig])) checks.push({ id: 'input', status: 'warn', title: 'Some inputs were adjusted', detail: 'Invalid or out-of-range values were replaced or limited to keep the preview usable. Review the dimensions before using this estimate.' })

  const subtotal = roundMoney(materials.reduce((sum, item) => sum + item.total, 0))
  const contingency = roundMoney(subtotal * 0.1)
  return {
    config,
    geometry: { riserHeight, going, treadDepth, treadThickness, boardsPerTread, boardWidth, boardGap, treadCount, stringerCount, totalStringerCount, stringerSpacing, stringerLength, stringerPositions, blockingRows, blockingLength, landingSize, landingBoardGap: deckingGap, landingDeckBoards, lowerRisers, upperRisers, lowerRun, upperRun, lowerStringerLength, upperStringerLength, lowerBlockingRows, upperBlockingRows, noseProjection: treadDepth - going, supportFlights, portableLanding, sidePanelArea },
    materials, cutList, checks, subtotal, contingency, total: roundMoney(subtotal + contingency), screwCount, woodScrewCount, compositeScrewCount,
    assumptions: [
      'Illustrative USD retail prices, not live Home Depot inventory or a supplier quote. Edit unit prices to match your store.',
      'Stock model uses 8′, 10′, 12′ and 16′ boards with a ⅛″ saw kerf; local species, grades, lengths and actual dimensions vary. Offcuts are not shared between different component groups.',
      isTurn ? 'Turn stairs have two flights and an intermediate landing: tread count is two fewer than total risers. Run is both flight runs combined, excluding the intermediate and bottom landings. Rise is finished ground-to-porch height.' : 'Porch surface is the top landing: the model has one fewer tread than risers. Rise is finished ground-to-porch height; run excludes bottom landing space.',
      'The estimate includes a 10% contingency after the listed materials. Tax, delivery, labor, tools, permits, demolition, soil and plants are excluded.',
      'The existing concrete porch is outside the estimate. The movable wooden unit rests on its own ground runners and butts against the porch; no load-bearing porch attachment, new concrete, footings or anchors are included.',
      'Pressure-treated stringers, blocking and 2 × 4 rear drops, runners, crossrails and diagonal braces are budgeted for every finish. Drops follow alternating stringers plus both outer edges. These illustrative sizes are not structurally verified. Risers and decorative wood finish follow your selected wood; composite covers walking surfaces only.',
      'Runner bottoms sit on the assumed finished level ground. Upper-turn drops extend to that ground as well. Lower stringer toes are clipped at the 3½″ runner/crossrail top in the preview; this bearing cut, residual section, and all load transfer must be verified before cutting.',
      'The estimate assumes a suitable existing bearing surface; site preparation and an adequate bottom landing are not priced. Ground-contact treatment, drainage, settlement, lifting, sliding resistance, bracing and all structural connections require site-specific decisions.',
      compositeTreads ? 'Composite preview uses two 5½″ boards with a ¼″ gap and a 9″ maximum stringer spacing, following the Trex Enhance stair example. Verify actual profile, end gaps, temperature requirements and the selected product’s current installation instructions.' : 'Wood decking uses actual 5½″ widths for nominal 2 × 6 and 11¼″ for nominal 2 × 12; paired planks and landing boards use an illustrative ⅛″ gap. Adjust for species, moisture and supplier instructions.',
      'Connection markers and cut lengths illustrate placement only. Verify ground bearing, final stringer template, portable frame capacity and stability, bracing, headroom, landings and local code before building.',
      ...(compositeTreads ? [`Composite color: ${compositeName}. Preview colors are approximate; all swatches use the same illustrative unit price.`] : []),
      ...(sidePanel !== 'open' ? ['Side-panel area includes both outer flight sides, extending upper-flight panels to ground. Sheet budgets use rectangular stock without assumed offcut reuse; solid boards and perimeter battens use kerf-aware stock cuts. Panels are nonstructural.'] : []),
      'Model-code checks are based on the linked 2021 IRC reference and AWC DCA 6; passing these checks is not code approval or structural certification.',
    ],
  }
}
