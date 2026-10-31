import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Float, Lightformer, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

/**
 * هاتف ذكي ثلاثي الأبعاد مبني بالكامل بالكود (بدون نماذج خارجية):
 * هيكل معدني بانعكاسات بيئية، شاشة زجاجية مضيئة، وحدة كاميرات، وحركة دوران واقعية
 * تتفاعل مع المؤشر ومع التمرير.
 */

const W = 1.6;
const H = 3.3;
const D = 0.17;

function useScreenTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 1320;
    const g = c.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, 640, 1320);
    bg.addColorStop(0, '#0a1a44');
    bg.addColorStop(0.5, '#050b1f');
    bg.addColorStop(1, '#010309');
    g.fillStyle = bg;
    g.fillRect(0, 0, 640, 1320);

    const blob = (x: number, y: number, r: number, col: string) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 640, 1320);
    };
    blob(160, 420, 520, 'rgba(47,123,255,.85)');
    blob(560, 1080, 480, 'rgba(122,174,255,.45)');
    blob(420, 700, 300, 'rgba(20,73,180,.6)');

    // موجات ضوئية
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.strokeStyle = `rgba(122,174,255,${0.06 + i * 0.025})`;
      g.lineWidth = 2;
      for (let x = 0; x <= 640; x += 8) {
        const y = 820 + i * 34 + Math.sin(x / 90 + i * 0.7) * 60;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';

    g.fillStyle = '#eaf2ff';
    g.textAlign = 'center';
    g.font = '600 150px "Readex Pro", sans-serif';
    g.fillText('9:41', 320, 330);
    g.font = '400 34px "IBM Plex Sans Arabic", sans-serif';
    g.fillStyle = 'rgba(234,242,255,.7)';
    g.fillText(new Intl.DateTimeFormat('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()), 320, 392);

    // شعار الماس
    g.save();
    g.translate(320, 1100);
    g.beginPath();
    g.moveTo(-50, -38);
    g.lineTo(50, -38);
    g.lineTo(80, 0);
    g.lineTo(0, 70);
    g.lineTo(-80, 0);
    g.closePath();
    const lg = g.createLinearGradient(-80, -40, 80, 70);
    lg.addColorStop(0, '#d4e5ff');
    lg.addColorStop(0.5, '#4d8fff');
    lg.addColorStop(1, '#123c8c');
    g.fillStyle = lg;
    g.shadowColor = '#2f7bff';
    g.shadowBlur = 40;
    g.fill();
    g.restore();
    g.font = '700 46px "Readex Pro", sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText('الماس', 320, 1230);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, []);
}

function roundedRectShape(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function useRoundedPlane(w: number, h: number, r: number) {
  return useMemo(() => {
    const geo = new THREE.ShapeGeometry(roundedRectShape(w, h, r), 24);
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + w / 2) / w;
      uv[i * 2 + 1] = (pos.getY(i) + h / 2) / h;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  }, [w, h, r]);
}

function Lens({ position }: { position: [number, number, number] }) {
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      <mesh>
        <cylinderGeometry args={[0.15, 0.16, 0.07, 48]} />
        <meshStandardMaterial color="#9aa3b5" metalness={1} roughness={0.18} />
      </mesh>
      <mesh position={[0, 0.037, 0]}>
        <cylinderGeometry args={[0.115, 0.115, 0.01, 48]} />
        <meshPhysicalMaterial color="#03050c" metalness={0.2} roughness={0.05} clearcoat={1} clearcoatRoughness={0} />
      </mesh>
      <mesh position={[0.03, 0.044, -0.03]}>
        <circleGeometry args={[0.03, 24]} />
        <meshBasicMaterial color="#5a7fd1" transparent opacity={0.65} />
      </mesh>
    </group>
  );
}

function Phone({ scroll }: { scroll: React.MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const screenTex = useScreenTexture();
  const screenGeo = useRoundedPlane(W - 0.12, H - 0.12, 0.2);
  const glassGeo = useRoundedPlane(W - 0.02, H - 0.02, 0.24);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const s = scroll.current;
    // دوران مستمر هادئ + تأثير التمرير + المؤشر
    const targetY = Math.sin(t * 0.35) * 0.55 + s * Math.PI * 1.15 + pointer.current.x * 0.35 - 0.35;
    const targetX = -0.12 + pointer.current.y * 0.18 + s * 0.25;
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, targetY, 3, dt);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, targetX, 3, dt);
    g.rotation.z = THREE.MathUtils.damp(g.rotation.z, 0.06 - s * 0.12, 3, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, -s * 0.6, 4, dt);
  });

  const frame = (
    <meshPhysicalMaterial color="#1d2230" metalness={1} roughness={0.22} clearcoat={1} clearcoatRoughness={0.15} envMapIntensity={1.6} />
  );

  return (
    <group ref={group} rotation={[0, -0.6, 0]}>
      {/* الإطار المعدني */}
      <RoundedBox args={[W, H, D]} radius={0.075} smoothness={8} bevelSegments={6} creaseAngle={0.4}>
        {frame}
      </RoundedBox>

      {/* الواجهة الزجاجية */}
      <mesh geometry={glassGeo} position={[0, 0, D / 2 + 0.002]}>
        <meshPhysicalMaterial color="#000000" metalness={0} roughness={0.05} clearcoat={1} clearcoatRoughness={0} />
      </mesh>
      <mesh geometry={screenGeo} position={[0, 0, D / 2 + 0.004]}>
        <meshBasicMaterial map={screenTex} toneMapped={false} />
      </mesh>
      {/* لمعة زجاج */}
      <mesh geometry={glassGeo} position={[0, 0, D / 2 + 0.006]}>
        <meshPhysicalMaterial transparent opacity={0.18} roughness={0} metalness={0} clearcoat={1} transmission={0} color="#ffffff" envMapIntensity={2.5} />
      </mesh>
      {/* Dynamic Island */}
      <mesh position={[0, H / 2 - 0.22, D / 2 + 0.008]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.055, 0.28, 8, 24]} />
        <meshBasicMaterial color="#000" />
      </mesh>

      {/* الظهر */}
      <mesh geometry={glassGeo} position={[0, 0, -D / 2 - 0.002]} rotation={[0, Math.PI, 0]}>
        <meshPhysicalMaterial color="#141a2a" metalness={0.6} roughness={0.35} clearcoat={1} clearcoatRoughness={0.25} envMapIntensity={1.2} />
      </mesh>
      {/* وحدة الكاميرات */}
      <group position={[0.33, H / 2 - 0.55, -D / 2 - 0.03]} rotation={[0, Math.PI, 0]}>
        <RoundedBox args={[0.78, 0.78, 0.06]} radius={0.16} smoothness={6}>
          <meshPhysicalMaterial color="#1a2133" metalness={0.8} roughness={0.25} clearcoat={1} />
        </RoundedBox>
        <Lens position={[-0.17, 0.17, 0.05]} />
        <Lens position={[-0.17, -0.17, 0.05]} />
        <Lens position={[0.17, 0, 0.05]} />
        <mesh position={[0.2, 0.25, 0.04]}>
          <circleGeometry args={[0.045, 24]} />
          <meshBasicMaterial color="#fff6d8" />
        </mesh>
      </group>
      {/* شعار خلفي مضيء */}
      <mesh position={[0, -0.25, -D / 2 - 0.006]} rotation={[0, Math.PI, Math.PI / 4]}>
        <planeGeometry args={[0.28, 0.28]} />
        <meshBasicMaterial color="#4d8fff" transparent opacity={0.85} toneMapped={false} />
      </mesh>

      {/* الأزرار الجانبية */}
      <mesh position={[W / 2 + 0.008, 0.55, 0]}>
        <boxGeometry args={[0.02, 0.42, 0.06]} />
        {frame}
      </mesh>
      <mesh position={[-W / 2 - 0.008, 0.85, 0]}>
        <boxGeometry args={[0.02, 0.2, 0.06]} />
        {frame}
      </mesh>
      <mesh position={[-W / 2 - 0.008, 0.45, 0]}>
        <boxGeometry args={[0.02, 0.32, 0.06]} />
        {frame}
      </mesh>
    </group>
  );
}

