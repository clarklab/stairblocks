import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Grid, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { calculatePlan } from '../lib/planner';

export type StairSceneConfig = {
  rise: number;
  run: number;
  width: number;
  risers: number;
  material: 'treated' | 'cedar' | 'composite';
  tread: 'two6' | 'one12';
  ending: 'open' | 'planter' | 'turn';
  railing: boolean;
  closedRisers: boolean;
};

type Props = {
  config: StairSceneConfig;
  view: 'finished' | 'framing' | 'fasteners' | 'exploded';
  dimensions: boolean;
  resetKey: number;
  cameraView: 'perspective' | 'side' | 'top';
};

type Point = [number, number, number];
type Materials = {
  wood: THREE.MeshStandardMaterial;
  finish: THREE.MeshStandardMaterial;
  planter: THREE.MeshStandardMaterial;
  tread: THREE.MeshStandardMaterial;
  riser: THREE.MeshStandardMaterial;
  blocking: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  porch: THREE.MeshStandardMaterial;
  hardware: THREE.MeshStandardMaterial;
};

const IN = 1 / 12;
const POST = 3.5 * IN;
const STRINGER = 1.5 * IN;
const PORCH_DEPTH = 27 * IN;

function makeWoodTexture(material: StairSceneConfig['material']) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = material === 'cedar' ? '#bd9169' : material === 'composite' ? '#a09889' : '#c6b18a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Seeded strokes keep grain stable when the model is rebuilt.
  let seed = 531;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 175; i++) {
    const y = random() * 128;
    const amplitude = material === 'composite' ? 0.4 : 1 + random() * 3.5;
    ctx.strokeStyle = i % 4 === 0 ? 'rgba(255,244,220,0.14)' : `rgba(77,52,29,${0.025 + random() * 0.085})`;
    ctx.lineWidth = random() * 1.1 + 0.3;
    ctx.beginPath();
    for (let x = 0; x <= 1024; x += 16) {
      const offset = Math.sin(x / (55 + (i % 9) * 20) + i) * amplitude;
      if (x === 0) ctx.moveTo(x, y + offset);
      else ctx.lineTo(x, y + offset);
    }
    ctx.stroke();
  }
  if (material !== 'composite') {
    for (let i = 0; i < 5; i++) {
      const x = random() * 1024;
      const y = random() * 128;
      for (let ring = 0; ring < 4; ring++) {
        ctx.beginPath();
        ctx.ellipse(x, y, 10 + ring * 10, 1.5 + ring * 1.8, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(88,62,37,0.045)';
        ctx.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function useMaterials(material: StairSceneConfig['material'], view: Props['view']): Materials {
  const texture = useMemo(() => makeWoodTexture(material), [material]);
  const framingTexture = useMemo(() => makeWoodTexture('treated'), []);
  const cedarTexture = useMemo(() => makeWoodTexture('cedar'), []);
  const materials = useMemo(() => {
    const framing = view === 'framing';
    return {
      wood: new THREE.MeshStandardMaterial({ map: framingTexture, color: '#f2e6d6', roughness: 0.82 }),
      finish: new THREE.MeshStandardMaterial({ map: texture, color: '#f2e6d6', roughness: 0.82 }),
      planter: new THREE.MeshStandardMaterial({ map: cedarTexture, color: '#f5e6d4', roughness: 0.82 }),
      tread: new THREE.MeshStandardMaterial({
        map: texture, color: '#fff7e9', roughness: 0.77,
        transparent: framing, opacity: framing ? 0.38 : 1, depthWrite: !framing,
      }),
      riser: new THREE.MeshStandardMaterial({
        map: texture, color: '#e6d8c3', roughness: 0.85,
        transparent: framing, opacity: framing ? 0.18 : 1, depthWrite: !framing,
      }),
      blocking: new THREE.MeshStandardMaterial({
        map: framingTexture, color: framing ? '#a4b89c' : '#e6d6b8', roughness: 0.85,
      }),
      metal: new THREE.MeshStandardMaterial({
        color: view === 'fasteners' ? '#c87940' : '#9ba19a', metalness: 0.65, roughness: 0.42,
      }),
      porch: new THREE.MeshStandardMaterial({ map: texture, color: '#c7cac0', roughness: 0.9 }),
      hardware: new THREE.MeshStandardMaterial({
        color: view === 'fasteners' ? '#d97e35' : '#66665a', metalness: 0.65, roughness: 0.55,
      }),
    };
  }, [texture, framingTexture, cedarTexture, view]);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => () => { framingTexture.dispose(); cedarTexture.dispose(); }, [framingTexture, cedarTexture]);
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);
  return materials;
}

function Board({ position, size, material, rotation }: {
  position: Point;
  size: Point;
  material: THREE.Material;
  rotation?: Point;
}) {
  return (
    <mesh position={position} rotation={rotation} material={material} castShadow receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  );
}

function Beam({ from, to, width, depth, material }: {
  from: Point; to: Point; width: number; depth: number; material: THREE.Material;
}) {
  const { midpoint, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    return {
      midpoint: a.clone().add(b).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()),
      length: direction.length(),
    };
  }, [from.join(','), to.join(',')]);
  return (
    <mesh position={midpoint} quaternion={quaternion} material={material} castShadow receiveShadow>
      <boxGeometry args={[width, length, depth]} />
    </mesh>
  );
}

