import { DEFAULT_CONFIG, type StairConfig } from './planner'

export type LayoutDriver = 'rise' | 'run' | 'risers' | 'profile' | 'ending' | 'suggest'
export interface LayoutResult {
  config: StairConfig
  status: 'fit' | 'unavailable'
  message: string
}
export interface LayoutLimits {
  minRun: number
  maxRun: number
  minRisers: number
  maxRisers: number
  feasible: boolean
}
type Interval = { min: number; max: number }
type Candidate = { risers: number; treads: number; intervals: Interval[] }
const EPSILON = 1e-8
const label = (value: number) => `${Number(value.toFixed(3))}″`
const minimumCount = (config: StairConfig) => config.ending === 'turn' ? 4 : 3
const treadCount = (config: StairConfig, risers: number) => risers - (config.ending === 'turn' ? 2 : 1)
const thickness = (config: StairConfig) => config.compositeTreads ? 1 : 1.5
const depth = (config: StairConfig) => config.compositeTreads || config.tread === 'one12' ? 11.25 : 11.125
const contains = (intervals: Interval[], value: number) => Number.isFinite(value) && intervals.some(interval => value >= interval.min - EPSILON && value <= interval.max + EPSILON)

/** Dimensional screening only; this does not validate the portable support structure. */
function candidates(config: StairConfig): Candidate[] {
  if (!Number.isFinite(config.rise) || config.rise < 14 || config.rise > 84) return []
  const result: Candidate[] = []
  const boardDepth = depth(config)
  for (let risers = minimumCount(config); risers <= 12; risers++) {
    const stepRise = config.rise / risers
    if (stepRise > 7.75 || stepRise - thickness(config) < 3.5) continue
    const treads = treadCount(config, risers)
    // 11.25 - going*rise/hypot(going,rise) >= 5, solved for going.
    const throatLimit = stepRise > 6.25 ? 6.25 * stepRise / Math.sqrt(stepRise ** 2 - 6.25 ** 2) : Infinity
    const lower = Math.max(10, 20 / treads)
    const upper = Math.min(boardDepth, throatLimit - 1e-9, 144 / treads)
    const raw = config.closedRisers
      ? [{ min: boardDepth - 1.25, max: Math.min(boardDepth - 0.75, 11) }, { min: 11, max: boardDepth }]
      : [{ min: 10, max: boardDepth }]
    const intervals = raw.map(interval => ({ min: Math.max(lower, interval.min), max: Math.min(upper, interval.max) }))
      .filter(interval => interval.min <= interval.max)
      .map(interval => ({ min: interval.min, max: Math.max(interval.min, interval.max) }))
    if (intervals.length) result.push({ risers, treads, intervals })
  }
  return result
}

function nearest(intervals: Interval[], requested: number): number {
  return intervals.map(interval => Math.min(interval.max, Math.max(interval.min, requested)))
    .sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || a - b)[0]
}
function currentGoing(config: StairConfig): number {
  const count = treadCount(config, config.risers)
  return Number.isFinite(config.run) && Number.isFinite(count) && count > 0 ? config.run / count : 11
}
function preferredCount(options: Candidate[], requested: number): Candidate {
  return [...options].sort((a, b) => Math.abs(a.risers - requested) - Math.abs(b.risers - requested) || a.risers - b.risers)[0]
}
function preserveGoing(option: Candidate, going: number): number {
  return nearest(option.intervals, contains(option.intervals, going) ? going : 11) * option.treads
}

export function getLayoutLimits(config: StairConfig): LayoutLimits {
  const options = candidates(config)
  if (!options.length) return { minRun: 20, maxRun: 144, minRisers: minimumCount(config), maxRisers: 12, feasible: false }
  return {
    minRun: Math.min(...options.flatMap(option => option.intervals.map(interval => interval.min * option.treads))),
    maxRun: Math.max(...options.flatMap(option => option.intervals.map(interval => interval.max * option.treads))),
    minRisers: options[0].risers,
    maxRisers: options[options.length - 1].risers,
    feasible: true,
  }
}

