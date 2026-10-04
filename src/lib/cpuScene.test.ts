import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CpuStairScene from '../components/CpuStairScene'
import { DEFAULT_CONFIG, MAX_STAIR_WIDTH } from './planner'

describe('software 3D rendering without a browser graphics context', () => {
  const base = { config: DEFAULT_CONFIG, dimensions: true, resetKey: 0, cameraView: 'perspective' as const }
  for (const view of ['finished', 'framing', 'exploded', 'fasteners'] as const) {
    it(`renders ${view} geometry as SVG with no canvas or DOM runtime`, () => {
      const markup = renderToStaticMarkup(createElement(CpuStairScene, { ...base, view }))
      expect(markup).toContain('data-renderer="cpu-svg"')
      expect(markup.match(/<polygon /g)!.length).toBeGreaterThan(20)
      expect(markup).not.toContain('<canvas')
      expect(markup).not.toMatch(/(?:NaN|Infinity)/)
    })
  }

  it('reveals only the selected and earlier assembly groups', () => {
    const count = (buildStage: 'site' | 'supports' | 'stringers' | 'treads' | 'complete') => {
      const markup = renderToStaticMarkup(createElement(CpuStairScene, { ...base, dimensions: false, view: 'finished', buildStage }))
      return markup.match(/<polygon /g)?.length ?? 0
    }
    expect(count('site')).toBeGreaterThan(0)
    expect(count('supports')).toBeGreaterThan(count('site'))
    expect(count('stringers')).toBeGreaterThan(count('supports'))
    expect(count('complete')).toBeGreaterThan(count('treads'))
  })

  it('handles a turn and impossible short rises without invalid SVG coordinates', () => {
    for (const config of [
      { ...DEFAULT_CONFIG, ending: 'turn' as const, material: 'composite' as const, risers: 10, rise: 70, run: 88 },
      { ...DEFAULT_CONFIG, rise: 14, risers: 12 },
    ]) {
      const markup = renderToStaticMarkup(createElement(CpuStairScene, { ...base, config, view: 'exploded' }))
      expect(markup).toContain('data-renderer="cpu-svg"')
      expect(markup).not.toMatch(/(?:NaN|Infinity)/)
    }
  })

  it('keeps correct polygon ordering at maximum width, rise, run and stair count', () => {
    const config = { ...DEFAULT_CONFIG, width: MAX_STAIR_WIDTH, rise: 84, run: 144, risers: 12, material: 'composite' as const, ending: 'turn' as const, railing: true }
    for (const view of ['finished', 'framing', 'exploded', 'fasteners'] as const) {
      const markup = renderToStaticMarkup(createElement(CpuStairScene, { ...base, config, view }))
      expect(markup).toContain(`${MAX_STAIR_WIDTH}″ wide`)
      expect(markup).toContain('data-painter-fallback-polygons="0"')
      expect(markup).not.toMatch(/(?:NaN|Infinity)/)
    }
  })
})
