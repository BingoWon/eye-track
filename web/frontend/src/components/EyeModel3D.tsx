import { OrbitControls, Sphere } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { motion } from "framer-motion";
import { Box, Maximize2, Minimize2 } from "lucide-react";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { TrackingData } from "../types/tracking";

interface EyeModel3DProps {
	tracking: TrackingData | null;
	isExpanded: boolean;
	onToggleExpand: () => void;
}

/* ------------------------------------------------------------------ */
/*  Inner 3D scene (runs inside Canvas)                               */
/* ------------------------------------------------------------------ */

function EyeScene({ tracking }: { tracking: TrackingData | null }) {
	const groupRef = useRef<THREE.Group>(null!);
	const gazeLineRef = useRef<THREE.BufferGeometry>(null!);
	const idleRotation = useRef(0);
	const irisGlowRef = useRef<THREE.Mesh>(null!);

	// Target quaternion derived from gaze direction
	const targetQuat = useMemo(() => new THREE.Quaternion(), []);
	const defaultDir = useMemo(() => new THREE.Vector3(0, 0, 1), []);

	useFrame((_, delta) => {
		if (!groupRef.current) return;

		if (tracking?.gaze) {
			const [dx, dy, dz] = tracking.gaze.direction;
			const gazeDir = new THREE.Vector3(dx, dy, dz).normalize();
			targetQuat.setFromUnitVectors(defaultDir, gazeDir);
			groupRef.current.quaternion.slerp(targetQuat, 0.12);
		} else {
			// Idle: gentle oscillating rotation
			idleRotation.current += delta * 0.3;
			const idleQuat = new THREE.Quaternion().setFromEuler(
				new THREE.Euler(
					Math.sin(idleRotation.current) * 0.12,
					Math.sin(idleRotation.current * 0.7) * 0.18,
					0,
				),
			);
			groupRef.current.quaternion.slerp(idleQuat, 0.04);
		}

		// Pulse iris glow
		if (irisGlowRef.current) {
			const t = Date.now() * 0.001;
			const pulse = 0.2 + 0.1 * Math.sin(t * 2);
			(irisGlowRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
		}

		// Update gaze direction line
		if (gazeLineRef.current) {
			if (tracking?.gaze) {
				const [dx, dy, dz] = tracking.gaze.direction;
				const end = new THREE.Vector3(dx, dy, dz).normalize().multiplyScalar(2.2);
				const positions = new Float32Array([0, 0, 0, end.x, end.y, end.z]);
				gazeLineRef.current.setAttribute("position", new THREE.BufferAttribute(positions, 3));
			} else {
				const positions = new Float32Array([0, 0, 0, 0, 0, 2.2]);
				gazeLineRef.current.setAttribute("position", new THREE.BufferAttribute(positions, 3));
			}
		}
	});

	// Iris torus geometry
	const irisRadius = 0.38;
	const irisTube = 0.04;

	return (
		<>
			{/* Lighting -- more refined */}
			<ambientLight intensity={0.25} />
			<pointLight position={[3, 3, 5]} intensity={0.7} color="#8bb8e8" />
			<pointLight position={[-2, -1, 3]} intensity={0.35} color="#22d3ee" />
			<pointLight position={[0, -3, 2]} intensity={0.15} color="#34d399" />

			{/* Subtle ambient hemisphere */}
			<hemisphereLight color="#22d3ee" groundColor="#06080f" intensity={0.12} />

			{/* Z-axis reference line (red, more subtle) */}
			<line>
				<bufferGeometry>
					<bufferAttribute
						attach="attributes-position"
						args={[new Float32Array([0, 0, 0, 0, 0, 2.5]), 3]}
					/>
				</bufferGeometry>
				<lineBasicMaterial color="#f87171" opacity={0.25} transparent />
			</line>

			{/* Gaze direction line (cyan) */}
			<line>
				<bufferGeometry ref={gazeLineRef}>
					<bufferAttribute
						attach="attributes-position"
						args={[new Float32Array([0, 0, 0, 0, 0, 2.2]), 3]}
					/>
				</bufferGeometry>
				<lineBasicMaterial color="#22d3ee" linewidth={2} opacity={0.8} transparent />
			</line>

			{/* Eye group: sphere + iris ring rotate together */}
			<group ref={groupRef}>
				{/* Wireframe eyeball */}
				<Sphere args={[1, 32, 32]}>
					<meshStandardMaterial color="#4a6fa5" wireframe transparent opacity={0.18} />
				</Sphere>

				{/* Solid inner sphere for depth */}
				<Sphere args={[0.96, 32, 32]}>
					<meshStandardMaterial color="#1a2740" transparent opacity={0.12} />
				</Sphere>

				{/* Outer glow sphere */}
				<Sphere args={[1.02, 32, 32]}>
					<meshStandardMaterial color="#22d3ee" transparent opacity={0.03} side={THREE.BackSide} />
				</Sphere>

				{/* Iris / pupil ring */}
				<mesh ref={irisGlowRef} position={[0, 0, 0.88]} rotation={[Math.PI / 2, 0, 0]}>
					<torusGeometry args={[irisRadius, irisTube, 16, 64]} />
					<meshStandardMaterial color="#34d399" emissive="#34d399" emissiveIntensity={0.25} />
				</mesh>

				{/* Pupil dot */}
				<mesh position={[0, 0, 0.95]}>
					<circleGeometry args={[0.12, 32]} />
					<meshBasicMaterial color="#06080f" />
				</mesh>
			</group>
		</>
	);
}

/* ------------------------------------------------------------------ */
/*  Outer panel component                                             */
/* ------------------------------------------------------------------ */

export function EyeModel3D({ tracking, isExpanded, onToggleExpand }: EyeModel3DProps) {
	return (
		<motion.div
			layout
			className="glass rounded-2xl border border-[var(--color-border)]/80 flex flex-col overflow-hidden"
			transition={{
				layout: { duration: 0.25, ease: "easeInOut" },
			}}
		>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]/60 shrink-0">
				<div className="flex items-center gap-2.5">
					<div className="w-6 h-6 rounded-md bg-[var(--color-accent)]/8 flex items-center justify-center border border-[var(--color-accent)]/10">
						<Box className="w-3.5 h-3.5 text-[var(--color-accent)]" />
					</div>
					<h2 className="text-[13px] font-semibold text-[var(--color-text-primary)] tracking-tight">
						3D Eye Model
					</h2>
					{tracking?.gaze && (
						<span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-medium bg-[var(--color-success)]/8 text-[var(--color-success)] border border-[var(--color-success)]/10">
							Tracking
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={onToggleExpand}
					className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)] transition-all cursor-pointer"
				>
					{isExpanded ? (
						<Minimize2 className="w-3.5 h-3.5" />
					) : (
						<Maximize2 className="w-3.5 h-3.5" />
					)}
				</button>
			</div>

			{/* Canvas */}
			<div className="flex-1 min-h-0">
				<Canvas
					camera={{ position: [0, 0, 3], fov: 50 }}
					style={{
						background: "radial-gradient(ellipse at center, #0a0f18 0%, #06080f 70%)",
					}}
					gl={{ antialias: true, alpha: false }}
				>
					<EyeScene tracking={tracking} />
					<OrbitControls
						enableDamping
						dampingFactor={0.08}
						minDistance={1.8}
						maxDistance={8}
						rotateSpeed={0.6}
					/>
				</Canvas>
			</div>
		</motion.div>
	);
}