function Stringer({ x, risers, stepRise, stepRun, treadThickness, material }: {
  x: number; risers: number; stepRise: number; stepRun: number; treadThickness: number; material: THREE.Material;
}) {
  const geometry = useMemo(() => {
    const count = risers - 1;
    const length = count * stepRun;
    const slope = stepRise / stepRun;
    const depth = 11.25 * IN * Math.sqrt(1 + slope * slope);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0, stepRise - treadThickness);
    for (let i = 0; i < count; i++) {
      shape.lineTo((i + 1) * stepRun, (i + 1) * stepRise - treadThickness);
      shape.lineTo((i + 1) * stepRun, (i + 2) * stepRise - treadThickness);
    }
    const rearBottom = Math.max(0, risers * stepRise - treadThickness - depth);
    shape.lineTo(length, rearBottom);
    shape.lineTo(Math.min(length, Math.max(0, length - rearBottom / slope)), 0);
    shape.closePath();
    const result = new THREE.ExtrudeGeometry(shape, { depth: STRINGER, bevelEnabled: false, curveSegments: 1 });
    result.rotateY(Math.PI / 2);
    result.translate(-STRINGER / 2, 0, length);
    result.computeVertexNormals();
    return result;
  }, [risers, stepRise, stepRun, treadThickness]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh position={[x, 0, 0]} geometry={geometry} material={material} castShadow receiveShadow />;
}

