import { calculatePlan } from './planner'
import type { StairConfig, SupportFlight } from './planner'

/** Render geometry is in world feet; the planning engine remains in inches. */
export type Vec3 = [number, number, number]
export type SceneStage = 'site' | 'supports' | 'stringers' | 'blocking' | 'risers' | 'treads' | 'fasteners' | 'complete'
export type SceneCategory = 'concrete' | 'support' | 'stringer' | 'blocking' | 'riser' | 'tread' | 'hardware' | 'rail' | 'planter'
export type SceneView = 'finished' | 'framing' | 'fasteners' | 'exploded'
export interface SceneFace { vertices: Vec3[]; color: string; doubleSided?: boolean }
export interface ScenePiece {
  id: string
  stage: SceneStage
  category: SceneCategory
  faces: SceneFace[]
  center: Vec3
  explodedOffset: Vec3
  assemblyOffset: Vec3
}
export interface SceneDimension { from: Vec3; to: Vec3; label: string }
export interface SceneLabel {
  position: Vec3
  text: string
  category?: SceneCategory
  kind?: 'dimension' | 'part' | 'note'
  showIn?: SceneView[]
}
export interface StairSceneGeometry {
  pieces: ScenePiece[]
  dimensions: SceneDimension[]
  labels: SceneLabel[]
  bounds: { min: Vec3; max: Vec3 }
}

type Transform = { origin: Vec3; angle: number }
const IDENTITY: Transform = { origin: [0, 0, 0], angle: 0 }
const ZERO: Vec3 = [0, 0, 0]
const FT = 1 / 12
const COLORS = {
  frame: '#c8b68c', treated: '#d5c39c', cedar: '#c99671', composite: '#a3a18f',
  blocking: '#b9bd99', metal: '#929c90', screw: '#5a6256', concrete: '#cbcec2', cap: '#d9dbd0',
}
const boxFaces = [[4, 5, 6, 7], [1, 0, 3, 2], [0, 4, 7, 3], [5, 1, 2, 6], [0, 1, 5, 4], [3, 7, 6, 2]]
const sum = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.max(1e-9, Math.hypot(...a)))
const rotate = ([x, y, z]: Vec3, angle: number): Vec3 => [x * Math.cos(angle) + z * Math.sin(angle), y, -x * Math.sin(angle) + z * Math.cos(angle)]
const world = (point: Vec3, transform: Transform): Vec3 => scale(sum(rotate(point, transform.angle), transform.origin), FT)
const direction = (point: Vec3, transform: Transform): Vec3 => scale(rotate(point, transform.angle), FT)
const numberLabel = (number: number) => String(Number(number.toFixed(1)))