function GlowRing() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (ref.current) ref.current.rotation.z = s.clock.elapsedTime * 0.15;
  });
  return (
    <mesh ref={ref} position={[0, 0, -1.4]}>
      <torusGeometry args={[2.25, 0.012, 16, 160]} />
      <meshBasicMaterial color="#4d8fff" toneMapped={false} transparent opacity={0.8} />
    </mesh>
  );
}

export default function HeroPhone({ scroll, active }: { scroll: React.MutableRefObject<number>; active: boolean }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={active ? 'always' : 'never'}
      camera={{ position: [0, 0, 7.8], fov: 35 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ touchAction: 'pan-y' }}
    >
      <ambientLight intensity={0.25} />
      <directionalLight position={[3, 5, 4]} intensity={1.4} color="#d4e5ff" />
      <pointLight position={[-3, -1, 2]} intensity={18} color="#2f7bff" distance={10} />
      <pointLight position={[3, 2, -3]} intensity={25} color="#4d8fff" distance={12} />

      <Float speed={1.4} rotationIntensity={0.15} floatIntensity={0.6} floatingRange={[-0.08, 0.08]}>
        <Phone scroll={scroll} />
      </Float>
      <GlowRing />

      <ContactShadows position={[0, -2.1, 0]} opacity={0.55} scale={7} blur={2.6} far={3} color="#000a24" />

      {/* بيئة إضاءة استوديو مولّدة محلياً — انعكاسات واقعية بدون تحميل ملفات HDR */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={3} color="#ffffff" position={[0, 4, -2]} scale={[8, 1.2, 1]} />
        <Lightformer form="rect" intensity={4} color="#4d8fff" position={[-4, 0, 1]} rotation-y={Math.PI / 2} scale={[6, 1, 1]} />
        <Lightformer form="rect" intensity={2.5} color="#a9caff" position={[4, 1, 1]} rotation-y={-Math.PI / 2} scale={[6, 0.6, 1]} />
        <Lightformer form="ring" intensity={2} color="#2f7bff" position={[0, -3, 3]} scale={3} />
      </Environment>
    </Canvas>
  );
}