/** Valid slider positions, including exact band edges that are not quarter inches. */
export function getLayoutRunStops(config: StairConfig): number[] {
  const values: number[] = []
  for (const option of candidates(config)) for (const interval of option.intervals) {
    const min = interval.min * option.treads
    const max = interval.max * option.treads
    values.push(min, max)
    for (let quarter = Math.ceil(min * 4); quarter <= Math.floor(max * 4); quarter++) values.push(quarter / 4)
  }
  return values.sort((a, b) => a - b).filter((value, index, sorted) => index === 0 || value - sorted[index - 1] > EPSILON)
}

/** Preserve the requested porch height; couple count and run to actual board geometry. */
export function solveLayout(config: StairConfig, patch: Partial<StairConfig>, driver: LayoutDriver): LayoutResult {
  const requested = { ...config, ...patch }
  const invalidFields = (['rise', 'run', 'risers', 'width'] as const).filter(key => !Number.isFinite(requested[key]))
  const next = { ...requested }
  // Nonfinite values cannot represent a measurement. Keep the last finite value,
  // or the starter value if the input config itself was malformed.
  for (const key of invalidFields) next[key] = Number.isFinite(config[key]) ? config[key] : DEFAULT_CONFIG[key]
  const options = candidates(next)
  const comfortCount = Math.ceil(next.rise / 7.5)
  if (!options.length) {
    const risers = Math.max(minimumCount(next), Math.min(12, Number.isFinite(comfortCount) ? comfortCount : DEFAULT_CONFIG.risers))
    const preview = { ...next, risers, run: Math.max(20, Math.min(144, treadCount(next, risers) * 11)) }
    return {
      config: preview,
      status: 'unavailable',
      message: `No layout fits ${label(next.rise)} height with these boards and the 3½″ bottom frame within the modeled limits. Height is unchanged; the preview needs a different base or tread assembly.${invalidFields.length ? ' Enter finite measurements.' : ''}`,
    }
  }

  let selected: Candidate
  let run: number
  const beforeGoing = currentGoing(config)
  if (driver === 'run' || driver === 'profile') {
    const ranked = options.map(option => {
      const fittedRun = nearest(option.intervals, next.run / option.treads) * option.treads
      return { option, run: fittedRun, distance: Math.abs(fittedRun - next.run) }
    }).sort((a, b) => {
      const distanceDifference = a.distance - b.distance
      if (Math.abs(distanceDifference) > EPSILON) return distanceDifference
      return Math.abs(a.option.risers - next.risers) - Math.abs(b.option.risers - next.risers) || a.option.risers - b.option.risers
    })
    selected = ranked[0].option
    run = ranked[0].run
  } else {
    const desiredCount = driver === 'rise' || driver === 'suggest' ? comfortCount : next.risers
    selected = preferredCount(options, desiredCount)
    run = driver === 'suggest' ? nearest(selected.intervals, 11) * selected.treads : preserveGoing(selected, beforeGoing)
  }
  const fitted = { ...next, risers: selected.risers, run }
  const requestedRun = driver === 'ending' ? beforeGoing * selected.treads : next.run
  const snapped = Math.abs(run - requestedRun) > EPSILON
  const riseText = `${selected.risers} rises at ${label(next.rise / selected.risers)}`
  let message = `${label(next.rise)} height · ${label(run)} run · ${riseText}.`
  if (snapped && (driver === 'run' || driver === 'profile')) message = `Requested ${label(next.run)} run → ${label(run)} to fit the boards: ${riseText}. Height stays ${label(next.rise)}.`
  else if (driver === 'risers' && Math.abs(next.risers - selected.risers) > EPSILON) message = `Requested ${next.risers} rises → ${selected.risers} within the dimensional limits. ${label(run)} run; height stays ${label(next.rise)}.`
  else if (driver === 'run' || driver === 'profile' || driver === 'ending' || driver === 'risers') message = `${label(run)} run · ${riseText}. Height stays ${label(next.rise)}.`
  if (invalidFields.length) return { config: fitted, status: 'unavailable', message: `Enter finite ${invalidFields.join(', ')} values. The last finite measurements are retained in this preview.` }
  return { config: fitted, status: 'fit', message }
}