/** Pure, DOM-free CPU geometry. Winding is outward CCW for SVG back-face culling. */
export function buildStairGeometry(input: StairConfig): StairSceneGeometry {
  const plan = calculatePlan(input)
  const config = plan.config
  const g = plan.geometry
  const pieces: ScenePiece[] = []
  const dimensions: SceneDimension[] = []
  const labels: SceneLabel[] = []
  const finish = COLORS[config.material]
  const width = config.width
  let serial = 0

  function piece(id: string, stage: SceneStage, category: SceneCategory, faces: SceneFace[], transform: Transform, exploded: Vec3 = ZERO, assembly: Vec3 = [0, 12, 0]) {
    if (!faces.length) return
    const transformed = faces.map((face) => ({ ...face, vertices: face.vertices.map((vertex) => world(vertex, transform)) }))
    const vertices = transformed.flatMap((face) => face.vertices)
    const center = scale(vertices.reduce((accumulator, vertex) => sum(accumulator, vertex), [0, 0, 0] as Vec3), 1 / vertices.length)
    pieces.push({ id: `${id}-${serial++}`, stage, category, faces: transformed, center, explodedOffset: direction(exploded, transform), assemblyOffset: direction(assembly, transform) })
  }

  function box(id: string, stage: SceneStage, category: SceneCategory, center: Vec3, size: Vec3, color: string, transform: Transform = IDENTITY, exploded: Vec3 = ZERO, assembly?: Vec3) {
    if (size.some((value) => value < 0.001 || !Number.isFinite(value))) return
    const [x, y, z] = size.map((value) => value / 2)
    const points: Vec3[] = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]
    piece(id, stage, category, boxFaces.map((indices) => ({ vertices: indices.map((index) => sum(points[index], center)), color })), transform, exploded, assembly)
  }

  function beam(id: string, stage: SceneStage, category: SceneCategory, from: Vec3, to: Vec3, thickness: number, depth: number, color: string, transform: Transform, exploded: Vec3 = ZERO) {
    const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
    const length = Math.hypot(...delta)
    if (length < 0.01) return
    const y = unit(delta)
    const x = unit(cross(y, Math.abs(y[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0]))
    const z = unit(cross(x, y))
    const center = scale(sum(from, to), 0.5)
    const points = ([-1, 1] as const).flatMap((sz) => [[-1, -1, sz], [1, -1, sz], [1, 1, sz], [-1, 1, sz]].map(([sx, sy, zz]) => sum(center, sum(scale(x, sx * thickness / 2), sum(scale(y, sy * length / 2), scale(z, zz * depth / 2))))))
    piece(id, stage, category, boxFaces.map((indices) => ({ vertices: indices.map((index) => points[index]), color })), transform, exploded)
  }

  function fixing(id: string, center: Vec3, normal: 'top' | 'front' | 'side', transform: Transform, exploded: Vec3 = ZERO, radius = 0.19) {
    const circle: Vec3[] = Array.from({ length: 6 }, (_, index) => {
      const angle = index / 6 * Math.PI * 2
      const a = Math.cos(angle) * radius
      const b = Math.sin(angle) * radius
      const offset: Vec3 = normal === 'top' ? [a, 0, -b] : normal === 'front' ? [a, b, 0] : [0, a, b]
      return sum(center, offset)
    })
    piece(`fixing-${id}`, 'fasteners', 'hardware', [{ vertices: circle, color: COLORS.screw, doubleSided: normal === 'side' }], transform, exploded, sum(exploded, [0, 4, 0]))
  }

  function footing(id: string, center: Vec3, transform: Transform, exploded: Vec3 = ZERO) {
    const radius = 6
    const bottom = center[1] - 0.75
    const top = center[1] + 0.4
    const ring = (y: number): Vec3[] => Array.from({ length: 8 }, (_, index) => [center[0] + Math.cos(index * Math.PI / 4) * radius, y, center[2] + Math.sin(index * Math.PI / 4) * radius])
    const low = ring(bottom)
    const high = ring(top)
    const faces: SceneFace[] = [{ vertices: [...high].reverse(), color: COLORS.concrete }]
    for (let index = 0; index < 8; index++) faces.push({ vertices: [low[index], high[index], high[(index + 1) % 8], low[(index + 1) % 8]], color: COLORS.concrete })
    piece(id, 'supports', 'support', faces, transform, exploded, [0, 5, 0])
  }

  function label(point: Vec3, text: string, transform: Transform, kind: SceneLabel['kind'], showIn: SceneView[], category?: SceneCategory) {
    labels.push({ position: world(point, transform), text, kind, showIn, category })
  }

  function concretePorch(transform: Transform) {
    box('existing-concrete-porch', 'site', 'concrete', [0, config.rise / 2 - 0.5, -14.25], [width + 8, config.rise + 1, 27], COLORS.concrete, transform, ZERO, ZERO)
    box('existing-concrete-cap', 'site', 'concrete', [0, config.rise - 0.5, -14.25], [width + 8.5, 1, 27.1], COLORS.cap, transform, ZERO, ZERO)
    label([0, config.rise + 4, -18], 'Existing concrete porch', transform, 'note', ['framing'], 'concrete')
  }

  function stringer(x: number, risers: number, transform: Transform) {
    const count = risers - 1
    const run = count * g.going
    const slope = g.riserHeight / g.going
    const profile: [number, number][] = [[0, 0], [0, g.riserHeight - g.treadThickness]]
    for (let index = 0; index < count; index++) {
      profile.push([(index + 1) * g.going, (index + 1) * g.riserHeight - g.treadThickness])
      profile.push([(index + 1) * g.going, (index + 2) * g.riserHeight - g.treadThickness])
    }
    const rearBottom = Math.max(0, risers * g.riserHeight - g.treadThickness - 11.25 * Math.sqrt(1 + slope * slope))
    profile.push([run, rearBottom], [Math.min(run, Math.max(0, run - rearBottom / slope)), 0])
    const left: Vec3[] = profile.map(([u, y]) => [x - 0.75, y, run - u])
    const right: Vec3[] = profile.map(([u, y]) => [x + 0.75, y, run - u])
    const faces: SceneFace[] = []
    // Per-step triangles avoid a single concave face painting over multiple tread levels.
    const underside = (z: number) => Math.max(0, rearBottom - z * slope)
    for (let step = 0; step < count; step++) {
      const top = (count - step) * g.riserHeight - g.treadThickness
      const near = step * g.going
      const far = (step + 1) * g.going
      const groundContact = rearBottom / slope
      const split = groundContact > near && groundContact < far ? [near, groundContact, far] : [near, far]
      for (let segment = 0; segment < split.length - 1; segment++) {
        const first = split[segment]
        const last = split[segment + 1]
        const side: Vec3[] = [[x - 0.75, Math.min(top, underside(last)), last], [x - 0.75, top, last], [x - 0.75, top, first], [x - 0.75, Math.min(top, underside(first)), first]]
        for (const triangle of [[0, 1, 2], [0, 2, 3]]) {
          const vertices = triangle.map((index) => side[index])
          faces.push({ vertices, color: COLORS.frame })
          faces.push({ vertices: vertices.map((vertex): Vec3 => [vertex[0] + 1.5, vertex[1], vertex[2]]).reverse(), color: COLORS.frame })
        }
      }
    }
    for (let index = 0; index < profile.length; index++) {
      const next = (index + 1) % profile.length
      if (Math.hypot(left[index][1] - left[next][1], left[index][2] - left[next][2]) > 0.0001) faces.push({ vertices: [left[index], right[index], right[next], left[next]], color: COLORS.frame })
    }
    piece('notched-stringer', 'stringers', 'stringer', faces, transform, [x * 0.25, 0, 0], [x * 0.3, 11, 2])
  }

  function supports(flight: SupportFlight, transform: Transform) {
    const exploded: Vec3 = [width + 10, 0, 0]
    const ground = -flight.baseElevation
    flight.rows.forEach((row, index) => {
      const beamBottom = row.beamTop - row.beamDepth
      for (const side of [-1, 1]) box(`bearing-beam-${index}`, 'supports', 'support', [0, row.beamTop - row.beamDepth / 2, row.z + side * row.beamWidth / 4], [row.beamLength, row.beamDepth, row.beamWidth / 2 - 0.05], COLORS.frame, transform, exploded, [6, 9, 2])
      const xs = row.postPositions.map((position) => position - width / 2)
      xs.forEach((x, postIndex) => {
        footing(`support-footing-${index}-${postIndex}`, [x, ground - 0.1, row.z], transform, exploded)
        box('support-base-plate', 'supports', 'hardware', [x, ground + 0.7, row.z], [row.postWidth + 1.25, 0.6, row.postWidth + 1.25], COLORS.metal, transform, exploded)
        const height = row.postHeight - 1.25
        box('independent-support-post', 'supports', 'support', [x, ground + 1.25 + height / 2, row.z], [row.postWidth, height, row.postWidth], COLORS.frame, transform, exploded)
        for (const side of [-1, 1]) {
          box('post-base-strap', 'supports', 'hardware', [x + side * (row.postWidth / 2 + 0.1), ground + 2.8, row.z], [0.15, 3, row.postWidth - 0.5], COLORS.metal, transform, exploded)
          box('post-cap-strap', 'supports', 'hardware', [x + side * (row.postWidth / 2 + 0.1), beamBottom - 0.2, row.z], [0.15, 3.2, row.beamWidth + 0.75], COLORS.metal, transform, exploded)
          fixing('post-cap', [x + side * (row.postWidth / 2 + 0.2), beamBottom - 0.5, row.z], 'side', transform, exploded, 0.28)
        }
      })
      if (xs.length > 1) {
        const kneeRun = Math.min(24, (xs[xs.length - 1] - xs[0]) / 3)
        const kneeDrop = Math.max(0, Math.min(24, row.postHeight - 2.4))
        if (kneeDrop > 2) for (const face of [-1, 1]) for (const side of [-1, 1]) {
          const x = side === -1 ? xs[0] : xs[xs.length - 1]
          const z = row.z + face * (row.postWidth / 2 + 0.9)
          beam('support-knee-brace', 'supports', 'support', [x, beamBottom - kneeDrop, z], [x - side * kneeRun, beamBottom - 0.5, z], 3.5, 1.5, COLORS.blocking, transform, exploded)
        }
      }
      g.stringerPositions.forEach((position) => {
        const x = position - width / 2
        box('bearing-restraint-marker', 'fasteners', 'hardware', [x + 0.92, row.beamTop + 0.85, row.z + row.beamWidth / 2 - 0.1], [0.16, 2.6, 1.8], COLORS.metal, transform, exploded)
        fixing('beam-restraint', [x + 1.04, row.beamTop + 1.2, row.z + row.beamWidth / 2 - 0.1], 'side', transform, exploded)
      })
    })
    if (flight.rows.length) label([width + 10, flight.rows[0].beamTop + 9, flight.rows[0].z], '5 · Independent support frame', transform, 'part', ['exploded'], 'support')
    if (flight.unresolved) label([width / 2 + 8, flight.rise * 0.4, flight.run * 0.4], 'Support detail still needs design', transform, 'note', ['framing'], 'support')
  }

  function railing(risers: number, transform: Transform) {
    const run = (risers - 1) * g.going
    const height = risers * g.riserHeight
    const topZ = 2.25
    const bottomZ = Math.max(topZ + 1, run - 2.5)
    for (const side of [-1, 1]) {
      const x = side * (width / 2 + 1.75)
      const exploded: Vec3 = [side * 13, 5, 0]
      for (const [z, base] of [[topZ, height], [bottomZ, g.riserHeight]]) {
        box('rail-post', 'complete', 'rail', [x, (base + 37) / 2, z], [3.5, base + 37, 3.5], finish, transform, exploded)
        box('rail-post-cap', 'complete', 'rail', [x, base + 37.5, z], [4.2, 0.75, 4.2], finish, transform, exploded)
      }
      beam('stair-handrail', 'complete', 'rail', [x, height + 35, topZ], [x, g.riserHeight + 35, bottomZ], 3.5, 1.5, finish, transform, exploded)
      beam('stair-rail-bottom', 'complete', 'rail', [x, height + 5, topZ], [x, g.riserHeight + 5, bottomZ], 1.5, 2.5, finish, transform, exploded)
      const pickets = Math.max(1, Math.ceil((bottomZ - topZ) / 4.5) - 1)
      for (let index = 1; index <= pickets; index++) {
        const fraction = index / (pickets + 1)
        const y = height + fraction * (g.riserHeight - height)
        box('rail-picket', 'complete', 'rail', [x, y + 20, topZ + fraction * (bottomZ - topZ)], [0.85, 30, 0.85], finish, transform, exploded)
      }
    }
  }

  function flight(risers: number, transform: Transform, name: SupportFlight['flight'], showLabels: boolean) {
    const count = risers - 1
    const run = count * g.going
    const height = risers * g.riserHeight
    const xs = g.stringerPositions.map((position) => position - width / 2)
    const nose = Math.max(0, g.noseProjection)
    xs.forEach((x) => stringer(x, risers, transform))
    for (let step = 0; step < count; step++) {
      const y = (step + 1) * g.riserHeight
      const z = (count - step) * g.going
      for (let board = 0; board < g.boardsPerTread; board++) {
        const centerZ = z + nose - g.boardWidth / 2 - board * (g.boardWidth + g.boardGap)
        const exploded: Vec3 = [0, 17, (board - (g.boardsPerTread - 1) / 2) * -4]
        box('tread-plank', 'treads', 'tread', [0, y - g.treadThickness / 2, centerZ], [width, g.treadThickness, g.boardWidth], finish, transform, exploded, [0, 18, 0])
        xs.forEach((x) => [-1, 1].forEach((sign) => fixing('tread-screw', [x, y + 0.04, centerZ + sign * g.boardWidth * 0.29], 'top', transform, exploded)))
      }
    }
    if (config.closedRisers) for (let step = 0; step < risers; step++) {
      const faceHeight = g.riserHeight - g.treadThickness
      const top = (step + 1) * g.riserHeight - g.treadThickness
      const z = (count - step) * g.going
      const exploded: Vec3 = [0, 3, 13]
      box('riser-face', 'risers', 'riser', [0, top - faceHeight / 2, z - 0.375], [width, faceHeight, 0.75], finish, transform, exploded, [0, 3, 13])
      const screwInset = Math.min(1.1, faceHeight / 3)
      xs.forEach((x) => [top - screwInset, top - faceHeight + screwInset].forEach((y) => fixing('riser-screw', [x, y, z + 0.04], 'front', transform, exploded)))
    }
    const blockingRows = name === 'lower' ? g.lowerBlockingRows : name === 'upper' ? g.upperBlockingRows : g.blockingRows
    for (let row = 0; row < blockingRows; row++) {
      const z = 1.8 + Math.max(0, run - 3.6) * row / Math.max(1, blockingRows - 1)
      const step = Math.min(count - 1, Math.max(0, count - 1 - Math.floor(z / g.going)))
      const top = (step + 1) * g.riserHeight - g.treadThickness
      const depth = Math.min(5.5, top - 0.25)
      for (let index = 0; index < xs.length - 1; index++) box('between-stringer-blocking', 'blocking', 'blocking', [(xs[index] + xs[index + 1]) / 2, top - depth / 2, z], [xs[index + 1] - xs[index] - 1.5, depth, 1.5], COLORS.blocking, transform, [0, 7, -10], [0, 8, -10])
    }
    const support = g.supportFlights.find((value) => value.flight === name)
    if (support) supports(support, transform)
    if (config.railing) railing(risers, transform)
    if (showLabels) {
      label([-width / 2 - 13, height * 0.45, run * 0.55], '1 · Notched stringers', transform, 'part', ['exploded'], 'stringer')
      label([-width / 2, height + 20, 1], '2 · Tread planks', transform, 'part', ['exploded'], 'tread')
      if (config.closedRisers) label([width / 2 + 4, g.riserHeight / 2 + 3, run + 16], '3 · Riser boards', transform, 'part', ['exploded'], 'riser')
      label([width / 2 + 4, height + 8, -10], '4 · Back bracing / blocking', transform, 'part', ['exploded'], 'blocking')
      label([0, g.riserHeight + 7, run + 4], '2 fixing points per plank / stringer', transform, 'note', ['fasteners'], 'hardware')
    }
  }

  function landing(size: number, height: number, transform: Transform) {
    const frameDepth = 7.25
    const top = height - g.treadThickness
    const postTop = top - frameDepth
    const gap = g.landingBoardGap
    const boardWidths = Array.from({ length: g.landingDeckBoards }, (_, index) => index === g.landingDeckBoards - 1 ? size - index * (5.5 + gap) : 5.5)
    if (boardWidths.length > 1 && boardWidths[boardWidths.length - 1] < 1.5) {
      const last = boardWidths.length - 1
      const shared = (boardWidths[last] + boardWidths[last - 1]) / 2
      boardWidths[last] = boardWidths[last - 1] = shared
    }
    const joists = Math.ceil((size - 1.5) / (config.material === 'composite' ? 9 : 16)) + 1
    const xs = Array.from({ length: joists }, (_, index) => -size / 2 + 0.75 + index * (size - 1.5) / (joists - 1))
    let z = -size
    boardWidths.forEach((boardWidth) => {
      box('landing-tread-plank', 'treads', 'tread', [0, height - g.treadThickness / 2, z + boardWidth / 2], [size, g.treadThickness, boardWidth], finish, transform, [0, 17, 0], [0, 18, 0])
      xs.forEach((x) => [0.21, 0.79].forEach((ratio) => fixing('landing-screw', [x, height + 0.04, z + boardWidth * ratio], 'top', transform, [0, 17, 0])))
      z += boardWidth + gap
    })
    for (const edgeZ of [-0.75, -size + 0.75]) box('landing-rim', 'supports', 'support', [0, top - frameDepth / 2, edgeZ], [size, frameDepth, 1.5], COLORS.frame, transform)
    xs.forEach((x) => box('landing-joist', 'supports', 'support', [x, top - frameDepth / 2, -size / 2], [1.5, frameDepth, size - 3], COLORS.frame, transform))
    if (postTop > 1.5) for (const side of [-1, 1]) for (const edgeZ of [-3.5, -size + 3.5]) {
      const x = side * (size / 2 - 3.5)
      footing('landing-foundation', [x, -0.1, edgeZ], transform)
      box('landing-post-base', 'supports', 'hardware', [x, 0.7, edgeZ], [6.75, 0.6, 6.75], COLORS.metal, transform)
      box('landing-post', 'supports', 'support', [x, 1.25 + (postTop - 1.25) / 2, edgeZ], [5.5, postTop - 1.25, 5.5], COLORS.frame, transform)
    }
    if (config.railing) {
      const edges: [Vec3, Vec3][] = [[[-size / 2, height, -size], [size / 2, height, -size]], [[size / 2, height, -size], [size / 2, height, 0]]]
      const corners = [edges[0][0], edges[0][1], edges[1][1]]
      corners.forEach((point) => box('landing-guard-post', 'complete', 'rail', sum(point, [0, 18, 0]), [3.5, 36, 3.5], finish, transform, [6, 5, -5]))
      edges.forEach(([a, b]) => {
        for (const railY of [5, 35]) beam('landing-guard-rail', 'complete', 'rail', sum(a, [0, railY, 0]), sum(b, [0, railY, 0]), 3.5, 1.5, finish, transform, [6, 5, -5])
        const count = Math.ceil(size / 4.5)
        for (let index = 1; index < count; index++) box('landing-guard-picket', 'complete', 'rail', sum(sum(a, scale([b[0] - a[0], 0, b[2] - a[2]], index / count)), [0, 20, 0]), [0.85, 30, 0.85], finish, transform, [6, 5, -5])
      })
    }
  }

  function planter(side: number, front: number) {
    const transform: Transform = { origin: [side * (width / 2 + 11), 0, front - 1], angle: 0 }
    const exploded: Vec3 = [side * 5, 5, 0]
    for (let row = 0; row < 3; row++) for (const face of [-1, 1]) {
      box('planter-long-board', 'complete', 'planter', [0, 2.9 + row * 5.625, face * 8.625], [18, 5.5, 0.75], COLORS.cedar, transform, exploded)
      box('planter-short-board', 'complete', 'planter', [face * 8.625, 2.9 + row * 5.625, 0], [0.75, 5.5, 16.5], COLORS.cedar, transform, exploded)
    }
    box('planter-soil', 'complete', 'planter', [0, 15.8, 0], [16.4, 0.4, 16.4], '#756653', transform, exploded)
    for (let index = 0; index < 10; index++) {
      const angle = index * 2.39996
      const radius = 2 + index % 3
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const height = 5 + index % 4
      const vertices: Vec3[] = [[x - 1.5, 17, z], [x + Math.cos(angle) * 2, 17 + height, z + Math.sin(angle) * 2], [x + 1.5, 18, z + 0.6]]
      piece('planter-leaf', 'complete', 'planter', [{ vertices, color: ['#7f9466', '#668058', '#94a777'][index % 3], doubleSided: true }], transform, exploded)
    }
  }

  const turning = config.ending === 'turn'
  const landingSize = g.landingSize
  const landingHeight = g.lowerRisers * g.riserHeight
  const front = turning ? landingSize / 2 + g.lowerRun : config.run
  const upperTransform: Transform = { origin: [-landingSize / 2 - g.upperRun, landingHeight, 0], angle: Math.PI / 2 }
  concretePorch(turning ? { ...upperTransform, origin: [upperTransform.origin[0], 0, 0] } : IDENTITY)
  box('ground-landing-allowance', 'site', 'concrete', [0, -0.85, front + 18], [width + 8, 1.25, 36], COLORS.cap, IDENTITY, ZERO, ZERO)
  if (g.riserHeight > g.treadThickness) {
    if (turning) {
      const lowerTransform: Transform = { origin: [0, 0, landingSize / 2], angle: 0 }
      flight(g.lowerRisers, lowerTransform, 'lower', true)
      landing(landingSize, landingHeight, lowerTransform)
      flight(g.upperRisers, upperTransform, 'upper', false)
    } else {
      flight(config.risers, IDENTITY, 'straight', true)
    }
    if (config.ending === 'planter') for (const side of [-1, 1]) planter(side, front)
  } else {
    label([0, config.rise + 5, config.run / 2], 'Use fewer rises or increase the height', IDENTITY, 'note', ['finished', 'framing', 'fasteners', 'exploded'])
  }

  const dim = (from: Vec3, to: Vec3, text: string) => dimensions.push({ from: scale(from, FT), to: scale(to, FT), label: text })
  dim([-width / 2, 0.8, front + 43], [width / 2, 0.8, front + 43], `${numberLabel(width)}″ wide`)
  if (turning) {
    dim([width / 2 + 10, 1, landingSize / 2], [width / 2 + 10, 1, front], `${numberLabel(g.lowerRun)}″ lower run`)
    dim([-landingSize / 2 - g.upperRun, landingHeight + 2, width / 2 + 8], [-landingSize / 2, landingHeight + 2, width / 2 + 8], `${numberLabel(g.upperRun)}″ upper run`)
    dim([-landingSize / 2 - g.upperRun - 34, 0, 0], [-landingSize / 2 - g.upperRun - 34, config.rise, 0], `${numberLabel(config.rise)}″ rise`)
    dim([landingSize / 2 + 6, landingHeight + 2, -landingSize / 2], [landingSize / 2 + 6, landingHeight + 2, landingSize / 2], `${numberLabel(landingSize)}″ landing`)
  } else {
    dim([width / 2 + 9, 0.8, 0], [width / 2 + 9, 0.8, config.run], `${numberLabel(config.run)}″ run`)
    dim([-width / 2 - 9, 0, -1], [-width / 2 - 9, config.rise, -1], `${numberLabel(config.rise)}″ rise`)
  }

  // Dense imported projects retain every board; only tiny illustrative fixing dots use LOD.
  const markers = pieces.filter((item) => item.id.startsWith('fixing-'))
  const majorFaces = pieces.filter((item) => !item.id.startsWith('fixing-')).reduce((count, item) => count + item.faces.length, 0)
  const markerBudget = Math.max(120, 1900 - majorFaces)
  let retained = pieces
  if (markers.length > markerBudget) {
    const stride = Math.ceil(markers.length / markerBudget)
    let markerIndex = 0
    retained = pieces.filter((item) => !item.id.startsWith('fixing-') || markerIndex++ % stride === 0)
    label([0, config.rise + 8, front], 'Fixing dots are schematic; use the material list for quantities.', IDENTITY, 'note', ['fasteners'], 'hardware')
  }
  const allVertices = retained.flatMap((item) => item.faces.flatMap((face) => face.vertices))
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  allVertices.forEach((point) => point.forEach((value, axis) => { min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value) }))
  return { pieces: retained, dimensions, labels, bounds: { min, max } }
}
