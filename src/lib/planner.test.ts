import { describe, expect, it } from 'vitest'
import { allocateStock, calculatePlan, cutsPerBoard, DEFAULT_CONFIG, SAW_KERF } from './planner'

describe('stair geometry and checks', () => {
  it('uses the porch as the final landing, with one fewer tread than rises', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, railing: true })
    expect(plan.geometry.treadCount).toBe(4)
    expect(plan.geometry.riserHeight).toBe(7.2)
    expect(plan.geometry.going).toBe(11)
    expect(plan.geometry.boardWidth).toBe(5.5)
    expect(plan.geometry.treadDepth).toBe(11.125)
    expect(plan.checks.filter((check) => check.status === 'warn')).toEqual([])
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
    const thinnerComposite = calculatePlan({ ...DEFAULT_CONFIG, rise: 14, risers: 12, material: 'composite' })
    expect(thinnerComposite.checks.some((check) => check.id === 'riser-thickness')).toBe(false)
  })

  it('flags height, width, going and handrail limitations separately', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, rise: 40, run: 36, width: 30, railing: false })
    for (const id of ['riser', 'going', 'width', 'rail', 'guard']) expect(plan.checks.find((check) => check.id === id)?.status).toBe('warn')
  })

  it('adds stringers for composite and never assumes fascia is a tread', () => {
    const wood = calculatePlan(DEFAULT_CONFIG)
    const composite = calculatePlan({ ...DEFAULT_CONFIG, material: 'composite', tread: 'one12' })
    expect(composite.geometry.stringerCount).toBeGreaterThan(wood.geometry.stringerCount)
    expect(composite.geometry.stringerSpacing).toBeLessThanOrEqual(9)
    expect(composite.geometry.boardsPerTread).toBe(2)
    expect(composite.geometry.boardGap).toBe(0.25)
    expect(composite.geometry.treadDepth).toBe(11.25)
    expect(composite.checks.find((check) => check.id === 'composite-wide')?.status).toBe('warn')
  })

  it('keeps malformed inputs and price overrides from contaminating totals', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, rise: NaN, run: Infinity, risers: 0, width: -2 }, { 'deck-screws': -100, 'stringer-connectors': NaN })
    expect(Number.isFinite(plan.total)).toBe(true)
    expect(plan.materials.every((item) => item.unitPrice >= 0 && Number.isFinite(item.total))).toBe(true)
    expect(plan.checks.find((check) => check.id === 'input')?.status).toBe('warn')
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
    expect(plan.checks.find((check) => check.id === 'span')?.status).toBe('info')
  })

  it('recalculates totals from edited prices and includes contingency exactly once', () => {
    const original = calculatePlan(DEFAULT_CONFIG)
    const item = original.materials.find((row) => row.id === 'support-restraint')!
    const edited = calculatePlan(DEFAULT_CONFIG, { [item.id]: 20 })
    expect(edited.subtotal).toBeCloseTo(original.subtotal + item.quantity * (20 - item.unitPrice), 2)
    expect(edited.total).toBeCloseTo(edited.subtotal + edited.contingency, 2)
    expect(edited.contingency).toBeCloseTo(edited.subtotal * 0.1, 2)
  })

  it('adds actual landing materials and foundation allowances for the turn', () => {
    const straight = calculatePlan(DEFAULT_CONFIG)
    const turn = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn' })
    expect(turn.total).toBeGreaterThan(straight.total)
    expect(turn.geometry.landingSize).toBe(DEFAULT_CONFIG.width)
    expect(turn.materials.some((item) => item.id.startsWith('landing-joists'))).toBe(true)
    expect(turn.materials.find((item) => item.id === 'landing-foundations')?.quantity).toBe(4)
    expect(turn.screwCount).toBeGreaterThan(straight.screwCount)
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
    const plan = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', width: 45, run: 33, material: 'composite' })
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
    const bearingRows = geometry.supportFlights.reduce((sum, flight) => sum + flight.rows.length, 0)
    expect(plan.materials.find((item) => item.id === 'support-restraint')?.quantity).toBe(bearingRows * geometry.stringerCount)
    expect(plan.cutList.find((item) => item.id.startsWith('stringers-lower-'))?.length).toBeCloseTo(Math.hypot(14, 11) + 12)
    expect(plan.cutList.find((item) => item.id.startsWith('stringers-upper-'))?.length).toBeCloseTo(Math.hypot(21, 22) + 12)
    expect(plan.checks.filter((check) => check.status === 'warn').map((check) => check.id)).toEqual(['span'])
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

  it('adds intermediate supports per flight and rejects a turn with no usable lower flight', () => {
    const supportedTurn = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', rise: 70, risers: 10, run: 88 })
    expect(supportedTurn.checks.find((check) => check.id === 'span')?.status).toBe('info')
    const longTurn = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', rise: 126, risers: 18, run: 176 })
    expect(longTurn.checks.find((check) => check.id === 'span')?.status).toBe('info')
    expect(longTurn.geometry.supportFlights.every((flight) => flight.rows.length === 2 && flight.maxUnsupportedSpan <= 72)).toBe(true)
    const tooFewRisers = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', risers: 2, rise: 28, run: 22 })
    expect(tooFewRisers.config.risers).toBe(4)
    expect(tooFewRisers.geometry.lowerRisers).toBe(2)
    expect(tooFewRisers.geometry.upperRisers).toBe(2)
    expect(tooFewRisers.checks.find((check) => check.id === 'input')?.status).toBe('warn')
  })

  it('budgets independent beams, posts and footings without hanging stairs from the porch', () => {
    const plan = calculatePlan(DEFAULT_CONFIG)
    const flight = plan.geometry.supportFlights[0]
    expect(DEFAULT_CONFIG.rise).toBe(36)
    expect(flight.flight).toBe('straight')
    expect(flight.baseElevation).toBe(0)
    expect(flight.rows).toHaveLength(1)
    expect(flight.unresolved).toBe(false)
    const row = flight.rows[0]
    expect(row.postPositions).toEqual([2.75, 48, 93.25])
    expect(row.postHeight).toBeCloseTo(row.beamTop - row.beamDepth)
    const cuts = (prefix: string) => plan.cutList.filter((item) => item.id.startsWith(prefix)).reduce((sum, item) => sum + item.quantity, 0)
    expect(cuts('support-beams-')).toBe(2)
    expect(cuts('support-posts-')).toBe(3)
    expect(cuts('support-brace-stock-')).toBe(4)
    for (const id of ['support-post-bases', 'support-post-caps', 'support-footings']) expect(plan.materials.find((item) => item.id === id)?.quantity).toBe(3)
    expect(plan.materials.some((item) => item.id === 'stringer-connectors')).toBe(false)
    expect(plan.materials.find((item) => item.id === 'support-restraint')?.quantity).toBe(plan.geometry.stringerCount)
    expect(plan.checks.find((check) => check.id === 'freestanding')?.detail).toContain('must be designed')
  })

  it('positions intermediate beam contact below the actual stringer profile', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, rise: 84, run: 121, risers: 12 })
    const flight = plan.geometry.supportFlights[0]
    expect(flight.rows).toHaveLength(2)
    expect(flight.maxUnsupportedSpan).toBeLessThanOrEqual(72)
    expect(flight.unresolved).toBe(false)
    const slope = plan.geometry.riserHeight / plan.geometry.going
    for (const row of flight.rows) {
      const underside = Math.max(0, flight.rise - plan.geometry.treadThickness - 11.25 * Math.sqrt(1 + slope ** 2) - (row.z + row.beamWidth / 2) * slope)
      expect(row.beamTop).toBeCloseTo(underside)
      expect(row.postHeight).toBeGreaterThanOrEqual(6)
      expect(row.z - row.beamWidth / 2).toBeGreaterThanOrEqual(0)
      expect(row.z + row.beamWidth / 2).toBeLessThan(flight.run)
    }
  })

  it('extends upper-turn posts to ground while keeping landing supports separate', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', rise: 70, risers: 10, run: 88 })
    const upper = plan.geometry.supportFlights.find((flight) => flight.flight === 'upper')!
    expect(upper.baseElevation).toBe(35)
    expect(upper.rows.length).toBeGreaterThan(0)
    for (const row of upper.rows) {
      expect(row.postHeight).toBeCloseTo(upper.baseElevation + row.beamTop - row.beamDepth)
      expect(row.postHeight).toBeGreaterThan(row.beamTop)
    }
    expect(plan.materials.find((item) => item.id === 'landing-foundations')?.quantity).toBe(4)
    const supportPosts = plan.geometry.supportFlights.reduce((sum, flight) => sum + flight.rows.reduce((count, row) => count + row.postPositions.length, 0), 0)
    expect(plan.materials.find((item) => item.id === 'support-footings')?.quantity).toBe(supportPosts)
  })

  it('keeps narrow support posts inside the beam and flags low-profile layouts honestly', () => {
    const narrow = calculatePlan({ ...DEFAULT_CONFIG, width: 36 })
    expect(narrow.geometry.supportFlights[0].rows[0].postPositions).toEqual([2.75, 33.25])
    const low = calculatePlan({ ...DEFAULT_CONFIG, rise: 14, run: 144, risers: 3 })
    expect(low.geometry.supportFlights[0].rows).toEqual([])
    expect(low.geometry.supportFlights[0].unresolved).toBe(true)
    expect(low.checks.find((check) => check.id === 'span')?.status).toBe('warn')
    expect(low.materials.find((item) => item.id === 'unresolved-support')?.quantity).toBe(1)
    expect(low.cutList.some((item) => item.id.startsWith('support-posts-'))).toBe(false)
    expect(low.materials.every((item) => Number.isFinite(item.total) && item.quantity > 0)).toBe(true)
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
