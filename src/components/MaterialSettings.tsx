import { Check } from 'lucide-react';
import { COMPOSITE_COLORS } from '../lib/planner';
import type { StairConfig } from '../lib/planner';

type Props = {
  config: StairConfig;
  stringerSpacing: number;
  onChange: (changes: Partial<StairConfig>) => void;
};

export default function MaterialSettings({ config, stringerSpacing, onChange }: Props) {
  return <div className="section-body material-options">
    <fieldset className="wood-choice">
      <legend className="field-label">Wood boards</legend>
      {([{ id: 'treated', name: 'Pressure-treated pine', help: 'Budget-friendly · stainable' }, { id: 'cedar', name: 'Western red cedar', help: 'Natural warm color' }] as const).map(wood =>
        <label className="material-option" key={wood.id}>
          <span className={`wood-swatch ${wood.id}`} aria-hidden="true"/>
          <span>{wood.name}<small>{wood.help}</small></span>
          <input type="radio" name="wood-material" value={wood.id} checked={config.material === wood.id} onChange={() => onChange({ material: wood.id })}/>
        </label>
      )}
    </fieldset>
    <p className="control-helper">Wood risers match this choice. Stringers, blocking, and the movable base frame use pressure-treated lumber.</p>
    <div className="composite-setting">
      <label className="toggle-label">
        <span>Composite step tops<small>Tread planks{config.ending === 'turn' ? ' and landing decking' : ''} only</small></span>
        <span className="toggle"><input type="checkbox" name="composite-treads" checked={config.compositeTreads} onChange={event => onChange({ compositeTreads: event.target.checked })}/><span/></span>
      </label>
      {config.compositeTreads && <fieldset className="composite-colors">
        <legend className="field-label">Composite color</legend>
        <div className="color-options">{COMPOSITE_COLORS.map(color => <label className="color-option" key={color.id}>
          <input type="radio" name="composite-color" value={color.id} checked={config.compositeColor === color.id} onChange={() => onChange({ compositeColor: color.id })}/>
          <span className="color-swatch" style={{ backgroundColor: color.hex }} aria-hidden="true"><Check size={15}/></span>
          <span>{color.name}</span>
        </label>)}</div>
        <p className="control-helper">Preview colors are approximate. Choose the matching board and price at your store.</p>
      </fieldset>}
    </div>
    <label className="field-label" htmlFor="tread-layout">Tread planks</label>
    <select id="tread-layout" name="tread-layout" value={config.compositeTreads ? 'two6' : config.tread} disabled={config.compositeTreads} onChange={event => onChange({ tread: event.target.value as StairConfig['tread'] })}>
      <option value="two6">Two {config.compositeTreads ? '1 × 6' : '2 × 6'} planks per tread</option>
      <option value="one12">One 2 × 12 plank per tread</option>
    </select>
    <p className="control-helper">{config.compositeTreads ? 'Composite uses two decking boards. Your wood plank choice is kept when you switch back.' : 'Nominal sizes. A 2 × 6 is actually 1½″ × 5½″.'}</p>
    <p className="spacing-note"><strong>{Number(stringerSpacing.toFixed(2))}″ stringer centers</strong><span>{config.compositeTreads ? '9″ maximum for the Trex Enhance example. Verify your board’s stair instructions.' : '16″ maximum in this plan. Verify the selected lumber’s tread span.'}</span></p>
  </div>;
}
