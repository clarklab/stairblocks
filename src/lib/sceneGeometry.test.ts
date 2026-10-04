import { describe, expect, it } from 'vitest'
import { calculatePlan, DEFAULT_CONFIG } from './planner'
import { buildStairGeometry } from './sceneGeometry'
import type { Vec3 } from './sceneGeometry'

describe('CPU stair geometry', () => {
  it('builds the priced quantities for straight and turning stairs without a DOM', () => {
    for (const ending of ['open', 'turn'] as const) {
      const config = { ...DEFAULT_CONFIG, ending, run: ending === 'turn' ? 33 : 44 }
      const plan = calculatePlan(config)
      const model = buildStairGeometry(config)
      expect(model.pieces.filter((piece) => piece.category === 'stringer')).toHaveLength(plan.geometry.totalStringerCount)
      expect(model.pieces.filter((piece) => piece.category === 'riser')).toHaveLength(config.risers)
      expect(model.pieces.filter((piece) => piece.category === 'tread')).toHaveLength(plan.geometry.treadCount * plan.geometry.boardsPerTread + plan.geometry.landingDeckBoards)
      expect(model.pieces.every((piece) => piece.faces.every((face) => face.vertices.every((point) => point.every(Number.isFinite))))).toBe(true)
      expect(model.bounds.max[1]).toBeCloseTo(config.rise / 12)
    }
  })

  it('uses convex per-step stringer faces for the BSP painter', () => {
    const model = buildStairGeometry(DEFAULT_CONFIG)
    for (const stringer of model.pieces.filter((piece) => piece.category === 'stringer')) {
      expect(stringer.faces.some((face) => face.vertices.length === 3)).toBe(true)
      expect(stringer.faces.every((face) => face.vertices.length <= 4)).toBe(true)
    }
    const plank = model.pieces.find((piece) => piece.id.startsWith('tread-plank'))!
    for (const face of plank.faces) {
      const [a, b, c] = face.vertices
      const u = b.map((value, index) => value - a[index]) as Vec3
      const v = c.map((value, index) => value - a[index]) as Vec3
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      expect(normal.reduce((sum, value, index) => sum + value * (a[index] - plank.center[index]), 0)).toBeGreaterThan(0)
    }
  })

  it('retains the existing site and a corrective label for impossible thin rises', () => {
    const model = buildStairGeometry({ ...DEFAULT_CONFIG, rise: 14, risers: 12 })
    expect(model.pieces.length).toBeGreaterThan(0)
    expect(model.pieces.every((piece) => piece.stage === 'site' && piece.category === 'concrete')).toBe(true)
    expect(model.labels.some((label) => label.text.includes('fewer rises') && label.showIn?.includes('finished'))).toBe(true)
  })

  it('keeps world-ground support posts beneath both turn flights and separates exploded parts', () => {
    const config = { ...DEFAULT_CONFIG, ending: 'turn' as const, rise: 70, risers: 10, run: 88 }
    const plan = calculatePlan(config)
    const model = buildStairGeometry(config)
    const posts = model.pieces.filter((piece) => piece.id.startsWith('independent-support-post'))
    const quantity = plan.geometry.supportFlights.reduce((sum, flight) => sum + flight.rows.reduce((count, row) => count + row.postPositions.length, 0), 0)
    expect(posts).toHaveLength(quantity)
    for (const post of posts) {
      expect(Math.min(...post.faces.flatMap((face) => face.vertices.map((point) => point[1])))).toBeCloseTo(1.25 / 12)
      expect(Math.hypot(...post.explodedOffset)).toBeGreaterThan(0)
    }
    expect(model.pieces.filter((piece) => piece.category === 'concrete').every((piece) => piece.explodedOffset.every((value) => value === 0))).toBe(true)
  })

  it('bounds the default surface count and includes each construction stage', () => {
    const model = buildStairGeometry(DEFAULT_CONFIG)
    expect(model.pieces.reduce((count, piece) => count + piece.faces.length, 0)).toBeLessThan(2000)
    for (const stage of ['site', 'supports', 'stringers', 'blocking', 'risers', 'treads', 'fasteners']) expect(model.pieces.some((piece) => piece.stage === stage)).toBe(true)
  })
})
