import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Cuboid, Eye, Layers3, ListChecks, MousePointer2, Pause, Play, RotateCcw } from 'lucide-react'
import type { StairPlan } from '../lib/planner'
import { getBuildParts, getBuildSteps } from '../lib/buildSteps'

const StairScene = lazy(() => import('./StairScene'))

export default function BuildWalkthrough({ plan, onEdit, onChecks }: { plan: StairPlan; onEdit: () => void; onChecks: () => void }) {
  const steps = useMemo(() => getBuildSteps(plan), [plan])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [finished, setFinished] = useState(false)
  const [autoAdvance, setAutoAdvance] = useState(false)
  const [animationKey, setAnimationKey] = useState(0)
  const [cameraView, setCameraView] = useState<'perspective' | 'side' | 'top'>('perspective')
  const [resetKey, setResetKey] = useState(0)
  const visualRef = useRef<HTMLDivElement>(null)
  const stage = steps[Math.min(index, steps.length - 1)]
  const parts = getBuildParts(plan, stage.id)
  const unresolvedSupports = plan.geometry.supportFlights.filter(flight => flight.unresolved).map(flight => flight.flight === 'straight' ? 'stair run' : `${flight.flight} flight`)
  const configKey = JSON.stringify(plan.config)
  const previousConfig = useRef(configKey)
  useEffect(() => {
    if (previousConfig.current !== configKey) {
      previousConfig.current = configKey
      setIndex(0); setFinished(false); setPlaying(true); setAnimationKey(k => k + 1)
    }
  }, [configKey])
  const selectStep = useCallback((next: number) => {
    setIndex(next); setFinished(false); setPlaying(true); setAnimationKey(k => k + 1)
  }, [])
  const chooseStep = (next: number) => {
    selectStep(next)
    if (window.matchMedia('(max-width: 800px)').matches) {
      visualRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
  }
  const onAnimationComplete = useCallback(() => { setFinished(true); setPlaying(false) }, [])
  useEffect(() => {
    if (!finished || !autoAdvance || index >= steps.length - 1) return
    const timer = setTimeout(() => selectStep(index + 1), 1400)
    return () => clearTimeout(timer)
  }, [finished, autoAdvance, index, steps.length, selectStep])

  return <section className="build-page" aria-label="Animated building instructions">
    <div className="build-heading"><div><div className="section-eyebrow"><Play size={16}/>BUILD THIS PLAN</div><h2>Like LEGO with power tools.</h2><p>Your {plan.config.width}″ × {plan.config.rise}″ stair. The right pieces, one clear step at a time.</p></div><button className="button button-outline" onClick={onEdit}><ArrowLeft size={15}/>Edit configuration</button></div>
    <ol className="build-timeline" aria-label="Assembly segments">{steps.map((step, i) => <li key={step.id}><button type="button" aria-current={i === index ? 'step' : undefined} onClick={() => chooseStep(i)}><span>{String(i + 1).padStart(2, '0')}</span>{step.id === 'site' ? 'Site' : step.id === 'complete' ? 'Finish' : step.id.charAt(0).toUpperCase() + step.id.slice(1)}</button></li>)}</ol>
    <div className="build-workspace">
      <div className="build-visual" ref={visualRef}>
        <div className="build-scene-tag"><span className="status-dot"/>{stage.id === 'site' ? 'EXISTING PORCH + SITE' : 'YOUR SELECTED ASSEMBLY'}</div>
        <div className="build-canvas"><Suspense fallback={<div className="scene-loading"><Cuboid size={30}/><span>Preparing your walkthrough…</span></div>}><StairScene config={plan.config} view="finished" dimensions={false} cameraView={cameraView} resetKey={resetKey} buildStage={stage.id} animationKey={animationKey} animationPaused={!playing} onAnimationComplete={onAnimationComplete}/></Suspense></div>
        <div className="scene-side-tools"><button type="button" className="icon-button" aria-label="Reset walkthrough view" onClick={() => { setCameraView('perspective'); setResetKey(k => k + 1) }}><RotateCcw size={17}/></button><button type="button" className="icon-button" aria-label="Walkthrough side view" aria-pressed={cameraView === 'side'} onClick={() => setCameraView(cameraView === 'side' ? 'perspective' : 'side')}><Eye size={17}/></button><button type="button" className="icon-button" aria-label="Walkthrough top view" aria-pressed={cameraView === 'top'} onClick={() => setCameraView(cameraView === 'top' ? 'perspective' : 'top')}><Layers3 size={17}/></button></div>
        <div className="build-orbit"><MousePointer2 size={13}/>Drag to inspect · scroll or pinch to zoom</div>
        <div className="build-player"><button type="button" className="button button-primary" onClick={() => { if (finished) selectStep(index); else setPlaying(p => !p) }} aria-label={playing ? 'Pause animation' : finished ? 'Replay animation' : 'Play animation'}>{playing ? <Pause size={16}/> : finished ? <RotateCcw size={16}/> : <Play size={16}/>}<span>{playing ? 'Pause' : finished ? 'Replay' : 'Play'}</span></button><span className="segment-status" aria-live="polite">{finished ? 'Segment complete — inspect or continue' : playing ? 'Assembling this stage…' : 'Paused — drag to inspect'}</span><label className="auto-advance"><input type="checkbox" checked={autoAdvance} onChange={e => setAutoAdvance(e.target.checked)}/>Auto-advance</label></div>
      </div>
      <aside className="build-instruction" aria-labelledby="build-step-title">
        <div className="eyebrow">SEGMENT {String(index + 1).padStart(2, '0')} OF {String(steps.length).padStart(2, '0')}</div>
        <div aria-live="polite"><h3 id="build-step-title">{stage.title}</h3><p className="build-subtitle">{stage.subtitle}</p><div className="build-metric"><Layers3 size={15}/>{stage.metric}</div></div>
        {parts.length > 0 && <div className="build-parts" aria-label="Pieces for this segment">{parts.map(part => <div key={part.label}><Cuboid size={20}/><strong>{part.count}<small>×</small></strong><span>{part.label}</span></div>)}</div>}
        {stage.id === 'supports' && unresolvedSupports.length > 0 && <p className="build-unresolved" role="note">Support details are unresolved for the {unresolvedSupports.join(' and ')}. The missing support is an allowance in the estimate; resolve that detail before following the framing stages.</p>}
        <ol className="build-tasks">{stage.tasks.map((task, i) => <li key={task}><span>{i + 1}</span><p>{task}</p></li>)}</ol>
        <p className="build-stage-note">{stage.note}</p>
        <div className="build-navigation"><button type="button" className="button button-outline" disabled={index === 0} onClick={() => chooseStep(index - 1)}><ArrowLeft size={15}/>Previous</button>{index < steps.length - 1 ? <button type="button" className="button button-primary" onClick={() => chooseStep(index + 1)}>Next segment<ArrowRight size={15}/></button> : <button type="button" className="button button-primary" onClick={onChecks}><Check size={15}/>Review checks</button>}</div>
      </aside>
    </div>
    <div className="build-footnote"><ListChecks size={17}/><p>Install the specified hardware as you assemble each part. The fastener segment is a final inspection, and the animation shows an assembly concept.</p><button type="button" className="text-button" onClick={onChecks}>Planning checks<ArrowRight size={14}/></button></div>
  </section>
}
