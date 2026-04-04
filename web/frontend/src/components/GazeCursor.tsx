import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { type CalibrationResult, applyCalibration, smoothPosition } from "../lib/calibration";
import type { TrackingData } from "../types/tracking";

interface GazeCursorProps {
	tracking: TrackingData | null;
	calibration: CalibrationResult | null;
	visible: boolean;
}

const TRAIL_LENGTH = 7;
const SMOOTH_ALPHA = 0.3;
const TRAIL_FADE_MS = 2000;

type TrailPoint = { pos: [number, number]; time: number };

export function GazeCursor({ tracking, calibration, visible }: GazeCursorProps) {
	const previousPos = useRef<[number, number] | null>(null);
	const [position, setPosition] = useState<[number, number] | null>(null);
	const trailRef = useRef<TrailPoint[]>([]);
	const [trail, setTrail] = useState<TrailPoint[]>([]);

	useEffect(() => {
		if (!visible || !calibration || !tracking?.pupil?.center) {
			previousPos.current = null;
			setPosition(null);
			trailRef.current = [];
			setTrail([]);
			return;
		}

		const raw = applyCalibration(tracking.pupil.center, calibration);
		const smoothed = smoothPosition(raw, previousPos.current, SMOOTH_ALPHA);
		previousPos.current = smoothed;

		// Convert to viewport pixels
		const px: [number, number] = [
			smoothed[0] * window.innerWidth,
			smoothed[1] * window.innerHeight,
		];

		// Clamp to viewport
		px[0] = Math.max(0, Math.min(window.innerWidth, px[0]));
		px[1] = Math.max(0, Math.min(window.innerHeight, px[1]));

		setPosition(px);

		// Update trail with timestamps
		const now = Date.now();
		trailRef.current = [...trailRef.current, { pos: px, time: now }].slice(-TRAIL_LENGTH);
		setTrail([...trailRef.current]);
	}, [tracking, calibration, visible]);

	const confidence = tracking?.confidence ?? 0;
	const cursorOpacity = Math.max(0.2, Math.min(0.8, confidence));

	if (!visible || !calibration) return null;

	return (
		<div className="fixed inset-0 pointer-events-none z-40">
			<AnimatePresence>
				{position && (
					<>
						{/* Trail dots */}
						{trail.slice(0, -1).map((point, i) => {
							const now = Date.now();
							const ageMs = now - point.time;
							const timeFade = Math.max(0, 1 - ageMs / TRAIL_FADE_MS);
							const indexFade = (trail.length - 1 - i) / trail.length;
							const opacity = (1 - indexFade) * 0.25 * cursorOpacity * timeFade;
							const size = 20 * (1 - indexFade * 0.5);
							if (opacity <= 0) return null;
							return (
								<div
									key={`trail-${point.pos[0].toFixed(1)}-${point.pos[1].toFixed(1)}`}
									className="absolute rounded-full"
									style={{
										left: point.pos[0] - size / 2,
										top: point.pos[1] - size / 2,
										width: size,
										height: size,
										backgroundColor: "var(--color-accent)",
										opacity,
									}}
								/>
							);
						})}

						{/* Main cursor */}
						<motion.div
							className="absolute"
							style={{
								left: position[0] - 10,
								top: position[1] - 10,
							}}
							initial={{ scale: 0, opacity: 0 }}
							animate={{ scale: 1, opacity: cursorOpacity }}
							exit={{ scale: 0, opacity: 0 }}
							transition={{ type: "spring", stiffness: 400, damping: 30 }}
						>
							{/* Glow */}
							<div
								className="absolute inset-[-6px] rounded-full"
								style={{
									background: "radial-gradient(circle, var(--color-glow-cyan) 0%, transparent 70%)",
								}}
							/>
							{/* Outer ring */}
							<motion.div
								className="w-5 h-5 rounded-full border-[2px]"
								style={{
									borderColor: "var(--color-accent)",
									backgroundColor: "rgba(34, 211, 238, 0.15)",
								}}
								animate={{ scale: [1, 1.15, 1] }}
								transition={{
									duration: 2,
									repeat: Number.POSITIVE_INFINITY,
									ease: "easeInOut",
								}}
							/>
							{/* Center dot */}
							<div
								className="absolute rounded-full"
								style={{
									width: 6,
									height: 6,
									left: 7,
									top: 7,
									backgroundColor: "var(--color-accent)",
								}}
							/>
						</motion.div>
					</>
				)}
			</AnimatePresence>
		</div>
	);
}
