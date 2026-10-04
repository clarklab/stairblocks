import { describe, expect, it } from 'vitest'
import { calculatePlan, COMPOSITE_COLORS, DEFAULT_CONFIG } from './planner'
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
    for (const config of [
      { ...DEFAULT_CONFIG, rise: 14, risers: 12 },
      { ...DEFAULT_CONFIG, rise: 14, risers: 4, compositeTreads: true },
    ]) {
      const model = buildStairGeometry(config)
      expect(model.pieces.length).toBeGreaterThan(0)
      expect(model.pieces.every((piece) => piece.stage === 'site' && piece.category === 'concrete')).toBe(true)
      expect(model.labels.some((label) => label.text.includes('fewer rises') && label.showIn?.includes('finished'))).toBe(true)
    }
  })

  it('matches portable frame members and keeps turn runners on the ground without footings', () => {
    const config = { ...DEFAULT_CONFIG, ending: 'turn' as const, rise: 70, risers: 10, run: 88 }
    const plan = calculatePlan(config)
    const model = buildStairGeometry(config)
    const members = [...plan.geometry.supportFlights.flatMap((flight) => flight.members), ...(plan.geometry.portableLanding?.members ?? [])]
    const portable = model.pieces.filter((piece) => piece.id.startsWith('portable-'))
    expect(portable).toHaveLength(members.length)
    const pricedMembers = plan.cutList.filter((item) => /^(portable-(drops|runners|crossrails|braces)|landing-(drops|runners|frame))-/.test(item.id)).reduce((count, item) => count + item.quantity, 0)
    expect(portable).toHaveLength(pricedMembers)
    expect(portable.filter((piece) => piece.id.includes('runner'))).toHaveLength(members.filter((member) => member.kind === 'runner').length)
    for (const runner of portable.filter((piece) => piece.id.includes('runner'))) {
      expect(Math.min(...runner.faces.flatMap((face) => face.vertices.map((point) => point[1])))).toBeCloseTo(0)
      expect(Math.max(...runner.faces.flatMap((face) => face.vertices.map((point) => point[1])))).toBeCloseTo(3.5 / 12)
      expect(Math.hypot(...runner.explodedOffset)).toBeGreaterThan(0)
    }
    expect(model.pieces.filter((piece) => piece.category === 'concrete')).toHaveLength(2)
    expect(model.pieces.some((piece) => /footing|foundation|post-base|bearing-beam/.test(piece.id))).toBe(false)
    expect(model.pieces.filter((piece) => piece.category === 'concrete').every((piece) => piece.explodedOffset.every((value) => value === 0))).toBe(true)
  })

  it('colors only tread and landing surfaces when composite color changes', () => {
    const config = { ...DEFAULT_CONFIG, ending: 'turn' as const, material: 'cedar' as const, compositeTreads: true, sidePanel: 'solid' as const, returnCaps: true, railing: true }
    const reference = buildStairGeometry(config)
    const woodColors = reference.pieces.filter((piece) => piece.category !== 'tread').map((piece) => piece.faces.map((face) => face.color))
    for (const color of COMPOSITE_COLORS) {
      const model = buildStairGeometry({ ...config, compositeColor: color.id })
      expect(model.pieces.filter((piece) => piece.category === 'tread').every((piece) => piece.faces.every((face) => face.color === color.hex))).toBe(true)
      expect(model.pieces.filter((piece) => piece.category !== 'tread').map((piece) => piece.faces.map((face) => face.color))).toEqual(woodColors)
    }
    const wooden = buildStairGeometry({ ...config, compositeTreads: false })
    expect(wooden.pieces.find((piece) => piece.category === 'tread')!.faces[0].color).toBe(wooden.pieces.find((piece) => piece.category === 'riser')!.faces[0].color)
  })

  it('adds removable wood side panels and right-angle return caps only at the finish stage', () => {
    for (const sidePanel of ['lattice', 'solid'] as const) {
      const config = { ...DEFAULT_CONFIG, sidePanel, returnCaps: true }
      const plan = calculatePlan(config)
      const model = buildStairGeometry(config)
      const panels = model.pieces.filter((piece) => piece.id.startsWith(sidePanel === 'lattice' ? 'wood-side-lattice' : 'wood-side-cladding'))
      expect(panels.length).toBeGreaterThan(1)
      expect(panels.every((piece) => piece.stage === 'complete' && piece.category === 'skirt' && Math.abs(piece.explodedOffset[0]) > 0)).toBe(true)
      for (const panel of panels) for (const face of panel.faces) {
        const [a, b, c] = face.vertices
        const u = b.map((value, index) => value - a[index])
        const v = c.map((value, index) => value - a[index])
        expect(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])).toBeGreaterThan(0.0000001)
      }
      expect(model.pieces.filter((piece) => piece.id.startsWith('wood-return-cap-long'))).toHaveLength(plan.geometry.supportFlights.length * 2)
      expect(model.pieces.filter((piece) => piece.id.startsWith('wood-return-cap-toe'))).toHaveLength(plan.geometry.supportFlights.length * 2)
      expect(model.pieces.every((piece) => piece.faces.every((face) => face.vertices.every((point) => point.every(Number.isFinite))))).toBe(true)
    }
  })

  it('bounds the default surface count and includes each construction stage', () => {
    const model = buildStairGeometry(DEFAULT_CONFIG)
    expect(model.pieces.reduce((count, piece) => count + piece.faces.length, 0)).toBeLessThan(2000)
    for (const stage of ['site', 'supports', 'stringers', 'blocking', 'risers', 'treads', 'fasteners']) expect(model.pieces.some((piece) => piece.stage === stage)).toBe(true)
  })
})
