import { useCallback, useEffect, useRef } from "react";
import { type CalibrationResult, applyCalibration } from "../lib/calibration";
import type { TrackingData, TrackingHistory } from "../types/tracking";

interface GazeTrailProps {
	history: TrackingHistory;
	tracking: TrackingData | null;
	calibration?: CalibrationResult | null;
}

const SOURCE_W = 640;
const SOURCE_H = 480;
const MAX_TRAIL_POINTS = 500;

export function GazeTrail({ history, tracking, calibration }: GazeTrailProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const animRef = useRef<number>(0);
	const timeRef = useRef<number>(0);

	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// Resize canvas to match CSS size at device pixel ratio
		const rect = canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const cw = rect.width * dpr;
		const ch = rect.height * dpr;

		if (canvas.width !== cw || canvas.height !== ch) {
			canvas.width = cw;
			canvas.height = ch;
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const w = rect.width;
		const h = rect.height;

		// Clear with subtle gradient background
		const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
		bgGrad.addColorStop(0, "#0a0f18");
		bgGrad.addColorStop(1, "#06080f");
		ctx.fillStyle = bgGrad;
		ctx.fillRect(0, 0, w, h);

		// Draw refined grid with dot pattern
		ctx.fillStyle = "rgba(33, 38, 45, 0.4)";
		const gridSpacing = 40;
		for (let x = 0; x < w; x += gridSpacing) {
			for (let y = 0; y < h; y += gridSpacing) {
				ctx.beginPath();
				ctx.arc(x, y, 0.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		// Pre-map all points to canvas coordinates
		const scaleX = w / SOURCE_W;
		const scaleY = h / SOURCE_H;

		// Build mapped points array once
		const mappedPoints: [number, number][] = [];
		const rawPoints = history.gazePoints;
		for (let i = 0; i < rawPoints.length; i++) {
			const [px, py] = rawPoints[i];
			if (calibration) {
				const [sx, sy] = applyCalibration([px, py], calibration);
				mappedPoints.push([sx * w, sy * h]);
			} else {
				mappedPoints.push([px * scaleX, py * scaleY]);
			}
		}

		// Get recent points
		const sizes = history.pupilSizes;
		const n = mappedPoints.length;
		const start = Math.max(0, n - MAX_TRAIL_POINTS);
		const count = n - start;

		if (count < 1) {
			// No data placeholder
			ctx.fillStyle = "rgba(72, 79, 88, 0.5)";
			ctx.font = '13px "Inter", system-ui, sans-serif';
			ctx.textAlign = "center";
			ctx.fillText("No gaze data yet", w / 2, h / 2);

			// Subtle pulsing ring
			const time = timeRef.current;
			const pulse = 0.3 + 0.2 * Math.sin(time * 2);
			ctx.strokeStyle = `rgba(34, 211, 238, ${pulse * 0.15})`;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(w / 2, h / 2 - 30, 20 + Math.sin(time * 1.5) * 3, 0, Math.PI * 2);
			ctx.stroke();

			timeRef.current += 1 / 60;
			animRef.current = requestAnimationFrame(draw);
			return;
		}

		// Draw connecting trail with smooth bezier curves
		if (count >= 2) {
			ctx.lineCap = "round";
			ctx.lineJoin = "round";

			// Draw trail segments with gradient opacity
			for (let i = 1; i < count; i++) {
				const idx = start + i;
				const prevIdx = idx - 1;
				const progress = i / count;
				const alpha = progress * 0.7;

				const x0 = mappedPoints[prevIdx][0];
				const y0 = mappedPoints[prevIdx][1];
				const x1 = mappedPoints[idx][0];
				const y1 = mappedPoints[idx][1];

				// Use quadratic bezier with midpoint
				const mx = (x0 + x1) / 2;
				const my = (y0 + y1) / 2;

				ctx.beginPath();

				// Gradient from cyan to a warmer tone
				const r = Math.round(34 + progress * 0);
				const g = Math.round(211 - progress * 30);
				const b = Math.round(238 - progress * 30);
				ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
				ctx.lineWidth = 1 + progress * 2;

				if (i === 1) {
					ctx.moveTo(x0, y0);
					ctx.lineTo(mx, my);
				} else {
					const prevPrevIdx = prevIdx - 1;
					const xpp = mappedPoints[prevPrevIdx][0];
					const ypp = mappedPoints[prevPrevIdx][1];
					const prevMx = (xpp + x0) / 2;
					const prevMy = (ypp + y0) / 2;
					ctx.moveTo(prevMx, prevMy);
					ctx.quadraticCurveTo(x0, y0, mx, my);
				}
				ctx.stroke();
			}
		}

		// Draw points with refined rendering
		for (let i = 0; i < count; i++) {
			const idx = start + i;
			const x = mappedPoints[idx][0];
			const y = mappedPoints[idx][1];
			const progress = (i + 1) / count;
			const alpha = progress * 0.8;

			// Size based on pupil size
			const pupilSize = sizes[idx] ?? 2;
			const radius = Math.max(1.2, Math.min(pupilSize * 0.15, 5)) * (0.3 + 0.7 * progress);

			// Subtle point glow for recent points
			if (progress > 0.8) {
				const glowAlpha = (progress - 0.8) * 2 * 0.15;
				const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * 4);
				glowGrad.addColorStop(0, `rgba(34, 211, 238, ${glowAlpha})`);
				glowGrad.addColorStop(1, "rgba(34, 211, 238, 0)");
				ctx.fillStyle = glowGrad;
				ctx.beginPath();
				ctx.arc(x, y, radius * 4, 0, Math.PI * 2);
				ctx.fill();
			}

			ctx.beginPath();
			ctx.arc(x, y, radius, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(34, 211, 238, ${alpha})`;
			ctx.fill();
		}

		// Current point: pulsing glow
		if (count > 0) {
			const lastIdx = n - 1;
			const cx = mappedPoints[lastIdx][0];
			const cy = mappedPoints[lastIdx][1];
			const time = timeRef.current;
			const pulse = 0.5 + 0.5 * Math.sin(time * 3.5);
			const glowRadius = 14 + pulse * 10;

			// Outer glow - layered
			const glow1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius * 1.5);
			glow1.addColorStop(0, `rgba(34, 211, 238, ${0.08 + pulse * 0.05})`);
			glow1.addColorStop(1, "rgba(34, 211, 238, 0)");
			ctx.beginPath();
			ctx.arc(cx, cy, glowRadius * 1.5, 0, Math.PI * 2);
			ctx.fillStyle = glow1;
			ctx.fill();

			// Inner glow
			const glow2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
			glow2.addColorStop(0, `rgba(34, 211, 238, ${0.35 + pulse * 0.2})`);
			glow2.addColorStop(0.4, "rgba(34, 211, 238, 0.1)");
			glow2.addColorStop(1, "rgba(34, 211, 238, 0)");
			ctx.beginPath();
			ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
			ctx.fillStyle = glow2;
			ctx.fill();

			// Inner solid point
			ctx.beginPath();
			ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
			ctx.fillStyle = "#22d3ee";
			ctx.fill();

			// White core
			ctx.beginPath();
			ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
			ctx.fillStyle = "#ffffff";
			ctx.fill();
		}

		// Draw coordinate crosshairs - more refined
		ctx.strokeStyle = "rgba(33, 38, 45, 0.3)";
		ctx.lineWidth = 0.5;
		ctx.setLineDash([3, 8]);
		ctx.beginPath();
		ctx.moveTo(w / 2, 0);
		ctx.lineTo(w / 2, h);
		ctx.moveTo(0, h / 2);
		ctx.lineTo(w, h / 2);
		ctx.stroke();
		ctx.setLineDash([]);

		// Update time
		timeRef.current += 1 / 60;
		animRef.current = requestAnimationFrame(draw);
	}, [history, calibration]);

	useEffect(() => {
		animRef.current = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(animRef.current);
	}, [draw]);

	const points = history.gazePoints;
	const n = points.length;
	const displayCount = Math.min(n, MAX_TRAIL_POINTS);

	return (
		<div className="relative w-full h-full overflow-hidden">
			{/* Canvas — fills entire area */}
			<canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

			{/* Floating info overlay */}
			<div className="absolute top-3 right-3 flex flex-col items-end gap-1.5 pointer-events-none">
				<div className="glass-frosted px-2.5 py-1 rounded-lg text-[10px] font-mono text-[var(--color-text-secondary)] border border-[var(--color-border)]/30">
					{displayCount} pts / {n} total
				</div>
				{tracking?.pupil && (
					<div className="glass-frosted px-2.5 py-1 rounded-lg text-[10px] font-mono text-[var(--color-text-secondary)] border border-[var(--color-border)]/30">
						Pupil {tracking.pupil.axes[0].toFixed(1)} x {tracking.pupil.axes[1].toFixed(1)}
					</div>
				)}
			</div>
		</div>
	);
}
