import { OrbitControls, Sphere } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Box, FlipHorizontal2 } from "lucide-react";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { TrackingData } from "../types/tracking";

interface EyeModel3DProps {
	leftTracking: TrackingData | null;
	rightTracking: TrackingData | null;
	mirrored: boolean;
	onToggleMirror: () => void;
}

// Smaller eye sphere for better fit in tight panels
const EYE_RADIUS = 0.7;
const EYE_HALF_GAP = 1.05; // center-to-center half-distance

function SingleEye({
	tracking,
	positionX,
}: {
	tracking: TrackingData | null;
	positionX: number;
}) {
	const groupRef = useRef<THREE.Group>(null!);
	const idleRotation = useRef(Math.random() * 10);
	const irisGlowRef = useRef<THREE.Mesh>(null!);

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

		if (irisGlowRef.current) {
			const t = Date.now() * 0.001;
			const pulse = 0.2 + 0.1 * Math.sin(t * 2);
			(irisGlowRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
		}
	});

	const r = EYE_RADIUS;
	const irisR = r * 0.38;
	const irisTube = r * 0.04;

	return (
		<group position={[positionX, 0, 0]}>
			<group ref={groupRef}>
				<Sphere args={[r, 32, 32]}>
					<meshStandardMaterial color="#6b8fc7" wireframe transparent opacity={0.35} />
				</Sphere>
				<Sphere args={[r * 0.96, 32, 32]}>
					<meshStandardMaterial color="#2a3f5f" transparent opacity={0.25} />
				</Sphere>
				<Sphere args={[r * 1.02, 32, 32]}>
					<meshStandardMaterial color="#22d3ee" transparent opacity={0.06} side={THREE.BackSide} />
				</Sphere>
				<mesh ref={irisGlowRef} position={[0, 0, r * 0.88]}>
					<torusGeometry args={[irisR, irisTube, 16, 64]} />
					<meshStandardMaterial color="#34d399" emissive="#34d399" emissiveIntensity={0.6} />
				</mesh>
				<mesh position={[0, 0, r * 0.95]}>
					<circleGeometry args={[r * 0.12, 32]} />
					<meshBasicMaterial color="#1a1a2e" />
				</mesh>
			</group>
		</group>
	);
}

function EyeScene({
	leftTracking,
	rightTracking,
	mirrored,
}: {
	leftTracking: TrackingData | null;
	rightTracking: TrackingData | null;
	mirrored: boolean;
}) {
	const hasLeft = leftTracking != null;
	const hasRight = rightTracking != null;
	const hasBoth = hasLeft && hasRight;

	const leftX = mirrored ? -EYE_HALF_GAP : EYE_HALF_GAP;
	const rightX = mirrored ? EYE_HALF_GAP : -EYE_HALF_GAP;

	return (
		<>
			<ambientLight intensity={0.6} />
			<pointLight position={[3, 3, 5]} intensity={1.2} color="#8bb8e8" />
			<pointLight position={[-2, -1, 3]} intensity={0.6} color="#22d3ee" />
			<pointLight position={[0, -3, 2]} intensity={0.4} color="#34d399" />
			<hemisphereLight color="#a0d8ef" groundColor="#1a2740" intensity={0.3} />

			{hasLeft && <SingleEye tracking={leftTracking} positionX={hasBoth ? leftX : 0} />}
			{hasRight && <SingleEye tracking={rightTracking} positionX={hasBoth ? rightX : 0} />}
		</>
	);
}

export function EyeModel3D({
	leftTracking,
	rightTracking,
	mirrored,
	onToggleMirror,
}: EyeModel3DProps) {
	const hasLeft = leftTracking != null;
	const hasRight = rightTracking != null;
	const hasBoth = hasLeft && hasRight;
	const hasAny = hasLeft || hasRight;
	const hasGaze = leftTracking?.gaze != null || rightTracking?.gaze != null;

	return (
		<div className="glass rounded-2xl border border-[var(--color-border)]/80 flex flex-col overflow-hidden">
			<div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]/40 shrink-0">
				<div className="flex items-center gap-2 min-w-0">
					<Box className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
					<span className="text-[12px] font-semibold text-[var(--color-text-primary)]">
						3D Model
					</span>
					{hasGaze && (
						<span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-[var(--color-success)]/8 text-[var(--color-success)]">
							Active
						</span>
					)}
				</div>
				{hasAny && (
					<button
						type="button"
						onClick={onToggleMirror}
						className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all cursor-pointer border ${
							mirrored
								? "bg-[var(--color-accent)]/12 border-[var(--color-accent)]/30 text-[var(--color-accent)]"
								: "bg-transparent border-[var(--color-border)]/50 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
						}`}
						title={mirrored ? "Mirror mode" : "Anatomical view"}
					>
						<FlipHorizontal2 className="w-3 h-3" />
						{mirrored ? "Mirror" : "Anatomical"}
					</button>
				)}
			</div>

			<div className="w-full" style={{ aspectRatio: "5/3" }}>
				<Canvas
					camera={{ position: [0, 0, hasBoth ? 3.5 : 2.2], fov: 50 }}
					style={{
						background: "var(--color-bg-primary)",
					}}
					gl={{ antialias: true, alpha: false }}
				>
					{hasAny && (
						<EyeScene
							leftTracking={leftTracking}
							rightTracking={rightTracking}
							mirrored={mirrored}
						/>
					)}
					<OrbitControls
						enableDamping
						dampingFactor={0.08}
						minDistance={1.5}
						maxDistance={8}
						rotateSpeed={0.6}
					/>
				</Canvas>
			</div>

			{hasBoth && (
				<div className="flex justify-around px-3 py-1 border-t border-[var(--color-border)]/30">
					<span className="text-[9px] font-medium text-[var(--color-text-muted)]">
						{mirrored ? "Left" : "Right"}
					</span>
					<span className="text-[9px] font-medium text-[var(--color-text-muted)]">
						{mirrored ? "Right" : "Left"}
					</span>
				</div>
			)}
		</div>
	);
}
