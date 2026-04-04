import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { smoothPosition } from "../lib/calibration";

interface GazeCursorProps {
	gazePosition: [number, number] | null; // screen-space 0-1, already fused
	visible: boolean;
}

const TRAIL_MAX = 12;
const TRAIL_LIFETIME_MS = 600;

type TrailPoint = { x: number; y: number; time: number };

export function GazeCursor({ gazePosition, visible }: GazeCursorProps) {
	const prevSmoothed = useRef<[number, number] | null>(null);
	const trailRef = useRef<TrailPoint[]>([]);
	const [cursor, setCursor] = useState<[number, number] | null>(null);
	const [trail, setTrail] = useState<TrailPoint[]>([]);

	// Prune expired trail dots on a timer
	useEffect(() => {
		if (!visible || !gazePosition) return;
		const id = setInterval(() => {
			const now = Date.now();
			trailRef.current = trailRef.current.filter((p) => now - p.time < TRAIL_LIFETIME_MS);
			setTrail([...trailRef.current]);
		}, 50);
		return () => clearInterval(id);
	}, [visible, gazePosition]);

	// Process gaze position with velocity-adaptive smoothing
	useEffect(() => {
		if (!visible || !gazePosition) {
			prevSmoothed.current = null;
			trailRef.current = [];
			setCursor(null);
			setTrail([]);
			return;
		}

		const smoothed = smoothPosition(gazePosition, prevSmoothed.current);
		prevSmoothed.current = smoothed;

		const px = Math.max(0, Math.min(window.innerWidth, smoothed[0] * window.innerWidth));
		const py = Math.max(0, Math.min(window.innerHeight, smoothed[1] * window.innerHeight));

		setCursor([px, py]);

		const now = Date.now();
		trailRef.current.push({ x: px, y: py, time: now });
		if (trailRef.current.length > TRAIL_MAX) {
			trailRef.current = trailRef.current.slice(-TRAIL_MAX);
		}
		setTrail([...trailRef.current]);
	}, [gazePosition, visible]);

	if (!visible || !cursor) return null;

	const [cx, cy] = cursor;
	const now = Date.now();

	return (
		<div className="fixed inset-0 pointer-events-none z-40">
			{/* Trail dots */}
			{trail.slice(0, -1).map((point) => {
				const age = now - point.time;
				const fade = Math.max(0, 1 - age / TRAIL_LIFETIME_MS);
				if (fade <= 0) return null;
				const size = 6 + fade * 6;
				return (
					<div
						key={point.time}
						className="absolute rounded-full"
						style={{
							left: point.x - size / 2,
							top: point.y - size / 2,
							width: size,
							height: size,
							backgroundColor: "var(--color-accent)",
							opacity: fade * 0.2,
						}}
					/>
				);
			})}

			{/* Main cursor */}
			<motion.div
				className="absolute"
				style={{ left: cx - 12, top: cy - 12 }}
				initial={{ scale: 0, opacity: 0 }}
				animate={{ scale: 1, opacity: 0.7 }}
				transition={{ type: "spring", stiffness: 400, damping: 30 }}
			>
				<div
					className="absolute inset-[-8px] rounded-full"
					style={{
						background: "radial-gradient(circle, var(--color-glow-cyan) 0%, transparent 70%)",
					}}
				/>
				<div
					className="w-6 h-6 rounded-full border-2"
					style={{
						borderColor: "var(--color-accent)",
						backgroundColor: "rgba(34, 211, 238, 0.1)",
					}}
				/>
				<div
					className="absolute rounded-full"
					style={{
						width: 6,
						height: 6,
						left: 9,
						top: 9,
						backgroundColor: "var(--color-accent)",
					}}
				/>
			</motion.div>
		</div>
	);
}
