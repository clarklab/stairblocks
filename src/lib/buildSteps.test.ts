import { describe, expect, it } from 'vitest'
import { getBuildParts, getBuildSteps } from './buildSteps'
import { calculatePlan, DEFAULT_CONFIG } from './planner'
import type { StairConfig } from './planner'

describe('assembly instructions and shopping-list agreement', () => {
  const examples: Partial<StairConfig>[] = [
    {}, { ending: 'turn', rise: 70, run: 88, risers: 10 },
    { material: 'composite', closedRisers: false }, { tread: 'one12', width: 48 },
  ]
  for (const example of examples) {
    it(`shows the purchased cut quantities for ${JSON.stringify(example)}`, () => {
      const plan = calculatePlan({ ...DEFAULT_CONFIG, ...example })
      const cuts = (prefix: string) => plan.cutList.filter(part => part.id.startsWith(prefix)).reduce((sum, part) => sum + part.quantity, 0)
      expect(getBuildParts(plan, 'stringers')[0].count).toBe(cuts('stringers'))
      expect(getBuildParts(plan, 'treads')[0].count).toBe(cuts(`${plan.config.material}-treads-`))
      expect(getBuildParts(plan, 'blocking')[0].count).toBe(cuts('blocking-'))
      const steps = getBuildSteps(plan)
      expect(steps.some(step => step.id === 'risers')).toBe(plan.config.closedRisers)
      if (plan.config.closedRisers) expect(getBuildParts(plan, 'risers')[0].count).toBe(cuts(`${plan.config.material}-risers-`))
    })
  }

  it('distinguishes stair posts from the separate landing kit on a turn', () => {
    const plan = calculatePlan({ ...DEFAULT_CONFIG, ending: 'turn', rise: 70, risers: 10, run: 88 })
    const parts = getBuildParts(plan, 'supports')
    const posts = plan.cutList.filter(part => part.id.startsWith('support-posts-')).reduce((sum, part) => sum + part.quantity, 0)
    expect(parts.find(part => part.label === 'stair support posts')?.count).toBe(posts)
    expect(parts.find(part => part.label === 'landing frame kit')?.count).toBe(1)
    expect(getBuildSteps(plan).find(step => step.id === 'stringers')?.subtitle).toContain('each flight')
  })
})
