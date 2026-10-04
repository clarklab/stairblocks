import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from './planner'
import { parseProject } from './project'

describe('project file validation', () => {
  it('round-trips an exported project and preserves zero and decimal prices', () => {
    const saved = { version: 1, name: 'Back porch stairs', config: { ...DEFAULT_CONFIG }, prices: { 'deck-screws': 0, 'treated-treads-2-10ft': 12.34 } }
    const loaded = parseProject(JSON.parse(JSON.stringify(saved)))
    expect(loaded).toEqual({ config: saved.config, prices: saved.prices })
    expect(loaded?.config).not.toBe(saved.config)
    expect(loaded?.prices).not.toBe(saved.prices)
  })

  it('accepts legacy device saves and a project with no price overrides', () => {
    expect(parseProject({ config: DEFAULT_CONFIG })).toEqual({ config: DEFAULT_CONFIG, prices: {} })
    expect(parseProject({ config: DEFAULT_CONFIG, prices: {} })).not.toBeNull()
    expect(parseProject({ version: 2, config: DEFAULT_CONFIG })).toBeNull()
  })

  it('rejects invalid structures instead of treating arrays or strings as records', () => {
    for (const input of [null, [], 'project', {}, { config: [] }, { config: DEFAULT_CONFIG, prices: [] }, { config: DEFAULT_CONFIG, prices: '12' }, { config: DEFAULT_CONFIG, prices: null }]) {
      expect(parseProject(input)).toBeNull()
    }
  })

  it('rejects dimensions outside the editable range and nonnumeric values', () => {
    for (const patch of [
      { rise: 13.99 }, { rise: 84.01 }, { rise: NaN }, { rise: '35' },
      { run: 19.99 }, { run: 144.01 }, { run: Infinity },
      { width: 29.99 }, { width: 96.01 },
      { risers: 2 }, { risers: 13 }, { risers: 4.5 },
    ]) expect(parseProject({ config: { ...DEFAULT_CONFIG, ...patch } })).toBeNull()
    expect(parseProject({ config: { ...DEFAULT_CONFIG, rise: 14, run: 20, width: 30, risers: 3 } })).not.toBeNull()
    expect(parseProject({ config: { ...DEFAULT_CONFIG, rise: 84, run: 144, width: 96, risers: 12 } })).not.toBeNull()
  })

  it('rejects turns with fewer than four risers so form values match the rendered plan', () => {
    expect(parseProject({ config: { ...DEFAULT_CONFIG, ending: 'turn', risers: 3 } })).toBeNull()
    expect(parseProject({ config: { ...DEFAULT_CONFIG, ending: 'turn', risers: 4 } })?.config.risers).toBe(4)
  })

  it('requires supported enum values and real boolean switches', () => {
    for (const patch of [{ material: 'plastic' }, { ending: 'spiral' }, { tread: 'six6' }, { railing: 'false' }, { closedRisers: 0 }]) {
      expect(parseProject({ config: { ...DEFAULT_CONFIG, ...patch } })).toBeNull()
    }
    expect(parseProject({ config: { ...DEFAULT_CONFIG, railing: false, closedRisers: false } })?.config.railing).toBe(false)
  })

  it('normalizes composite to its supported two-board tread assembly', () => {
    const config = { ...DEFAULT_CONFIG, material: 'composite', tread: 'one12' }
    expect(parseProject({ config })?.config.tread).toBe('two6')
    expect(config.tread).toBe('one12')
  })

  it('rejects invalid price values without coercing them to free materials', () => {
    for (const value of [-1, NaN, Infinity, '12.00', null, false, {}]) {
      expect(parseProject({ config: DEFAULT_CONFIG, prices: { 'deck-screws': value } })).toBeNull()
    }
  })

  it('discards prototype and malformed keys and copies only known configuration fields', () => {
    const prices = JSON.parse('{"__proto__":{"polluted":true},"constructor":10,"prototype":10,"bad.key":5,"deck-screws":19.95}')
    const config = { ...DEFAULT_CONFIG, extra: 'ignored' }
    const loaded = parseProject({ config, prices })
    expect(loaded?.prices).toEqual({ 'deck-screws': 19.95 })
    expect(loaded?.config).toEqual(DEFAULT_CONFIG)
    expect(Object.hasOwn(loaded!.prices, '__proto__')).toBe(false)
    expect(Object.hasOwn(loaded!.prices, 'constructor')).toBe(false)
    expect(Object.getPrototypeOf(loaded!.prices)).toBe(Object.prototype)
  })
})
