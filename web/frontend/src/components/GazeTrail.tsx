import { useCallback, useEffect, useRef } from "react";
import type { TrackingHistory } from "../types/tracking";

interface GazeTrailProps {
	history: TrackingHistory;
}

const MAX_TRAIL_POINTS = 500;

export function GazeTrail({ history }: GazeTrailProps) {
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

		// Background — theme-aware
		const isDark = document.documentElement.getAttribute("data-theme") !== "light";
		const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
		if (isDark) {
			bgGrad.addColorStop(0, "#0a0f18");
			bgGrad.addColorStop(1, "#06080f");
		} else {
			bgGrad.addColorStop(0, "#f8fafb");
			bgGrad.addColorStop(1, "#f0f2f5");
		}
		ctx.fillStyle = bgGrad;
		ctx.fillRect(0, 0, w, h);

		// Dot grid
		ctx.fillStyle = isDark ? "rgba(33, 38, 45, 0.4)" : "rgba(0, 0, 0, 0.06)";
		const gridSpacing = 40;
		for (let x = 0; x < w; x += gridSpacing) {
			for (let y = 0; y < h; y += gridSpacing) {
				ctx.beginPath();
				ctx.arc(x, y, 0.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		// Theme-aware accent color
		const ac = isDark ? [34, 211, 238] : [8, 145, 178];

		// gazePoints are fused screen-space 0-1 — map to canvas pixels
		const mappedPoints: [number, number][] = history.gazePoints.map(([px, py]) => [px * w, py * h]);

		// Get recent points
		const sizes = history.pupilSizes;
		const n = mappedPoints.length;
		const start = Math.max(0, n - MAX_TRAIL_POINTS);
		const count = n - start;

		if (count < 1) {
			ctx.fillStyle = isDark ? "rgba(72, 79, 88, 0.5)" : "rgba(0, 0, 0, 0.25)";
			ctx.font = '13px "Inter", system-ui, sans-serif';
			ctx.textAlign = "center";
			ctx.fillText("No gaze data yet", w / 2, h / 2);

			// Subtle pulsing ring
			const time = timeRef.current;
			const pulse = 0.3 + 0.2 * Math.sin(time * 2);
			ctx.strokeStyle = isDark
				? `rgba(${ac[0]}, ${ac[1]}, ${ac[2]}, ${pulse * 0.15})`
				: `rgba(8, 145, 178, ${pulse * 0.2})`;
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

			for (let i = 1; i < count; i++) {
				const idx = start + i;
				const prevIdx = idx - 1;
				const progress = i / count;
				const alpha = progress * 0.7;

				const x0 = mappedPoints[prevIdx][0];
				const y0 = mappedPoints[prevIdx][1];
				const x1 = mappedPoints[idx][0];
				const y1 = mappedPoints[idx][1];

				const mx = (x0 + x1) / 2;
				const my = (y0 + y1) / 2;

				ctx.beginPath();
				ctx.strokeStyle = `rgba(${ac[0]}, ${ac[1]}, ${ac[2]}, ${alpha})`;
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

			// Point glow for recent points
			if (progress > 0.6) {
				const glowAlpha = (progress - 0.6) * 1.5 * (isDark ? 0.2 : 0.25);
				const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * 6);
				glowGrad.addColorStop(0, `rgba(${ac[0]}, ${ac[1]}, ${ac[2]}, ${glowAlpha})`);
				glowGrad.addColorStop(1, `rgba(${ac[0]}, ${ac[1]}, ${ac[2]}, 0)`);
				ctx.fillStyle = glowGrad;
				ctx.beginPath();
				ctx.arc(x, y, radius * 6, 0, Math.PI * 2);
				ctx.fill();
			}

			ctx.beginPath();
			ctx.arc(x, y, radius, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${ac[0]}, ${ac[1]}, ${ac[2]}, ${alpha})`;
			ctx.fill();
		}

		// Current point: pulsing glow
		if (count > 0) {
			const lastIdx = n - 1;
			const cx = mappedPoints[lastIdx][0];
			const cy = mappedPoints[lastIdx][1];
			const time = timeRef.current;
			const pulse = 0.5 + 0.5 * Math.sin(time * 3.5);
			const glowRadius = 18 + pulse * 14;

			// Outer glow — wider and stronger
			const glow1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius * 2);
			glow1.addColorStop(
				0,
				`rgba(${ac[0]}, ${ac[1]}, ${ac[2]}, ${isDark ? 0.12 + pulse * 0.06 : 0.15 + pulse * 0.08})`,
			);
			glow1.addColorStop(1, `rgba(${ac[0]}, ${ac[1]}, ${ac[2]}, 0)`);
			ctx.beginPath();
			ctx.arc(cx, cy, glowRadius * 2, 0, Math.PI * 2);
			ctx.fillStyle = glow1;
			ctx.fill();

			// Inner glow
			const glow2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
			glow2.addColorStop(
				0,
				`rgba(${ac[0]}, ${ac[1]}, ${ac[2]}, ${isDark ? 0.4 + pulse * 0.25 : 0.35 + pulse * 0.15})`,
			);
			glow2.addColorStop(0.4, `rgba(${ac[0]}, ${ac[1]}, ${ac[2]}, ${isDark ? 0.1 : 0.08})`);
			glow2.addColorStop(1, `rgba(${ac[0]}, ${ac[1]}, ${ac[2]}, 0)`);
			ctx.beginPath();
			ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
			ctx.fillStyle = glow2;
			ctx.fill();

			// Solid point
			ctx.beginPath();
			ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
			ctx.fillStyle = isDark ? "#22d3ee" : "#0891b2";
			ctx.fill();

			// Core
			ctx.beginPath();
			ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
			ctx.fillStyle = isDark ? "#ffffff" : "#ffffff";
			ctx.fill();
		}

		// Crosshairs
		ctx.strokeStyle = isDark ? "rgba(33, 38, 45, 0.3)" : "rgba(0, 0, 0, 0.08)";
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
	}, [history]);

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
			</div>
		</div>
	);
}
