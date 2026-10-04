import { describe, expect, it } from 'vitest'
import { calculatePlan, DEFAULT_CONFIG, type StairConfig } from './planner'
import { getLayoutLimits, getLayoutRunStops, solveLayout } from './layout'

const dimensionsPass = (config: StairConfig) => {
  const plan = calculatePlan(config)
  const dimensional = ['riser', 'going', 'coverage', 'nosing', 'throat', 'riser-thickness', 'portable-clearance']
  const warnings = plan.checks.filter(check => dimensional.includes(check.id) && check.status === 'warn')
  expect(warnings, JSON.stringify({ config, warnings })).toEqual([])
  expect(plan.geometry.riserHeight - plan.geometry.treadThickness).toBeGreaterThanOrEqual(3.5)
  expect(config.run).toBeGreaterThanOrEqual(20)
  expect(config.run).toBeLessThanOrEqual(144)
}

describe('coupled stair dimensions', () => {
  it('changes counts for a longer run without changing the porch height or opening tread gaps', () => {
    const fifty = solveLayout(DEFAULT_CONFIG, { run: 50 }, 'run')
    const sixty = solveLayout(DEFAULT_CONFIG, { run: 60 }, 'run')
    const tooLong = solveLayout(DEFAULT_CONFIG, { run: 96 }, 'run')
    expect(fifty.config).toMatchObject({ rise: 36, run: 50, risers: 6 })
    expect(sixty.config).toMatchObject({ rise: 36, run: 60, risers: 7 })
    expect(tooLong.config).toMatchObject({ rise: 36, run: 66.75, risers: 7 })
    expect(tooLong.message).toContain('Requested 96″ run → 66.75″')
    for (const solved of [fifty, sixty, tooLong]) {
      expect(solved.status).toBe('fit')
      dimensionsPass(solved.config)
    }
  })

  it('keeps the current count when floating-point arithmetic gives equal run fits', () => {
    const config = { ...DEFAULT_CONFIG, rise: 60, run: 110, risers: 12 }
    const result = solveLayout(config, { run: 111 }, 'run')
    expect(result.config.risers).toBe(12)
    expect(result.config.run).toBeCloseTo(111, 10)
    dimensionsPass(result.config)
  })

  it('snaps away from the forbidden closed-riser nosing gap', () => {
    const result = solveLayout(DEFAULT_CONFIG, { run: 42 }, 'run')
    expect(result.config.run).toBe(41.5)
    expect(result.config.risers).toBe(5)
    expect(result.message).toContain('Requested 42″ run → 41.5″')
    dimensionsPass(result.config)
  })

  it('recalculates height changes around a comfortable rise count and preserves valid going', () => {
    expect(solveLayout(DEFAULT_CONFIG, { rise: 42 }, 'rise').config).toMatchObject({ rise: 42, risers: 6, run: 55 })
    expect(solveLayout(DEFAULT_CONFIG, { rise: 72 }, 'rise').config).toMatchObject({ rise: 72, risers: 10, run: 99 })
    const shorterGoing = { ...DEFAULT_CONFIG, run: 40 }
    expect(solveLayout(shorterGoing, { rise: 42 }, 'rise').config.run).toBe(50)
    const invalidGoing = { ...DEFAULT_CONFIG, run: 42 }
    expect(solveLayout(invalidGoing, { rise: 42 }, 'rise').config.run).toBe(55)
  })

  it('clamps manual counts to physical clearance and maximum rise limits', () => {
    const tooMany = solveLayout(DEFAULT_CONFIG, { risers: 12 }, 'risers')
    const tooFew = solveLayout(DEFAULT_CONFIG, { risers: 3 }, 'risers')
    expect(tooMany.config).toMatchObject({ rise: 36, risers: 7, run: 66 })
    expect(tooMany.message).toContain('Requested 12 rises → 7')
    expect(tooFew.config).toMatchObject({ rise: 36, risers: 5, run: 44 })
    const high = solveLayout({ ...DEFAULT_CONFIG, rise: 84 }, { risers: 11 }, 'risers')
    expect(high.config.risers).toBe(11)
    expect(high.config.run).toBe(103.75)
    dimensionsPass(high.config)
  })

  it('treats both wood profiles and composite as real fixed board depths', () => {
    for (const material of ['treated', 'cedar'] as const) {
      const wide = solveLayout({ ...DEFAULT_CONFIG, material, tread: 'one12' }, { run: 96 }, 'run')
      expect(wide.config.run).toBe(67.5)
      expect(wide.config.risers).toBe(7)
      dimensionsPass(wide.config)
    }
    const composite = solveLayout({ ...DEFAULT_CONFIG, compositeTreads: true }, { run: 96 }, 'run')
    expect(composite.config).toMatchObject({ rise: 36, risers: 8, run: 78.75 })
    dimensionsPass(composite.config)
  })

  it('reflows surface changes while preserving wood choice, stored profile and height', () => {
    const wood = { ...DEFAULT_CONFIG, material: 'cedar' as const, tread: 'one12' as const }
    const composite = solveLayout(wood, { compositeTreads: true, run: 77 }, 'profile')
    expect(composite.config).toMatchObject({ material: 'cedar', tread: 'one12', compositeTreads: true, rise: 36, run: 77, risers: 8 })
    const restored = solveLayout(composite.config, { compositeTreads: false }, 'profile')
    expect(restored.config).toMatchObject({ material: 'cedar', tread: 'one12', compositeTreads: false, rise: 36, run: 67.5, risers: 7 })
    dimensionsPass(restored.config)
  })

  it('preserves going on a turn change and still uses combined flight run excluding landing', () => {
    const turning = solveLayout(DEFAULT_CONFIG, { ending: 'turn' }, 'ending')
    expect(turning.config).toMatchObject({ rise: 36, risers: 5, run: 33, ending: 'turn' })
    const back = solveLayout(turning.config, { ending: 'open' }, 'ending')
    expect(back.config).toMatchObject({ rise: 36, risers: 5, run: 44 })
    const longer = solveLayout(turning.config, { run: 50 }, 'run')
    expect(longer.config).toMatchObject({ rise: 36, risers: 7, run: 50 })
    dimensionsPass(longer.config)
    // Structural support warnings do not mislabel the dimension solver as unavailable.
    expect(turning.status).toBe('fit')
    expect(calculatePlan(turning.config).checks.some(check => check.id === 'landing-support' && check.status === 'warn')).toBe(true)
  })

  it('returns an honest unavailable preview without increasing a low measured porch', () => {
    const low = solveLayout(DEFAULT_CONFIG, { rise: 14 }, 'rise')
    expect(low.status).toBe('unavailable')
    expect(low.config.rise).toBe(14)
    expect(low.message).toContain('No layout fits 14″')
    expect(getLayoutLimits(low.config).feasible).toBe(false)
    expect(getLayoutRunStops(low.config)).toEqual([])
    const lowTurn = solveLayout({ ...DEFAULT_CONFIG, ending: 'turn' }, { rise: 18 }, 'rise')
    expect(lowTurn.status).toBe('unavailable')
    expect(lowTurn.config.rise).toBe(18)
    const lowComposite = solveLayout({ ...DEFAULT_CONFIG, compositeTreads: true }, { rise: 14 }, 'rise')
    expect(lowComposite.status).toBe('fit')
    expect(lowComposite.config.rise).toBe(14)
    dimensionsPass(lowComposite.config)
  })

  it('keeps nonfinite edits out of geometry and makes their failure explicit', () => {
    for (const key of ['rise', 'run', 'risers', 'width'] as const) for (const value of [NaN, Infinity, -Infinity]) {
      const result = solveLayout(DEFAULT_CONFIG, { [key]: value }, key === 'width' ? 'profile' : key)
      expect(result.status).toBe('unavailable')
      expect(Object.values(result.config).filter(value => typeof value === 'number').every(Number.isFinite)).toBe(true)
      expect(result.config.rise).toBe(36)
      expect(result.message).toContain('finite')
    }
    const malformed = { ...DEFAULT_CONFIG, rise: NaN, run: Infinity, risers: NaN }
    expect(solveLayout(malformed, {}, 'suggest').config.rise).toBe(DEFAULT_CONFIG.rise)
    expect(getLayoutLimits(malformed).feasible).toBe(false)
  })

  it('suggests a comfortable plan without mutating the source config', () => {
    const source = { ...DEFAULT_CONFIG, rise: 72, run: 30, risers: 12 }
    const result = solveLayout(source, {}, 'suggest')
    expect(result.config).toMatchObject({ rise: 72, run: 99, risers: 10 })
    expect(source).toMatchObject({ rise: 72, run: 30, risers: 12 })
  })

  it('provides ordered keyboard slider stops across gaps and preserves every stop when solved', () => {
    const stops = getLayoutRunStops(DEFAULT_CONFIG)
    expect(getLayoutLimits(DEFAULT_CONFIG)).toEqual({ feasible: true, minRun: 40, maxRun: 66.75, minRisers: 5, maxRisers: 7 })
    expect(stops[0]).toBe(40)
    expect(stops.at(-1)).toBe(66.75)
    expect(stops).toContain(41.5)
    expect(stops).toContain(44)
    expect(stops).not.toContain(42)
    expect(stops.indexOf(44)).toBe(stops.indexOf(41.5) + 1)
    for (const [index, run] of stops.entries()) {
      if (index) expect(run).toBeGreaterThan(stops[index - 1])
      const result = solveLayout(DEFAULT_CONFIG, { run }, 'run')
      expect(result.status).toBe('fit')
      expect(result.config.run).toBeCloseTo(run, 8)
      dimensionsPass(result.config)
    }
  })

  it('screens feasible layouts across heights, profiles, open risers and turns using planner checks', () => {
    for (const rise of [14, 15, 18, 20, 24, 30, 36, 38.75, 42, 54, 60, 72, 84]) {
      for (const profile of [{ tread: 'two6' as const, compositeTreads: false }, { tread: 'one12' as const, compositeTreads: false }, { tread: 'two6' as const, compositeTreads: true }]) {
        for (const ending of ['open', 'turn'] as const) for (const closedRisers of [false, true]) {
          const source = { ...DEFAULT_CONFIG, rise, ...profile, ending, closedRisers }
          for (const run of [20, 42, 50, 60, 96, 144]) {
            const result = solveLayout(source, { run }, 'run')
            expect(result.config.rise).toBe(rise)
            if (result.status === 'fit') dimensionsPass(result.config)
          }
          const stops = getLayoutRunStops(source)
          for (const run of [stops[0], stops.at(-1)]) if (run !== undefined) {
            const result = solveLayout(source, { run }, 'run')
            expect(result.status).toBe('fit')
            expect(result.config.run).toBeCloseTo(run, 8)
            dimensionsPass(result.config)
          }
        }
      }
    }
  })
})
