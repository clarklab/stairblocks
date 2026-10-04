import { describe, expect, it } from 'vitest'
import { allocateStock, calculatePlan, cutsPerBoard, COMPOSITE_COLORS, DEFAULT_CONFIG, SAW_KERF } from './planner'

describe('stair geometry and checks', () => {
  it('uses the porch as the final landing, with one fewer tread than rises', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, railing: true })
    expect(plan.geometry.treadCount).toBe(4)
    expect(plan.geometry.riserHeight).toBe(7.2)
    expect(plan.geometry.going).toBe(11)
    expect(plan.geometry.boardWidth).toBe(5.5)
    expect(plan.geometry.treadDepth).toBe(11.125)
    for (const id of ['riser', 'going', 'width', 'coverage', 'rail', 'throat']) expect(plan.checks.find(check => check.id === id)?.status).toBe('pass')
  })

  it('does not stretch actual boards to cover an unsafe long going', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, run: 60 })
    expect(plan.geometry.going).toBe(15)
    expect(plan.geometry.treadDepth).toBe(11.125)
    expect(plan.checks.find((check) => check.id === 'coverage')?.status).toBe('warn')
  })

  it('flags rises that cannot clear the selected tread thickness', () => {
    for (const rise of [14, 18]) {
      const plan = calculatePlan({ ...DEFAULT_CONFIG, rise, risers: 12 })
      expect(plan.checks.find((check) => check.id === 'riser-thickness')?.status).toBe('warn')
    }
    const thinnerComposite = calculatePlan({ ...DEFAULT_CONFIG, rise: 14, risers: 12, compositeTreads: true })
    expect(thinnerComposite.checks.some((check) => check.id === 'riser-thickness')).toBe(false)
  })

  it('flags height, width, going and handrail limitations separately', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, rise: 40, run: 36, width: 30, railing: false })
    for (const id of ['riser', 'going', 'width', 'rail', 'guard']) expect(plan.checks.find((check) => check.id === id)?.status).toBe('warn')
  })

  it('adds stringers for composite and never assumes fascia is a tread', () => {
    const wood = calculatePlan(DEFAULT_CONFIG)
    const composite = calculatePlan({ ...DEFAULT_CONFIG, compositeTreads: true, tread: 'one12' })
    expect(composite.geometry.stringerCount).toBeGreaterThan(wood.geometry.stringerCount)
    expect(composite.geometry.stringerSpacing).toBeLessThanOrEqual(9)
    expect(composite.geometry.boardsPerTread).toBe(2)
    expect(composite.geometry.boardGap).toBe(0.25)
    expect(composite.geometry.treadDepth).toBe(11.25)
    expect(composite.checks.find((check) => check.id === 'composite-wide')?.status).toBe('info')
  })

  it('keeps malformed inputs and price overrides from contaminating totals', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, rise: NaN, run: Infinity, risers: 0, width: -2 }, { 'deck-screws': -100, 'stringer-connectors': NaN })
    expect(Number.isFinite(plan.total)).toBe(true)
    expect(plan.materials.every((item) => item.unitPrice >= 0 && Number.isFinite(item.total))).toBe(true)
    expect(plan.checks.find((check) => check.id === 'input')?.status).toBe('warn')
  })

  it('keeps 8 feet as the default and scales 16-foot stairs without shortening the boards', () => {
    const starter = calculatePlan(DEFAULT_CONFIG)
    const wide = calculatePlan({ ...DEFAULT_CONFIG, width: 192 })
    expect(DEFAULT_CONFIG.width).toBe(96)
    expect(wide.config.width).toBe(192)
    expect(wide.geometry.stringerCount).toBe(13)
    expect(wide.geometry.stringerSpacing).toBeLessThanOrEqual(16)
    expect(wide.geometry.supportFlights[0].frames).toHaveLength(7)
    const treads = wide.cutList.filter(item => item.id.startsWith('treated-treads-'))
    expect(treads.reduce((sum, item) => sum + item.quantity, 0)).toBe(8)
    expect(treads.every(item => item.length === 192 && item.stockLength === 192)).toBe(true)
    expect(wide.materials.some(item => item.id.includes('footing'))).toBe(false)
    expect(wide.total).toBeGreaterThan(starter.total)
    expect(wide.checks.some(check => check.id === 'input')).toBe(false)
  })
})

