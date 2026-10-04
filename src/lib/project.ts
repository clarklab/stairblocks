import type { PriceOverrides, StairConfig } from './planner'
import { COMPOSITE_COLORS, MAX_STAIR_WIDTH } from './planner'

export interface SavedProject {
  config: StairConfig
  prices: PriceOverrides
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

/** Validate downloaded projects and device storage without reading or changing browser storage. */
export function parseProject(input: unknown): SavedProject | null {
  if (!isRecord(input) || !isRecord(input.config)) return null
  // Legacy device saves have no version; downloaded projects currently use version 1.
  if (input.version !== undefined && input.version !== 1) return null
  const c = input.config
  if (c.material !== 'treated' && c.material !== 'cedar' && c.material !== 'composite') return null
  if (c.ending !== 'open' && c.ending !== 'planter' && c.ending !== 'turn') return null
  if (c.tread !== 'two6' && c.tread !== 'one12') return null
  if (!inRange(c.rise, 14, 84) || !inRange(c.run, 20, 144) || !inRange(c.width, 30, MAX_STAIR_WIDTH)) return null
  if (!inRange(c.risers, c.ending === 'turn' ? 4 : 3, 12) || !Number.isInteger(c.risers)) return null
  if (typeof c.railing !== 'boolean' || typeof c.closedRisers !== 'boolean') return null
  if (c.compositeTreads !== undefined && typeof c.compositeTreads !== 'boolean') return null
  if (c.returnCaps !== undefined && typeof c.returnCaps !== 'boolean') return null
  if (c.sidePanel !== undefined && c.sidePanel !== 'open' && c.sidePanel !== 'lattice' && c.sidePanel !== 'solid') return null
  const color = COMPOSITE_COLORS.find(color => color.id === (c.compositeColor === undefined ? 'gray' : c.compositeColor))
  if (!color) return null
  const legacyComposite = c.material === 'composite'

  const rawPrices = input.prices === undefined ? {} : input.prices
  if (!isRecord(rawPrices)) return null
  const prices: PriceOverrides = {}
  for (const [key, value] of Object.entries(rawPrices)) {
    // Row identifiers are simple words/numbers separated by hyphens. Never copy prototype keys.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(key)) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
    prices[key] = value
  }

  return {
    config: {
      rise: c.rise,
      run: c.run,
      width: c.width,
      risers: c.risers,
      material: legacyComposite ? 'treated' : c.material as StairConfig['material'],
      compositeTreads: legacyComposite || c.compositeTreads === true,
      compositeColor: color.id,
      sidePanel: c.sidePanel === undefined ? 'open' : c.sidePanel,
      returnCaps: c.returnCaps === true,
      tread: legacyComposite ? 'two6' : c.tread,
      ending: c.ending,
      railing: c.railing,
      closedRisers: c.closedRisers,
    },
    prices,
  }
}