function Screws({ positions, material, highlighted, front = false }: {
  positions: Point[]; material: THREE.Material; highlighted: boolean; front?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const matrix = new THREE.Matrix4();
    positions.forEach(([x, y, z], index) => {
      matrix.makeRotationX(front ? Math.PI / 2 : 0);
      matrix.setPosition(x, y, z);
      ref.current!.setMatrixAt(index, matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [positions, front]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, positions.length]} material={material}>
      <cylinderGeometry args={[highlighted ? 0.027 : 0.014, highlighted ? 0.027 : 0.014, 0.009, 8]} />
    </instancedMesh>
  );
}

function Railing({ width, run, height, stepRise, materials, exploded = false }: {
  width: number; run: number; height: number; stepRise: number; materials: Materials; exploded?: boolean;
}) {
  const bottomZ = Math.max(0.12, run - 0.23);
  const topZ = -0.17;
  const bottomY = stepRise;
  const railHeight = 35 * IN;
  const pickets = Math.max(1, Math.floor((bottomZ - topZ) / (4.5 * IN)));
  return <group>{[-1, 1].map((side) => {
    const x = side * (width / 2 + POST / 2 - 0.035 + (exploded ? 1.05 : 0));
    return <group key={side} position={[0, exploded ? 0.4 : 0, 0]}>
      {[[bottomZ, bottomY], [topZ, height]].map(([z, base], index) => (
        <group key={index}>
          <Board position={[x, (base + railHeight + 0.15) / 2, z]} size={[POST, base + railHeight + 0.15, POST]} material={materials.finish} />
          <Board position={[x, base + railHeight + 0.18, z]} size={[POST + 0.055, 0.055, POST + 0.055]} material={materials.finish} />
          {[base - 0.11, base - 0.28].filter((y) => y > 0).map((y) => (
            <mesh key={y} position={[x + side * (POST / 2 + 0.007), y, z]} rotation={[0, 0, Math.PI / 2]} material={materials.hardware}>
              <cylinderGeometry args={[0.027, 0.027, 0.012, 6]} />
            </mesh>
          ))}
        </group>
      ))}
      <Beam from={[x, bottomY + railHeight, bottomZ + 0.05]} to={[x, height + railHeight, topZ - 0.05]} width={3.5 * IN} depth={1.5 * IN} material={materials.finish} />
      <Beam from={[x, bottomY + 0.42, bottomZ]} to={[x, height + 0.42, topZ]} width={1.5 * IN} depth={2.5 * IN} material={materials.finish} />
      {Array.from({ length: pickets }, (_, i) => {
        const t = (i + 1) / (pickets + 1);
        const y = bottomY + (height - bottomY) * t;
        return <Board key={i} position={[x, y + (railHeight + 0.42) / 2, bottomZ + (topZ - bottomZ) * t]} size={[0.07, railHeight - 0.48, 0.07]} material={materials.finish} />;
      })}
    </group>;
  })}</group>;
}

function Flight({ config, materials, view, risers, stepRun, stepRise, showLabels = true }: {
  config: StairSceneConfig; materials: Materials; view: Props['view']; risers: number; stepRun: number; stepRise: number; showLabels?: boolean;
}) {
  const { geometry } = useMemo(() => calculatePlan(config), [config]);
  const count = Math.max(0, risers - 1);
  const width = config.width * IN;
  const run = count * stepRun;
  const thickness = geometry.treadThickness * IN;
  const height = risers * stepRise;
  const stringerCount = geometry.stringerCount;
  const stringerXs = geometry.stringerPositions.map((x) => x * IN - width / 2);
  const boardDepth = geometry.boardWidth * IN;
  const boardCount = geometry.boardsPerTread;
  const gap = geometry.boardGap * IN;
  const exploded = view === 'exploded';
  const lift = exploded ? 1.4 : view === 'framing' ? 0.32 : 0;
  const spread = exploded ? 1.42 : 1;
  const plankOffset = (b: number) => exploded ? (b - (boardCount - 1) / 2) * 0.38 : 0;
  const steps = Array.from({ length: count }, (_, i) => ({ y: (i + 1) * stepRise, z: (count - i) * stepRun }));
  const fasteners = useMemo(() => {
    const result: Point[] = [];
    steps.forEach(({ y, z }) => {
      for (let b = 0; b < boardCount; b++) {
        const boardZ = z + 0.055 - boardDepth / 2 - b * (boardDepth + gap) - plankOffset(b);
        stringerXs.forEach((x) => {
          result.push([x, y + lift + 0.006, boardZ - boardDepth * 0.29]);
          result.push([x, y + lift + 0.006, boardZ + boardDepth * 0.29]);
        });
      }
    });
    return result;
  }, [count, stepRise, stepRun, boardCount, boardDepth, stringerCount, width, lift, exploded]);
  const riserFasteners = useMemo(() => {
    if (!config.closedRisers) return [];
    const result: Point[] = [];
    for (let step = 0; step < risers; step++) {
      const top = (step + 1) * stepRise - thickness + (exploded ? 0.25 : step === risers - 1 ? 0 : lift * 0.45);
      const z = (risers - 1 - step) * stepRun - (step === risers - 1 ? 0.025 : 0.045) + 0.036 + (exploded ? 1.08 : step === risers - 1 ? 0 : lift * 0.6);
      stringerXs.forEach((x) => {
        result.push([x, top - 0.09, z]);
        result.push([x, top - (stepRise - thickness) + 0.09, z]);
      });
    }
    return result;
  }, [config.closedRisers, risers, stepRise, stepRun, thickness, exploded, lift, stringerCount, width]);
  if (count === 0) return null;
  const blockingRows = Math.max(2, Math.ceil(run / 4) + 1);
  const blockingLocations = Array.from({ length: blockingRows }, (_, i) => {
    const z = 0.16 + (run - 0.32) * i / (blockingRows - 1);
    return { z, index: Math.min(count - 1, Math.max(0, count - 1 - Math.floor(z / stepRun))) };
  });
  return <group>
    {stringerXs.map((x) => <Stringer key={x} x={x * spread} risers={risers} stepRise={stepRise} stepRun={stepRun} treadThickness={thickness} material={materials.wood} />)}
    {steps.map(({ y, z }, i) => <group key={i}>
      {Array.from({ length: boardCount }, (_, b) => <Board key={b}
        position={[0, y - thickness / 2 + lift, z + 0.055 - boardDepth / 2 - b * (boardDepth + gap) - plankOffset(b)]}
        size={[width, thickness, boardDepth]} material={materials.tread} />)}
      {config.closedRisers && <Board position={[0, y - thickness - (stepRise - thickness) / 2 + (exploded ? 0.25 : lift * 0.45), z - 0.045 + (exploded ? 1.08 : lift * 0.6)]}
        size={[width - 0.07, stepRise - thickness, 0.0625]} material={materials.riser} />}
    </group>)}
    {config.closedRisers && <Board position={[0, height - thickness - (stepRise - thickness) / 2 + (exploded ? 0.25 : 0), -0.025 + (exploded ? 1.08 : 0)]}
      size={[width - 0.07, stepRise - thickness, 0.0625]} material={materials.riser} />}
    {blockingLocations.map(({ index, z }, row) => stringerXs.slice(0, -1).map((x, j) => {
      const step = steps[index];
      const h = Math.max(0.01, Math.min(5.5 * IN, step.y - thickness - 0.025));
      return <Board key={`${row}-${j}`} position={[(x + stringerXs[j + 1]) / 2 * spread, step.y - thickness - h / 2 + (exploded ? 0.55 : 0), z - (exploded ? 0.82 : 0)]}
        size={[stringerXs[j + 1] - x - STRINGER, h, STRINGER]} material={materials.blocking} />;
    }))}
    {stringerXs.map((originalX, i) => {
      const x = originalX * spread;
      return <group key={`connector-${i}`}>
      <Board position={[x + STRINGER / 2 + 0.012, height - 0.36, 0.055]} size={[0.024, 0.39, 0.3]} material={materials.metal} />
      <Board position={[x, height - 0.53, 0.055]} size={[STRINGER + 0.025, 0.024, 0.3]} material={materials.metal} />
      {[0, 1].map((j) => <mesh key={j} position={[x + STRINGER / 2 + 0.029, height - 0.25 - j * 0.16, 0.065]} rotation={[0, 0, Math.PI / 2]} material={materials.hardware}>
        <cylinderGeometry args={[0.021, 0.021, 0.014, 8]} />
      </mesh>)}
    </group>;
    })}
    <Screws positions={fasteners} material={materials.hardware} highlighted={view === 'fasteners'} />
    <Screws positions={riserFasteners} material={materials.hardware} highlighted={view === 'fasteners'} front />
    {config.railing && <Railing width={width} run={run} height={height} stepRise={stepRise} materials={materials} exploded={exploded} />}
    {exploded && showLabels && <group>
      <ExplodedLabel from={[stringerXs[0] * spread, height * 0.37, run * 0.53]} to={[-width / 2 - 1.18, height * 0.45, run * 0.62]} label="1 · Notched stringers" />
      <ExplodedLabel from={[-width / 2 + 0.15, height - stepRise + lift, stepRun * 0.5]} to={[-width / 2 - 0.6, height + 1.8, -0.03]} label="2 · Tread planks" />
      {config.closedRisers && <ExplodedLabel from={[width / 2, stepRise * 0.5 + 0.25, run + 1.02]} to={[width / 2 + 0.53, stepRise * 0.5 + 0.35, run + 1.24]} label="3 · Riser boards" />}
      <ExplodedLabel from={[width * 0.2, height - stepRise - 0.1, -0.48]} to={[width / 2 + 0.83, height + 0.38, -0.9]} label="4 · Back bracing / blocking" />
      {stringerXs.map((x, i) => <Line key={`guide-${i}`} points={[[x, height * 0.35, run * 0.55], [x * spread, height * 0.35, run * 0.55]]} color="#9ba591" lineWidth={0.7} dashed dashSize={0.055} gapSize={0.045} transparent opacity={0.6} />)}
    </group>}
  </group>;
}

function Platform({ width, depth, height, materials, existing = false, deckGap = 0.125 * IN, deckThickness = 1.5 * IN, boardCount }: {
  width: number; depth: number; height: number; materials: Materials; existing?: boolean; deckGap?: number; deckThickness?: number; boardCount?: number;
}) {
  const material = existing ? materials.porch : materials.wood;
  const boards = boardCount ?? Math.max(1, Math.ceil((depth + deckGap) / (5.5 * IN + deckGap)));
  const plankDepth = 5.5 * IN;
  const boardWidths = Array.from({ length: boards }, (_, i) => i === boards - 1 ? depth - (boards - 1) * (plankDepth + deckGap) : plankDepth);
  // Share a narrow edge remainder across the last two boards instead of drawing a zero-width strip.
  if (boards > 1 && boardWidths[boards - 1] < 1.5 * IN) {
    const shared = (boardWidths[boards - 2] + boardWidths[boards - 1]) / 2;
    boardWidths[boards - 2] = shared;
    boardWidths[boards - 1] = shared;
  }
  const support = existing ? POST : 5.5 * IN;
  const frameDepth = existing ? 0.45 : 7.25 * IN;
  return <group>
    {Array.from({ length: boards }, (_, i) => {
      const actualDepth = boardWidths[i];
      const start = boardWidths.slice(0, i).reduce((sum, value) => sum + value, 0) + i * deckGap;
      return <Board key={i} position={[0, height - deckThickness / 2, -depth + start + actualDepth / 2]}
        size={[width + 0.055, deckThickness, actualDepth]} material={existing ? materials.porch : materials.finish} />;
    })}
    <Board position={[0, height - deckThickness - frameDepth / 2, -0.05]} size={[width, frameDepth, 0.12]} material={material} />
    <Board position={[0, height - deckThickness - frameDepth / 2, -depth + 0.05]} size={[width, frameDepth, 0.12]} material={material} />
    {[-1, 1].map((side) => <group key={side}>
      <Board position={[side * (width / 2 - 0.06), height - deckThickness - frameDepth / 2, -depth / 2]} size={[0.12, frameDepth, depth]} material={material} />
      <Board position={[side * (width / 2 - 0.3), (height - 0.15) / 2, -depth + 0.3]} size={[support, Math.max(0.05, height - 0.15), support]} material={material} />
      {!existing && <Board position={[side * (width / 2 - 0.3), (height - 0.15) / 2, -0.3]} size={[support, Math.max(0.05, height - 0.15), support]} material={material} />}
    </group>)}
    {height > 1.2 && <Beam from={[-width / 2 + 0.17, 0.18, -depth + 0.18]} to={[width / 2 - 0.17, height - 0.45, -depth + 0.18]} width={3.5 * IN} depth={1.5 * IN} material={existing ? materials.porch : materials.blocking} />}
  </group>;
}

function Planter({ position, materials }: { position: Point; materials: Materials }) {
  return <group position={position}>
    {Array.from({ length: 3 }, (_, row) => <group key={row}>
      {[-1, 1].map((side) => <group key={side}>
        <Board position={[0, 0.24 + row * 0.47, side * 0.719]} size={[1.5, 5.5 * IN, 0.0625]} material={materials.planter} />
        <Board position={[side * 0.719, 0.24 + row * 0.47, 0]} size={[0.0625, 5.5 * IN, 1.375]} material={materials.planter} />
      </group>)}
    </group>)}
    {[-1, 1].map((side) => <group key={side}>
      <Board position={[0, 1.435, side * 0.719]} size={[1.59, 0.065, 0.15]} material={materials.planter} />
      <Board position={[side * 0.719, 1.435, 0]} size={[0.15, 0.065, 1.29]} material={materials.planter} />
    </group>)}
    <mesh position={[0, 1.31, 0]}><boxGeometry args={[1.37, 0.09, 1.37]} /><meshStandardMaterial color="#635546" roughness={1} /></mesh>
    {Array.from({ length: 15 }, (_, i) => {
      const angle = i * 2.39996;
      const radius = 0.14 + (i % 3) * 0.12;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      return <mesh key={i} position={[x, 1.5 + (i % 4) * 0.065, z]} rotation={[Math.sin(angle) * 0.7, angle, Math.cos(angle) * 0.7]} scale={[0.125, 0.43 + (i % 3) * 0.07, 0.09]} castShadow>
        <sphereGeometry args={[1, 7, 6]} />
        <meshStandardMaterial color={['#5c7452', '#799061', '#8c9b71'][i % 3]} roughness={0.9} />
      </mesh>;
    })}
  </group>;
}

function Dimension({ from, to, label, labelOffset = [0, 0, 0], tick = [0, 0.055, 0] }: {
  from: Point; to: Point; label: string; labelOffset?: Point; tick?: Point;
}) {
  const midpoint: Point = [(from[0] + to[0]) / 2 + labelOffset[0], (from[1] + to[1]) / 2 + labelOffset[1], (from[2] + to[2]) / 2 + labelOffset[2]];
  const tip = (p: Point, s: number): Point => [p[0] + tick[0] * s, p[1] + tick[1] * s, p[2] + tick[2] * s];
  return <group>
    <Line points={[from, to]} color="#7d897e" lineWidth={0.9} transparent opacity={0.72} />
    <Line points={[tip(from, -1), tip(from, 1)]} color="#7d897e" lineWidth={1.2} />
    <Line points={[tip(to, -1), tip(to, 1)]} color="#7d897e" lineWidth={1.2} />
    <SceneLabel position={midpoint} text={label} />
  </group>;
}

/** WebGL sprites avoid a nested React DOM root for every diagram annotation. */
function SceneLabel({ position, text, emphasized = false }: { position: Point; text: string; emphasized?: boolean }) {
  const sprite = useRef<THREE.Sprite>(null);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const label = useMemo(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const fontSize = emphasized ? 10.5 : 11;
    const font = `${emphasized ? 600 : 500} ${fontSize}px Arial, sans-serif`;
    context.font = font;
    const width = Math.ceil(context.measureText(text).width + 19);
    const height = 27;
    const resolution = 3;
    canvas.width = width * resolution;
    canvas.height = height * resolution;
    context.scale(resolution, resolution);
    context.beginPath();
    context.roundRect(0.5, 0.5, width - 1, height - 1, 4);
    context.fillStyle = 'rgba(248,250,241,0.98)';
    context.fill();
    context.strokeStyle = emphasized ? '#c9d3be' : '#d6ddce';
    context.lineWidth = 0.8;
    context.stroke();
    context.font = font;
    context.fillStyle = emphasized ? '#526448' : '#65725b';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2 + 0.4);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return { texture, width, height };
  }, [text, emphasized]);
  useEffect(() => () => label.texture.dispose(), [label]);
  useFrame(({ camera, size }) => {
    if (!sprite.current) return;
    sprite.current.getWorldPosition(projected);
    projected.applyMatrix4(camera.matrixWorldInverse);
    const perspective = camera as THREE.PerspectiveCamera;
    const worldPerPixel = 2 * Math.max(0.1, -projected.z) * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2)) / Math.max(1, size.height);
    sprite.current.scale.set(label.width * worldPerPixel, label.height * worldPerPixel, 1);
  });
  return <sprite ref={sprite} position={position} renderOrder={100}>
    <spriteMaterial map={label.texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
  </sprite>;
}

