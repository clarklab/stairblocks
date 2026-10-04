import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Color, PerspectiveCamera, Vector3 } from 'three';
import { calculatePlan } from '../lib/planner';
import type { StairConfig } from '../lib/planner';
import { buildStairGeometry } from '../lib/sceneGeometry';

type Point = [number, number, number];
type BuildStage = 'site' | 'supports' | 'stringers' | 'blocking' | 'risers' | 'treads' | 'fasteners' | 'complete';
type View = 'finished' | 'framing' | 'fasteners' | 'exploded';
type Props = {
  config: StairConfig;
  view: View;
  dimensions: boolean;
  resetKey: number;
  cameraView: 'perspective' | 'side' | 'top';
  buildStage?: BuildStage;
  animationKey?: number;
  onAnimationComplete?: () => void;
  animationPaused?: boolean;
};

const STAGES: BuildStage[] = ['site', 'supports', 'stringers', 'blocking', 'risers', 'treads', 'fasteners', 'complete'];
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const light = new Vector3(-0.4, 0.87, 0.55).normalize();

function useAnimation({ buildStage, animationKey = 0, animationPaused = false, onAnimationComplete }: Props, geometry: unknown) {
  const [progress, setProgress] = useState(1);
  const elapsed = useRef(0);
  const done = useRef(true);
  const callback = useRef(onAnimationComplete);
  const generation = useRef(0);
  const reducedMotion = useRef(false);
  callback.current = onAnimationComplete;

  useLayoutEffect(() => {
    generation.current += 1;
    elapsed.current = 0;
    done.current = !buildStage;
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setProgress(!buildStage || reducedMotion.current ? 1 : 0);
    if (buildStage && reducedMotion.current) {
      done.current = true;
      const id = generation.current;
      queueMicrotask(() => { if (generation.current === id) callback.current?.(); });
    }
    return () => { generation.current += 1; };
  }, [buildStage, animationKey, geometry]);

  useEffect(() => {
    if (!buildStage || animationPaused || done.current || reducedMotion.current) return;
    let frame = 0;
    let previous = performance.now();
    let lastPaint = previous - 34;
    const tick = (now: number) => {
      elapsed.current += Math.min(now - previous, 100);
      previous = now;
      if (elapsed.current >= 2000) {
        setProgress(1);
        done.current = true;
        callback.current?.();
        return;
      }
      if (now - lastPaint >= 1000 / 30) {
        setProgress(elapsed.current / 2000);
        lastPaint = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [buildStage, animationKey, geometry, animationPaused]);
  return progress;
}

function preset(view: Props['cameraView']) {
  return {
    yaw: view === 'side' ? Math.PI / 2 : view === 'top' ? 0 : 0.646,
    pitch: view === 'top' ? Math.PI / 2 - 0.002 : view === 'side' ? 0.13 : 0.45,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
}

function shadeColor(color: string, normal: Vector3) {
  const diffuse = Math.max(0, normal.dot(light));
  const brightness = 0.73 + diffuse * 0.34 + Math.max(0, normal.y) * 0.07;
  return `#${new Color(color).multiplyScalar(brightness).getHexString()}`;
}

type Label = { id: string; x: number; y: number; text: string; kind: 'dimension' | 'part' | 'note'; anchor?: { x: number; y: number } };

type Polygon = { id: string; vertices: Vector3[]; normal: Vector3; color: string; opacity: number; hardware: boolean; doubleSided?: boolean };
type BspNode = { normal?: Vector3; plane?: number; polygons: Polygon[]; front?: BspNode; back?: BspNode; fallback?: boolean };
const PLANE_EPSILON = 0.000015;

/** A bounded BSP painter resolves overlapping wide boards without a GPU depth buffer. */
function buildPainter(polygons: Polygon[]): BspNode {
  const budget = { count: polygons.length, limit: Math.min(12000, Math.max(1800, polygons.length * 3)), serial: 0 };
  const build = (items: Polygon[], depth: number): BspNode => {
    if (!items.length) return { polygons: [] };
    if (depth >= 40 || budget.count >= budget.limit) return { polygons: items, fallback: true };
    const candidates = items.length <= 10 ? [items[0]] : Array.from({ length: 9 }, (_, i) => items[Math.floor(i * (items.length - 1) / 8)]);
    let best = candidates[0], score = Infinity;
    for (const candidate of candidates) {
      const normal = candidate.normal, plane = normal.dot(candidate.vertices[0]);
      let front = 0, back = 0, split = 0, coplanar = 0;
      for (const item of items) {
        let positive = false, negative = false;
        for (const p of item.vertices) {
          const d = normal.dot(p) - plane;
          if (d > PLANE_EPSILON) positive = true;
          if (d < -PLANE_EPSILON) negative = true;
        }
        if (positive && negative) split++;
        else if (positive) front++;
        else if (negative) back++;
        else coplanar++;
      }
      const cost = split * 5 + Math.abs(front - back) * 0.45 - coplanar * 0.25 + (candidate.hardware ? 1 : 0);
      if (cost < score) { best = candidate; score = cost; }
    }
    const normal = best.normal, plane = normal.dot(best.vertices[0]);
    const front: Polygon[] = [], back: Polygon[] = [], coplanar: Polygon[] = [];
    for (const polygon of items) {
      const distances = polygon.vertices.map((p) => normal.dot(p) - plane);
      const positive = distances.some((d) => d > PLANE_EPSILON), negative = distances.some((d) => d < -PLANE_EPSILON);
      if (!positive && !negative) { coplanar.push(polygon); continue; }
      if (!negative) { front.push(polygon); continue; }
      if (!positive) { back.push(polygon); continue; }
      if (++budget.count >= budget.limit) return { polygons: items, fallback: true };
      const a: Vector3[] = [], b: Vector3[] = [];
      polygon.vertices.forEach((point, index) => {
        const nextIndex = (index + 1) % polygon.vertices.length;
        const distance = distances[index], nextDistance = distances[nextIndex];
        if (distance >= -PLANE_EPSILON) a.push(point);
        if (distance <= PLANE_EPSILON) b.push(point);
        if ((distance > PLANE_EPSILON && nextDistance < -PLANE_EPSILON) || (distance < -PLANE_EPSILON && nextDistance > PLANE_EPSILON)) {
          const intersection = point.clone().lerp(polygon.vertices[nextIndex], distance / (distance - nextDistance));
          a.push(intersection); b.push(intersection);
        }
      });
      const serial = budget.serial++;
      if (a.length >= 3) front.push({ ...polygon, id: `${polygon.id}f${serial}`, vertices: a });
      if (b.length >= 3) back.push({ ...polygon, id: `${polygon.id}b${serial}`, vertices: b });
    }
    return { normal, plane, polygons: coplanar, front: front.length ? build(front, depth + 1) : undefined, back: back.length ? build(back, depth + 1) : undefined };
  };
  return build(polygons, 0);
}

function orderedPolygons(node: BspNode, camera: PerspectiveCamera, output: Polygon[]) {
  if (node.fallback) {
    const depth = (polygon: Polygon) => polygon.vertices.reduce((sum, vertex) => sum - vertex.clone().applyMatrix4(camera.matrixWorldInverse).z, 0) / polygon.vertices.length;
    output.push(...node.polygons.map((polygon) => ({ polygon, depth: depth(polygon) })).sort((a, b) => b.depth - a.depth).map((item) => item.polygon));
    return;
  }
  const front = node.normal ? node.normal.dot(camera.position) >= (node.plane ?? 0) : true;
  const far = front ? node.back : node.front, near = front ? node.front : node.back;
  if (far) orderedPolygons(far, camera, output);
  output.push(...node.polygons);
  if (near) orderedPolygons(near, camera, output);
}

function fallbackPolygonCount(node: BspNode): number {
  if (node.fallback) return node.polygons.length;
  return (node.front ? fallbackPolygonCount(node.front) : 0) + (node.back ? fallbackPolygonCount(node.back) : 0);
}

export default function CpuStairScene(props: Props) {
  const { config, dimensions, resetKey, cameraView, buildStage } = props;
  const view = buildStage ? 'finished' : props.view;
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 900, height: 650 });
  const [orbit, setOrbit] = useState(() => preset(cameraView));
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const unique = useId().replace(/:/g, '');
  const geometry = useMemo(() => buildStairGeometry(config), [config]);
  const progress = useAnimation(props, geometry);
  const plan = useMemo(() => calculatePlan(config), [config]);
  const invalidRise = plan.geometry.riserHeight <= plan.geometry.treadThickness;
  const stageIndex = buildStage ? STAGES.indexOf(buildStage) : 7;
  const cameraShapeKey = [config.rise, config.run, config.width, config.risers, config.material, config.compositeTreads, config.sidePanel, config.returnCaps, config.tread, config.ending, config.railing, config.closedRisers].join('|');

  useLayoutEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setOrbit(preset(cameraView)); }, [cameraView, resetKey, view, cameraShapeKey]);

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setOrbit((current) => ({ ...current, zoom: clamp(current.zoom * Math.exp(event.deltaY * 0.001), 0.4, 3.3) }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  const prepared = useMemo(() => geometry.pieces.map((piece) => ({
    ...piece,
    faces: piece.faces.map((face) => {
      const vertices = face.vertices.map((p) => new Vector3(...p));
      const normal = vertices.length > 2 ? vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize() : new Vector3(0, 1, 0);
      const center = vertices.reduce((sum, vertex) => sum.add(vertex), new Vector3()).multiplyScalar(1 / vertices.length);
      return { vertices, center, normal, color: shadeColor(face.color, normal), doubleSided: face.doubleSided };
    }),
  })), [geometry]);

  const bounds = useMemo(() => {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    prepared.forEach((piece) => {
      const offset = view === 'exploded' ? new Vector3(...piece.explodedOffset) : new Vector3();
      piece.faces.forEach((face) => face.vertices.forEach((vertex) => {
        const p = vertex.clone().add(offset);
        min.min(p); max.max(p);
      }));
    });
    if (!Number.isFinite(min.x)) { min.set(-2, 0, -2); max.set(2, 3, 4); }
    min.add(new Vector3(-0.7, -0.05, -0.55));
    max.add(new Vector3(0.7, buildStage ? 1.5 : view === 'exploded' ? 0.55 : 0.2, 1.2));
    return { min, max };
  }, [prepared, view, Boolean(buildStage)]);

  const projection = useMemo(() => {
    const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
    if (view === 'framing' || view === 'exploded') center.y -= 0.14;
    const direction = new Vector3(Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), Math.cos(orbit.yaw) * Math.cos(orbit.pitch)).normalize();
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
    const up = new Vector3().crossVectors(direction, right).normalize();
    const camera = new PerspectiveCamera(40, size.width / size.height, 0.03, 200);
    const tanVertical = Math.tan(40 * Math.PI / 360);
    const tanHorizontal = tanVertical * size.width / size.height;
    let distance = 3;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const offset = new Vector3(x, y, z).sub(center);
      distance = Math.max(distance, Math.abs(offset.dot(right)) / tanHorizontal + offset.dot(direction), Math.abs(offset.dot(up)) / tanVertical + offset.dot(direction));
    }
    distance *= orbit.zoom * (dimensions ? 1.035 : 1);
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const project = (point: Vector3 | Point) => {
      const vertex = point instanceof Vector3 ? point.clone() : new Vector3(...point);
      const cameraSpace = vertex.clone().applyMatrix4(camera.matrixWorldInverse);
      if (cameraSpace.z > -0.025) return null;
      vertex.project(camera);
      return { x: (vertex.x + 1) * size.width / 2 + orbit.panX, y: (1 - vertex.y) * size.height / 2 + orbit.panY, depth: -cameraSpace.z };
    };
    return { camera, project, center };
  }, [bounds, orbit, size, dimensions, view]);

  const worldScene = useMemo(() => {
    const polygons: Polygon[] = [];
    const centers = new Map<string, { sum: Vector3; count: number }>();
    const visibleCategories = new Set<string>();
    const shadowMin = new Vector3(Infinity, 0, Infinity);
    const shadowMax = new Vector3(-Infinity, 0, -Infinity);
    const supportMin = shadowMin.clone(), supportMax = shadowMax.clone();
    const remaining = Math.pow(1 - progress, 3);
    prepared.forEach((piece) => {
      if (STAGES.indexOf(piece.stage as BuildStage) > stageIndex) return;
      if (invalidRise && piece.category !== 'concrete') return;
      visibleCategories.add(piece.category);
      const offset = new Vector3();
      if (view === 'exploded') offset.fromArray(piece.explodedOffset);
      else if (view === 'framing' && piece.category === 'tread') offset.set(0, 0.32, 0);
      else if (view === 'framing' && piece.category === 'riser') offset.set(0, 0.14, 0.2);
      if (buildStage && piece.stage === buildStage) offset.add(new Vector3(...(piece.assemblyOffset ?? piece.explodedOffset)).multiplyScalar(remaining));
      const opacity = view === 'framing' ? piece.category === 'tread' ? 0.24 : piece.category === 'riser' ? 0.14 : piece.category === 'rail' ? 0.28 : piece.category === 'skirt' ? 0.12 : 1 : 1;
      piece.faces.forEach((face, index) => {
        const center = face.center.clone().add(offset);
        const entry = centers.get(piece.category) ?? { sum: new Vector3(), count: 0 };
        entry.sum.add(center); entry.count += 1; centers.set(piece.category, entry);
        if (face.normal.lengthSq() < 0.5) return;
        const vertices = face.vertices.map((vertex) => vertex.clone().add(offset));
        const hardware = piece.category === 'hardware';
        let fill = face.color;
        if (hardware && (view === 'fasteners' || buildStage === 'fasteners')) fill = '#c87937';
        if (view === 'framing' && piece.category === 'blocking') fill = '#a2b196';
        polygons.push({ id: `${piece.id}-${index}`, vertices, normal: face.normal, color: fill, opacity, hardware, doubleSided: face.doubleSided });
        const min = view === 'exploded' && piece.category === 'support' ? supportMin : shadowMin;
        const max = view === 'exploded' && piece.category === 'support' ? supportMax : shadowMax;
        vertices.forEach((point) => { min.x = Math.min(min.x, point.x); min.z = Math.min(min.z, point.z); max.x = Math.max(max.x, point.x); max.z = Math.max(max.z, point.z); });
      });
    });
    const shadows = [[shadowMin, shadowMax], [supportMin, supportMax]].filter(([min]) => Number.isFinite(min.x)).map(([min, max]) => {
      const corners: Point[] = [[min.x, -0.02, min.z], [max.x, -0.02, min.z], [max.x, -0.02, max.z], [min.x, -0.02, max.z]];
      return corners;
    });
    const tree = buildPainter(polygons);
    return { tree, fallbackPolygons: fallbackPolygonCount(tree), centers, visibleCategories, shadows };
  }, [prepared, stageIndex, invalidRise, view, progress, buildStage]);

  const rendered = useMemo(() => {
    const ordered: Polygon[] = [];
    orderedPolygons(worldScene.tree, projection.camera, ordered);
    const faces = ordered.flatMap((polygon) => {
      if (polygon.opacity === 1 && !polygon.doubleSided && polygon.normal.dot(projection.camera.position.clone().sub(polygon.vertices[0])) < -0.0001) return [];
      const points = polygon.vertices.map(projection.project);
      if (points.some((p) => p === null)) return [];
      return [{ id: polygon.id, points: points.map((p) => `${p!.x.toFixed(2)},${p!.y.toFixed(2)}`).join(' '), fill: polygon.color, opacity: polygon.opacity, hardware: polygon.hardware }];
    });
    const shadows = worldScene.shadows.map((corners) => corners.map(projection.project).filter((p) => p !== null).map((p) => `${p.x},${p.y}`).join(' '));
    return { faces, shadows, centers: worldScene.centers, visibleCategories: worldScene.visibleCategories };
  }, [worldScene, projection]);

  const grid = useMemo(() => {
    const result: { id: string; x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    const span = Math.min(32, Math.max(12, bounds.max.distanceTo(bounds.min)));
    const cx = Math.round(projection.center.x), cz = Math.round(projection.center.z);
    for (let i = -Math.ceil(span); i <= Math.ceil(span); i++) {
      const segments: [Point, Point][] = [[[cx + i, -0.09, cz - span], [cx + i, -0.09, cz + span]], [[cx - span, -0.09, cz + i], [cx + span, -0.09, cz + i]]];
      segments.forEach(([from, to], axis) => {
        const a = projection.project(from), b = projection.project(to);
        if (a && b) result.push({ id: `${axis}-${i}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, major: i % 5 === 0 });
      });
    }
    return result;
  }, [bounds, projection]);

  const annotations = useMemo(() => {
    const labels: Label[] = [];
    const lines: { id: string; x1: number; y1: number; x2: number; y2: number; tickX: number; tickY: number }[] = [];
    if (dimensions && (!buildStage || stageIndex >= 2)) geometry.dimensions.forEach((dimension, index) => {
      const a = projection.project(dimension.from), b = projection.project(dimension.to);
      if (!a || !b) return;
      const length = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const tickX = -(b.y - a.y) / length * 4, tickY = (b.x - a.x) / length * 4;
      lines.push({ id: `d-${index}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, tickX, tickY });
      labels.push({ id: `d-${index}`, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, text: dimension.label, kind: 'dimension' });
    });
    geometry.labels.forEach((label, index) => {
      if (label.showIn && !label.showIn.includes(view)) return;
      if (!label.showIn && view !== 'exploded' && !(buildStage === 'site' && label.category === 'concrete')) return;
      if (label.category && !rendered.visibleCategories.has(label.category)) return;
      if (buildStage && label.kind === 'part' && view !== 'exploded') return;
      const point = projection.project(label.position);
      if (!point) return;
      const categoryCenter = label.category ? rendered.centers.get(label.category) : undefined;
      const anchor = categoryCenter ? projection.project(categoryCenter.sum.clone().multiplyScalar(1 / categoryCenter.count)) : null;
      labels.push({ id: `l-${index}`, x: point.x, y: point.y, text: label.text, kind: label.kind ?? 'part', anchor: anchor ?? undefined });
    });
    if (invalidRise) labels.push({ id: 'invalid', x: size.width / 2, y: size.height * 0.3, text: 'Use fewer risers or increase the total rise.', kind: 'note' });
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    return { lines, labels: labels.map((label) => {
      const width = Math.min(size.width - 24, Math.ceil(label.text.length * 5.7 + 22));
      const height = 25;
      let x = clamp(label.x, width / 2 + 10, size.width - width / 2 - 10);
      let y = clamp(label.y, 22, size.height - 24);
      for (const [dx, dy] of [[0, 0], [0, -30], [0, 30], [-65, 0], [65, 0], [0, -60], [0, 60]]) {
        const candidate = { x: clamp(x + dx, width / 2 + 10, size.width - width / 2 - 10), y: clamp(y + dy, 22, size.height - 24), w: width, h: height };
        if (!placed.some((p) => Math.abs(p.x - candidate.x) < (p.w + width) / 2 + 5 && Math.abs(p.y - candidate.y) < (p.h + height) / 2 + 5)) { x = candidate.x; y = candidate.y; break; }
      }
      placed.push({ x, y, w: width, h: height });
      return { ...label, x, y, width, height };
    }) };
  }, [dimensions, buildStage, stageIndex, geometry, projection, view, rendered, invalidRise, size]);

  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setDragging(true);
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const old = pointers.current.get(event.pointerId);
    if (!old) return;
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...pointers.current.values()];
    if (after.length >= 2) {
      const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
      const newDistance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
      setOrbit((current) => ({ ...current, zoom: clamp(current.zoom * oldDistance / Math.max(1, newDistance), 0.4, 3.3), panX: current.panX + (after[0].x + after[1].x - before[0].x - before[1].x) / 2, panY: current.panY + (after[0].y + after[1].y - before[0].y - before[1].y) / 2 }));
    } else {
      const dx = event.clientX - old.x, dy = event.clientY - old.y;
      setOrbit((current) => event.shiftKey || event.buttons === 2
        ? { ...current, panX: current.panX + dx, panY: current.panY + dy }
        : { ...current, yaw: current.yaw - dx * 0.007, pitch: clamp(current.pitch + dy * 0.005, 0.08, Math.PI / 2 - 0.002) });
    }
  };
  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!pointers.current.size) setDragging(false);
  };
  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { setOrbit(preset(cameraView)); return; }
    setOrbit((current) => ({ ...current,
      yaw: current.yaw + (event.key === 'ArrowLeft' ? 0.12 : event.key === 'ArrowRight' ? -0.12 : 0),
      pitch: clamp(current.pitch + (event.key === 'ArrowUp' ? 0.09 : event.key === 'ArrowDown' ? -0.09 : 0), 0.08, Math.PI / 2 - 0.002),
      zoom: clamp(current.zoom * (event.key === '+' || event.key === '=' ? 0.9 : event.key === '-' ? 1.1 : 1), 0.4, 3.3),
    }));
  };

  return <div ref={root} style={{ width: '100%', height: '100%', minHeight: 120 }}>
    <svg ref={svg} data-renderer="cpu-svg" data-animation-progress={progress.toFixed(3)} data-build-stage={buildStage ?? 'complete'} data-painter-fallback-polygons={worldScene.fallbackPolygons}
      role="img" aria-label="Interactive 3D stair model. Drag to rotate, pinch or scroll to zoom, and use two fingers or Shift-drag to pan. Arrow keys rotate; plus and minus zoom; Home resets the view."
      tabIndex={0} width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyDown={keyboard} onContextMenu={(event) => event.preventDefault()}
      style={{ display: 'block', touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none', overflow: 'hidden' }}>
      <title>Stairblocks interactive 3D stair model</title>
      <desc>Software-rendered with SVG. No WebGL or hardware acceleration is required. {buildStage ? `Build stage: ${buildStage}.` : `${plan.geometry.treadCount} treads, ${config.rise} inches total rise.`}</desc>
      <defs>
        <radialGradient id={`${unique}-fade`}><stop offset="0%" stopColor="white" stopOpacity=".9"/><stop offset="100%" stopColor="white" stopOpacity="0"/></radialGradient>
        <mask id={`${unique}-grid`}><rect width={size.width} height={size.height} fill={`url(#${unique}-fade)`}/></mask>
        <filter id={`${unique}-shadow`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="10"/></filter>
      </defs>
      <g mask={`url(#${unique}-grid)`} pointerEvents="none">{grid.map((line) => <line key={line.id} {...{ x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 }} stroke={line.major ? '#bfc8b5' : '#ccd3c3'} strokeWidth={line.major ? 0.65 : 0.45}/>)}</g>
      <g filter={size.width < 500 ? undefined : `url(#${unique}-shadow)`} fill="#64705a" opacity={size.width < 500 ? 0.055 : 0.17} pointerEvents="none">{rendered.shadows.map((points, index) => <polygon key={index} points={points}/>)}</g>
      <g strokeLinejoin="round" pointerEvents="none">{rendered.faces.map((face) => <polygon key={face.id} points={face.points} fill={face.fill} fillOpacity={face.opacity} stroke={face.fill} strokeOpacity={face.opacity} strokeWidth={face.hardware && view === 'fasteners' ? 0.7 : 0.3}/>)}</g>
      <g stroke="#829076" strokeWidth=".8" fill="none" pointerEvents="none">{annotations.lines.map((line) => <g key={line.id}>
        <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}/>
        <line x1={line.x1 - line.tickX} y1={line.y1 - line.tickY} x2={line.x1 + line.tickX} y2={line.y1 + line.tickY}/>
        <line x1={line.x2 - line.tickX} y1={line.y2 - line.tickY} x2={line.x2 + line.tickX} y2={line.y2 + line.tickY}/>
      </g>)}</g>
      <g pointerEvents="none">{annotations.labels.map((label) => <g key={label.id}>
        {label.anchor && label.kind === 'part' && <line x1={label.anchor.x} y1={label.anchor.y} x2={label.x} y2={label.y} stroke="#8a997d" strokeWidth=".8" strokeDasharray="3 3"/>}
        <rect x={label.x - label.width / 2} y={label.y - label.height / 2} width={label.width} height={label.height} rx="4" fill="#f8faf1" fillOpacity=".98" stroke="#d1d9c8" strokeWidth=".8"/>
        <text x={label.x} y={label.y + 0.5} textAnchor="middle" dominantBaseline="middle" fill={label.kind === 'part' ? '#526448' : '#65725b'} fontSize={label.kind === 'part' ? 10.5 : 11} fontWeight={label.kind === 'part' ? 600 : 500} fontFamily="Arial, sans-serif">{label.text}</text>
      </g>)}</g>
    </svg>
  </div>;
}