describe('purchased stock and material budgets', () => {
  it('accounts for saw kerf when exact board lengths would otherwise undercount', () => {
    expect(cutsPerBoard(96, 48)).toBe(1)
    expect(cutsPerBoard(96, 47.9)).toBe(2)
    expect(cutsPerBoard(144, 48)).toBe(2)
    expect(cutsPerBoard(96, 96)).toBe(1)
  })

  it('covers every required cut across changing widths without splicing', () => {
    for (const width of [36, 47.9, 48, 60, 72, 96, 120, 144, 192]) {
      for (const needed of [1, 5, 8, 17]) {
        const allocation = allocateStock(width, needed, 2)
        expect(allocation.reduce((sum, item) => sum + item.cuts, 0)).toBe(needed)
        for (const item of allocation) {
          expect(item.boards * cutsPerBoard(item.stockLength, width)).toBeGreaterThanOrEqual(item.cuts)
          expect(cutsPerBoard(item.stockLength, width) * width + Math.max(0, cutsPerBoard(item.stockLength, width) - 1) * SAW_KERF).toBeLessThanOrEqual(item.stockLength + 0.0001)
        }
      }
    }
  })

  it('does not fabricate spliced stock for oversize stringers', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, rise: 100, run: 200, risers: 15 })
    expect(plan.cutList.find((item) => item.id === 'stringers-custom')?.stockLength).toBe(0)
    expect(plan.checks.find((check) => check.id === 'stringers-stock')?.status).toBe('warn')
    expect(plan.checks.find((check) => check.id === 'span')?.status).toBe('warn')
  })

  it('recalculates totals from edited prices and includes contingency exactly once', () => {
    const original = calculatePlan(DEFAULT_CONFIG)
    const item = original.materials.find((row) => row.id === 'deck-screws')!
    const edited = calculatePlan(DEFAULT_CONFIG, { [item.id]: 20 })
    expect(edited.subtotal).toBeCloseTo(original.subtotal + item.quantity * (20 - item.unitPrice), 2)
    expect(edited.total).toBeCloseTo(edited.subtotal + edited.contingency, 2)
    expect(edited.contingency).toBeCloseTo(edited.subtotal * 0.1, 2)
  })

  it('adds walking boards and an integrated wood base frame for the turn', () => {
    const straight = calculatePlan(DEFAULT_CONFIG)
    const turn = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn' })
    expect(turn.total).toBeGreaterThan(straight.total)
    expect(turn.geometry.landingSize).toBe(DEFAULT_CONFIG.width)
    expect(turn.geometry.portableLanding?.members.some(member => member.kind === 'joist')).toBe(true)
    expect(turn.materials.some(item => /footing|foundation/.test(item.id))).toBe(false)
    expect(turn.screwCount).toBeGreaterThan(straight.screwCount)
  })

  it('budgets guards on both edges of a wide landing and flags its unresolved support design', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, width: 192, ending: 'turn', railing: true })
    expect(plan.geometry.landingSize).toBe(192)
    expect(plan.materials.find(item => item.id === 'landing-guard')?.total).toBe(1440)
    expect(plan.checks.find(check => check.id === 'landing-support')?.status).toBe('warn')
  })

  it('covers the landing without counting an extra gap beyond its last board', () => {
    for (const width of [44.875, 45, 48, 90]) {
      const plan = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', width, run: 33 })
      const boards = plan.cutList.filter((item) => item.id.startsWith('treated-landing-deck-')).reduce((sum, item) => sum + item.quantity, 0)
      expect(boards * 5.5 + (boards - 1) * 0.125).toBeGreaterThanOrEqual(width)
      expect((boards - 1) * 5.5 + Math.max(0, boards - 2) * 0.125).toBeLessThan(width)
      if (width === 45) expect(boards).toBe(9)
    }
  })

  it('uses the composite installation gap for landing coverage and stock cuts', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', width: 45, run: 33, compositeTreads: true })
    const boards = plan.cutList.filter((item) => item.id.startsWith('composite-landing-deck-')).reduce((sum, item) => sum + item.quantity, 0)
    expect(plan.geometry.landingBoardGap).toBe(0.25)
    expect(plan.geometry.landingDeckBoards).toBe(8)
    expect(boards).toBe(plan.geometry.landingDeckBoards)
    expect(boards * 5.5 + (boards - 1) * plan.geometry.landingBoardGap).toBeGreaterThanOrEqual(45)
  })

  it('replaces one stair tread with a landing and budgets both flight stringer sets', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, rise: 35, ending: 'turn', run: 33, railing: true })
    const geometry = plan.geometry
    const cuts = (prefix: string) => plan.cutList.filter((item) => item.id.startsWith(prefix)).reduce((sum, item) => sum + item.quantity, 0)
    expect(geometry.lowerRisers).toBe(2)
    expect(geometry.upperRisers).toBe(3)
    expect(geometry.treadCount).toBe(3)
    expect(geometry.going).toBe(11)
    expect(geometry.lowerRun).toBe(11)
    expect(geometry.upperRun).toBe(22)
    expect(cuts('treated-treads-')).toBe(6)
    expect(cuts('treated-risers-')).toBe(5)
    expect(cuts('stringers-lower-')).toBe(geometry.stringerCount)
    expect(cuts('stringers-upper-')).toBe(geometry.stringerCount)
    expect(cuts('blocking-')).toBe(geometry.blockingRows * (geometry.stringerCount - 1))
    expect(geometry.totalStringerCount).toBe(2 * geometry.stringerCount)
    expect(geometry.supportFlights).toHaveLength(2)
    expect(geometry.supportFlights.every(flight => flight.frames.length > 0)).toBe(true)
    expect(plan.cutList.find((item) => item.id.startsWith('stringers-lower-'))?.length).toBeCloseTo(Math.hypot(14, 11) + 12)
    expect(plan.cutList.find((item) => item.id.startsWith('stringers-upper-'))?.length).toBeCloseTo(Math.hypot(21, 22) + 12)
    expect(plan.checks.find(check => check.id === 'landing-support')?.status).toBe('warn')
  })

  it('preserves total rise and combined run through odd and even turn splits', () => {
    for (const risers of [4, 5, 6, 9, 12]) {
      const plan = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', rise: risers * 7, run: (risers - 2) * 11, risers })
      const g = plan.geometry
      expect(g.lowerRisers + g.upperRisers).toBe(risers)
      expect(g.lowerRisers * g.riserHeight + g.upperRisers * g.riserHeight).toBeCloseTo(plan.config.rise)
      expect(g.lowerRun + g.upperRun).toBeCloseTo(plan.config.run)
      expect(g.treadCount).toBe(g.lowerRisers - 1 + g.upperRisers - 1)
      expect(g.blockingRows).toBe(g.lowerBlockingRows + g.upperBlockingRows)
    }
  })

  it('flags flights that need another support detail and normalizes unusable turn counts', () => {
    const long = calculatePlan({ ...DEFAULT_CONFIG, rise: 84, run: 121, risers: 12 })
    expect(long.geometry.supportFlights[0].maxUnsupportedSpan).toBeGreaterThan(72)
    expect(long.geometry.supportFlights[0].unresolved).toBe(true)
    expect(long.checks.find(check => check.id === 'span')?.status).toBe('warn')
    const tooFew = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', risers: 2, rise: 28, run: 22 })
    expect(tooFew.config.risers).toBe(4)
    expect(tooFew.geometry.lowerRisers).toBe(2)
    expect(tooFew.geometry.upperRisers).toBe(2)
    expect(tooFew.checks.find(check => check.id === 'input')?.status).toBe('warn')
  })

  it('uses rear drops and forward runners under alternate stringers and both outer edges', () => {
    for (const width of [36, 96, 192]) {
      const plan = calculatePlan({ ...DEFAULT_CONFIG, width })
      const flight = plan.geometry.supportFlights[0]
      const indices = flight.frames.map(frame => frame.stringerIndex)
      expect(indices[0]).toBe(0)
      expect(indices.at(-1)).toBe(plan.geometry.stringerCount - 1)
      expect(indices.every(index => index % 2 === 0 || index === plan.geometry.stringerCount - 1)).toBe(true)
      expect(new Set(indices).size).toBe(indices.length)
      for (const frame of flight.frames) {
        expect(frame.runnerY - frame.memberDepth / 2 + flight.baseElevation).toBeCloseTo(0)
        expect(frame.runnerLength).toBeGreaterThan(0)
        expect(frame.dropHeight).toBeGreaterThan(0)
      }
      expect(plan.materials.some(item => /footing|foundation|post-base|post-cap|support-beam/.test(item.id))).toBe(false)
      expect(flight.members.some(member => member.kind === 'brace')).toBe(true)
      expect(flight.members.some(member => member.kind === 'crossrail')).toBe(true)
    }
  })

  it('budgets each portable frame member using its modeled cut length', () => {
    for (const ending of ['open', 'turn'] as const) {
      const plan = calculatePlan({ ...DEFAULT_CONFIG, ending })
      const members = [...plan.geometry.supportFlights.flatMap(flight => flight.members), ...(plan.geometry.portableLanding?.members ?? [])]
      const cuts = plan.cutList.filter(item => /^(portable-|landing-drops-|landing-runners-|landing-frame-)/.test(item.id))
      expect(cuts.reduce((sum, item) => sum + item.quantity, 0)).toBe(members.length)
      expect(cuts.reduce((sum, item) => sum + item.quantity * item.length, 0)).toBeCloseTo(members.reduce((sum, member) => sum + member.cutLength, 0), 3)
      expect(cuts.every(item => item.name.includes('2 × 4'))).toBe(true)
    }
  })

  it('keeps upper-flight runners on the ground and adds a landing frame without concrete', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', rise: 70, risers: 10, run: 88 })
    const upper = plan.geometry.supportFlights.find(flight => flight.flight === 'upper')!
    expect(upper.baseElevation).toBe(35)
    for (const frame of upper.frames) expect(frame.runnerY + upper.baseElevation).toBeCloseTo(1.75)
    expect(plan.geometry.portableLanding?.members.length).toBeGreaterThan(0)
    expect(plan.materials.some(item => /concrete|footing|foundation/.test(item.name.toLowerCase()))).toBe(false)
  })

  it('keeps low-profile members finite and flags the unresolved support fit', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, rise: 14, run: 144, risers: 3 })
    expect(plan.geometry.supportFlights[0].unresolved).toBe(true)
    expect(plan.checks.find(check => check.id === 'span')?.status).toBe('warn')
    expect(plan.geometry.supportFlights.flatMap(flight => flight.members).every(member => member.cutLength > 0 && Number.isFinite(member.cutLength))).toBe(true)
    expect(plan.materials.every(item => Number.isFinite(item.total) && item.quantity > 0)).toBe(true)
  })

  it('applies composite only to walking boards while preserving wood risers and structural lumber', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, material: 'cedar', tread: 'one12', compositeTreads: true, ending: 'turn' })
    expect(plan.config.material).toBe('cedar')
    expect(plan.config.tread).toBe('one12')
    expect(plan.geometry.boardsPerTread).toBe(2)
    expect(plan.cutList.some(item => item.id.startsWith('cedar-risers-'))).toBe(true)
    expect(plan.cutList.some(item => item.id.startsWith('composite-risers-'))).toBe(false)
    expect(plan.cutList.filter(item => item.id.startsWith('composite-')).every(item => /treads|landing-deck/.test(item.id))).toBe(true)
    expect(plan.cutList.filter(item => /^(portable-|stringers|blocking)/.test(item.id)).every(item => /treated/i.test(item.name))).toBe(true)
    expect(plan.woodScrewCount).toBeGreaterThan(0)
    expect(plan.compositeScrewCount).toBeGreaterThan(0)
    expect(plan.screwCount).toBe(plan.woodScrewCount + plan.compositeScrewCount)
    expect(plan.materials.find(item => item.id === 'deck-screws')?.quantity).toBe(Math.ceil(plan.woodScrewCount / 100))
    expect(plan.materials.find(item => item.id === 'composite-screws')?.quantity).toBe(Math.ceil(plan.compositeScrewCount / 100))
  })

  it('keeps quantities and prices the same across all composite preview colors', () => {
    const base = calculatePlan({ ...DEFAULT_CONFIG, compositeTreads: true })
    for (const color of COMPOSITE_COLORS) {
      const plan = calculatePlan({ ...DEFAULT_CONFIG, compositeTreads: true, compositeColor: color.id })
      expect(plan.total).toBe(base.total)
      expect(plan.geometry).toEqual(base.geometry)
      expect(plan.materials.map(item => [item.id, item.quantity])).toEqual(base.materials.map(item => [item.id, item.quantity]))
      expect(plan.materials.find(item => item.id.startsWith('composite-treads-'))?.name).toContain(color.name)
    }
  })

  it('adds decorative sides and return caps without changing the structural members', () => {
    const base = calculatePlan(DEFAULT_CONFIG)
    for (const sidePanel of ['lattice', 'solid'] as const) {
      const plan = calculatePlan({ ...DEFAULT_CONFIG, sidePanel, returnCaps: true })
      expect(plan.total).toBeGreaterThan(base.total)
      expect(plan.geometry.supportFlights).toEqual(base.geometry.supportFlights)
      expect(plan.materials.some(item => item.id.includes('side-panel'))).toBe(true)
      expect(plan.materials.some(item => item.id.includes('return'))).toBe(true)
    }
  })

  it('budgets planter boxes independently and updates riser quantities when toggled', () => {
    const planter = calculatePlan({ ...DEFAULT_CONFIG, ending: 'planter' })
    const open = calculatePlan({ ...DEFAULT_CONFIG, closedRisers: false })
    expect(planter.materials.find((item) => item.id === 'planter-kit')?.quantity).toBe(2)
    expect(open.materials.some((item) => item.id.includes('risers'))).toBe(false)
    expect(open.screwCount).toBeLessThan(calculatePlan(DEFAULT_CONFIG).screwCount)
    expect(open.checks.find((check) => check.id === 'open-risers')?.status).toBe('warn')
  })
})