function DetailLabel({ position, children }: { position: Point; children: string }) {
  return <SceneLabel position={position} text={children} emphasized />;
}

function ExplodedLabel({ from, to, label }: { from: Point; to: Point; label: string }) {
  return <group>
    <Line points={[from, to]} color="#879779" lineWidth={0.85} dashed dashSize={0.07} gapSize={0.05} />
    <mesh position={from}><sphereGeometry args={[0.025, 8, 6]} /><meshBasicMaterial color="#728166" /></mesh>
    <SceneLabel position={to} text={label} emphasized />
  </group>;
}

function SceneContent({ config: inputConfig, view, dimensions, resetKey, cameraView }: Props) {
  const plan = useMemo(() => calculatePlan(inputConfig), [inputConfig]);
  const config = plan.config;
  const geometry = plan.geometry;
  const materials = useMaterials(config.material, view);
  const width = config.width * IN;
  const height = config.rise * IN;
  const risers = Math.max(2, Math.round(config.risers));
  const stepRise = geometry.riserHeight * IN;
  const stepRun = geometry.going * IN;
  const run = config.run * IN;
  const isTurn = config.ending === 'turn';
  const lowerRisers = geometry.lowerRisers;
  const upperRisers = geometry.upperRisers;
  const lowerRun = geometry.lowerRun * IN;
  const upperRun = geometry.upperRun * IN;
  const landingHeight = lowerRisers * stepRise;
  const landingWidth = isTurn ? geometry.landingSize * IN : width;
  const front = isTurn ? landingWidth / 2 + lowerRun : run;
  const exploded = view === 'exploded';
  const invalidRise = geometry.riserHeight <= geometry.treadThickness;
  const footprint = useMemo(() => {
    const sideExtra = config.ending === 'planter' ? 1.75 : exploded ? 1.6 : 0.4;
    return {
      min: new THREE.Vector3(isTurn ? -landingWidth / 2 - upperRun - PORCH_DEPTH - 0.5 : -width / 2 - sideExtra, -0.1, isTurn ? -landingWidth / 2 - (exploded ? 1.6 : 0) : -PORCH_DEPTH),
      max: new THREE.Vector3(landingWidth / 2 + sideExtra, height + (config.railing ? exploded ? 3.55 : 3.15 : exploded ? 1.9 : 0.22), front + (exploded ? 1.65 : 1.2)),
    };
  }, [width, height, front, upperRun, isTurn, config.ending, config.railing, exploded, landingWidth]);

  return <>
    <ambientLight intensity={0.72} />
    <hemisphereLight args={['#fffaf1', '#bdc1ab', 1.35]} />
    <directionalLight position={[4, 8, 5]} intensity={2.1} color="#fff7e6" castShadow shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12}
      shadow-normalBias={0.035} shadow-bias={-0.0002} />
    <directionalLight position={[-5, 4, -5]} intensity={0.9} color="#e4ebe7" />
    {!invalidRise && <group>
      {isTurn ? <>
        <group position={[0, 0, landingWidth / 2]}>
          <Flight config={config} materials={materials} view={view} risers={lowerRisers} stepRun={stepRun} stepRise={stepRise} />
        </group>
        <group position={[0, 0, landingWidth / 2]}>
          <Platform width={landingWidth} depth={landingWidth} height={landingHeight} materials={materials} deckGap={geometry.landingBoardGap * IN} boardCount={geometry.landingDeckBoards} deckThickness={geometry.treadThickness * IN} />
        </group>
        <group position={[-landingWidth / 2 - upperRun, landingHeight, 0]} rotation={[0, Math.PI / 2, 0]}>
          <Flight config={config} materials={materials} view={view} risers={upperRisers} stepRun={stepRun} stepRise={stepRise} showLabels={false} />
        </group>
        <group position={[-landingWidth / 2 - upperRun, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <Platform width={width} depth={PORCH_DEPTH} height={height} materials={materials} existing />
        </group>
      </> : <>
        <Platform width={width} depth={PORCH_DEPTH} height={height} materials={materials} existing />
        <Flight config={config} materials={materials} view={view} risers={risers} stepRun={stepRun} stepRise={stepRise} />
      </>}
      {config.ending === 'planter' && [-1, 1].map((side) => <Planter key={side} position={[side * (width / 2 + 0.88), 0, run - 0.05]} materials={materials} />)}
      <mesh position={[0, -0.065, front + 0.44]} receiveShadow>
        <boxGeometry args={[width + 0.7, 0.1, 1.15]} />
        <meshStandardMaterial color="#d9d9cc" roughness={0.95} />
      </mesh>
    </group>}
    {invalidRise && <group>
      <SceneLabel position={[0, height + 0.45, run * 0.3]} text="These rises are too short for the tread boards." emphasized />
      <SceneLabel position={[0, height + 0.1, run * 0.3]} text="Use fewer risers or increase the total rise." />
    </group>}
    {dimensions && <group>
      <Dimension from={[-width / 2, 0.055, front + 1.09]} to={[width / 2, 0.055, front + 1.09]} label={`${config.width}″ wide`} labelOffset={[0, 0.07, 0]} />
      {!isTurn && <>
        <Dimension from={[width / 2 + 0.66, 0.04, 0]} to={[width / 2 + 0.66, 0.04, run]} label={`${config.run}″ run`} labelOffset={[0.07, 0.07, 0]} />
        <Dimension from={[-width / 2 - 0.57, 0.02, -0.07]} to={[-width / 2 - 0.57, height, -0.07]} label={`${config.rise}″ rise`} labelOffset={[-0.1, 0, 0]} tick={[0.07, 0, 0]} />
      </>}
      {isTurn && <>
        <Dimension from={[width / 2 + 0.66, 0.04, landingWidth / 2]} to={[width / 2 + 0.66, 0.04, front]} label={`${Number(geometry.lowerRun.toFixed(1))}″ lower run`} labelOffset={[0.1, 0.08, 0]} />
        <Dimension from={[-landingWidth / 2 - upperRun, landingHeight + 0.07, width / 2 + 0.52]} to={[-landingWidth / 2, landingHeight + 0.07, width / 2 + 0.52]} label={`${Number(geometry.upperRun.toFixed(1))}″ upper run`} labelOffset={[0, 0.11, 0]} />
        <Dimension from={[-landingWidth / 2 - upperRun - PORCH_DEPTH - 0.34, 0.02, -0.05]} to={[-landingWidth / 2 - upperRun - PORCH_DEPTH - 0.34, height, -0.05]} label={`${config.rise}″ total rise`} labelOffset={[-0.08, 0, 0]} tick={[0.07, 0, 0]} />
        <Dimension from={[landingWidth / 2 + 0.45, landingHeight + 0.09, -landingWidth / 2]} to={[landingWidth / 2 + 0.45, landingHeight + 0.09, landingWidth / 2]} label={`${geometry.landingSize}″ landing`} labelOffset={[0.09, 0.09, 0]} />
      </>}
    </group>}
    {view === 'framing' && !isTurn && !invalidRise && <DetailLabel position={[width / 2 + 0.12, height * 0.54, run * 0.28]}>2 × 12 notched stringers</DetailLabel>}
    {view === 'fasteners' && !isTurn && !invalidRise && <DetailLabel position={[0, stepRise + 0.4, run + 0.12]}>2 exterior screws per board / support</DetailLabel>}
    <Grid position={[0, -0.115, 0]} args={[40, 40]} cellSize={1} sectionSize={5} cellThickness={0.45} sectionThickness={0.65}
      cellColor="#cbd0c4" sectionColor="#bbc3b5" fadeDistance={24} fadeStrength={2.5} infiniteGrid />
    <ContactShadows position={[0, -0.105, 1]} opacity={0.28} scale={30} blur={2.3} far={12} resolution={512} color="#64705b" frames={1} key={`${JSON.stringify(config)}-${view}`} />
    <CameraControls bounds={footprint} resetKey={resetKey} cameraView={cameraView} dimensions={dimensions} targetYOffset={view === 'framing' || exploded ? -0.2 : 0} />
  </>;
}

function CameraControls({ bounds, resetKey, cameraView, dimensions, targetYOffset }: {
  bounds: { min: THREE.Vector3; max: THREE.Vector3 }; resetKey: number; cameraView: Props['cameraView']; dimensions: boolean; targetYOffset: number;
}) {
  const { camera, size, invalidate } = useThree();
  const controls = useRef<any>(null);
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
    center.y += targetYOffset;
    const direction = cameraView === 'side'
      ? new THREE.Vector3(1, 0.18, 0.02).normalize()
      : cameraView === 'top' ? new THREE.Vector3(0.001, 1, 0.001).normalize()
        : new THREE.Vector3(1.32, 1.05, 1.75).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tanVertical = Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2));
    const tanHorizontal = tanVertical * (size.width / Math.max(1, size.height));
    let distance = 4;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const offset = new THREE.Vector3(x, y, z).sub(center);
          const depth = offset.dot(direction);
          distance = Math.max(distance, Math.abs(offset.dot(right)) / tanHorizontal + depth, Math.abs(offset.dot(up)) / tanVertical + depth);
        }
      }
    }
    distance *= dimensions ? 1.08 : 1.01;
    perspective.position.copy(center).addScaledVector(direction, distance);
    perspective.near = 0.05;
    perspective.far = 150;
    perspective.updateProjectionMatrix();
    perspective.lookAt(center);
    if (controls.current) {
      controls.current.target.copy(center);
      controls.current.update();
    }
    invalidate();
  }, [bounds, resetKey, cameraView, dimensions, targetYOffset, size.width, size.height, camera, invalidate]);
  return <OrbitControls ref={controls} makeDefault minDistance={2} maxDistance={45} maxPolarAngle={Math.PI / 2 - 0.025}
    enableDamping dampingFactor={0.085} rotateSpeed={0.65} zoomSpeed={0.8} panSpeed={0.75} />;
}

export default function StairScene(props: Props) {
  return <Canvas shadows camera={{ position: [8, 6, 10], fov: 40 }} dpr={[1, 1.7]}
    gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    style={{ width: '100%', height: '100%', touchAction: 'none' }}
    onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; }}>
    <Suspense fallback={null}><SceneContent {...props} /></Suspense>
  </Canvas>;
}
