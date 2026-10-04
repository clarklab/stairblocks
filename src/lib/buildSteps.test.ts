import { describe, expect, it } from 'vitest'
import { getBuildParts, getBuildSteps } from './buildSteps'
import { calculatePlan, DEFAULT_CONFIG } from './planner'
import type { StairConfig } from './planner'

describe('assembly instructions and shopping-list agreement', () => {
  const examples: Partial<StairConfig>[] = [
    {}, { ending: 'turn', rise: 70, run: 88, risers: 10 },
    { material: 'cedar', compositeTreads: true, closedRisers: false }, { tread: 'one12', width: 48 },
  ]
  for (const example of examples) {
    it(`shows the purchased cut quantities for ${JSON.stringify(example)}`, () => {
      const plan = calculatePlan({ ...DEFAULT_CONFIG, ...example })
      const cuts = (prefix: string) => plan.cutList.filter(part => part.id.startsWith(prefix)).reduce((sum, part) => sum + part.quantity, 0)
      expect(getBuildParts(plan, 'stringers')[0].count).toBe(cuts('stringers'))
      expect(getBuildParts(plan, 'treads')[0].count).toBe(cuts(`${plan.config.compositeTreads ? 'composite' : plan.config.material}-treads-`))
      expect(getBuildParts(plan, 'blocking')[0].count).toBe(cuts('blocking-'))
      const steps = getBuildSteps(plan)
      expect(steps.some(step => step.id === 'risers')).toBe(plan.config.closedRisers)
      if (plan.config.closedRisers) expect(getBuildParts(plan, 'risers')[0].count).toBe(cuts(`${plan.config.material}-risers-`))
    })
  }

  it('includes turn-landing drops and runners in the portable-frame parts tray', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', rise: 70, risers: 10, run: 88 })
    const parts = getBuildParts(plan, 'supports')
    const cuts = (...prefixes: string[]) => plan.cutList.filter(part => prefixes.some(prefix => part.id.startsWith(prefix))).reduce((sum, part) => sum + part.quantity, 0)
    expect(cuts('landing-drops-')).toBeGreaterThan(0)
    expect(cuts('landing-runners-')).toBeGreaterThan(0)
    expect(parts.find(part => part.label === '2 × 4 vertical drops')?.count).toBe(cuts('portable-drops-', 'landing-drops-'))
    expect(parts.find(part => part.label === '2 × 4 bottom runners')?.count).toBe(cuts('portable-runners-', 'landing-runners-'))
    expect(parts.find(part => part.label === 'landing frame members')?.count).toBe(cuts('landing-frame-'))
    expect(getBuildSteps(plan).find(step => step.id === 'stringers')?.subtitle).toContain('each flight')
  })

  it('keeps cedar riser instructions and separate wood screws when composite walking boards are selected', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, material: 'cedar', compositeTreads: true, closedRisers: true })
    const risers = getBuildSteps(plan).find(step => step.id === 'risers')!
    expect(risers.subtitle).toContain('cedar')
    expect(risers.note).toContain('risers remain wood')
    expect(getBuildParts(plan, 'treads')[0].label).toBe('composite tread boards')
    const screws = getBuildParts(plan, 'fasteners')
    expect(screws.find(part => part.label === 'wood screws incl. spares')?.count).toBeGreaterThan(0)
    expect(screws.find(part => part.label === 'composite screws incl. spares')?.count).toBeGreaterThan(0)
    expect(screws.reduce((total, part) => total + part.count, 0)).toBe(plan.screwCount)
  })

  it('introduces the portable L frame without instructions to excavate or anchor to concrete', () => {
    const plan = calculatePlan(DEFAULT_CONFIG)
    const steps = getBuildSteps(plan)
    const tasks = steps.flatMap(step => step.tasks).join(' ')
    expect(steps.find(step => step.id === 'supports')?.subtitle).toContain('Rear drops')
    expect(tasks).not.toMatch(/excavat|footing|base anchor|beam\/post|concrete anchor/i)
    expect(steps.find(step => step.id === 'site')?.note).toContain('sliding or racking')
    expect(steps.find(step => step.id === 'supports')?.note).toContain('fasteners as each joint')
  })

  it.each(['lattice', 'solid'] as const)('treats %s side panels as finishing, not structural bracing', sidePanel => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, sidePanel, ending: 'planter' })
    const finish = getBuildSteps(plan).find(step => step.id === 'complete')!
    const task = finish.tasks.find(task => task.includes('side panels'))!
    expect(task).toContain('drainage and inspection access')
    expect(task).toContain('do not replace structural bracing')
    expect(getBuildParts(plan, 'complete').some(part => part.label === 'planter end caps')).toBe(true)
  })

  it('distinguishes decorative trim returns from a turning stair or walking platform', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, ending: 'open', returnCaps: true })
    const finish = getBuildSteps(plan).find(step => step.id === 'complete')!
    expect(finish.metric).toContain('Straight run')
    expect(finish.tasks.find(task => task.includes('trim returns'))).toContain('add no walking surface, support, or porch connection')
  })

  it.each(['lattice', 'solid'] as const)('matches finishing quantities to the %s takeoff across both flights', sidePanel => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', rise: 70, risers: 10, run: 88, sidePanel, returnCaps: true })
    const parts = getBuildParts(plan, 'complete')
    const cuts = (prefix: string) => plan.cutList.filter(part => part.id.startsWith(prefix)).reduce((sum, part) => sum + part.quantity, 0)
    const count = (label: string) => parts.find(part => part.label === label)?.count
    expect(count('sloped edge caps')).toBe(4)
    expect(count('90° trim returns')).toBe(4)
    expect(count('panel edge battens')).toBe(cuts('side-panel-battens-'))
    if (sidePanel === 'solid') {
      expect(count('wood side-cladding pieces')).toBe(cuts('side-panel-solid-'))
      expect(count('4 × 8 lattice stock panels')).toBeUndefined()
    } else {
      expect(count('4 × 8 lattice stock panels')).toBe(plan.materials.filter(part => part.id.startsWith('side-panel-lattice-')).reduce((total, part) => total + part.quantity, 0))
      expect(count('wood side-cladding pieces')).toBeUndefined()
    }
  })
})
