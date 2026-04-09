import { motion } from "framer-motion";
import { Flame, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { TrackingHistory } from "../types/tracking";

interface GazeHeatmapProps {
	history: TrackingHistory;
	historyVersion: number;
	onClear: () => void;
}

const BLOB_RADIUS = 60;

export function GazeHeatmap({ history, historyVersion, onClear }: GazeHeatmapProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	/* Resize canvas to fill container */
	const resizeCanvas = useCallback(() => {
		const canvas = canvasRef.current;
		const container = containerRef.current;
		if (!canvas || !container) return;
		const rect = container.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		canvas.width = rect.width * dpr;
		canvas.height = rect.height * dpr;
		canvas.style.width = `${rect.width}px`;
		canvas.style.height = `${rect.height}px`;
	}, []);

	useEffect(() => {
		resizeCanvas();
		window.addEventListener("resize", resizeCanvas);
		return () => window.removeEventListener("resize", resizeCanvas);
	}, [resizeCanvas]);

	/* Draw heatmap — historyVersion triggers re-draw when history mutates */
	useEffect(() => {
		void historyVersion; // referenced to satisfy exhaustive-deps
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const id = requestAnimationFrame(() => {
			const w = canvas.width;
			const h = canvas.height;
			const dpr = window.devicePixelRatio || 1;

			// gazePoints are fused screen-space coordinates (0-1)
			// Map directly to canvas pixels

			ctx.clearRect(0, 0, w, h);

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

			// Grid (screen-space: 10% increments)
			ctx.save();
			ctx.strokeStyle = isDark ? "rgba(33, 38, 45, 0.3)" : "rgba(0, 0, 0, 0.06)";
			ctx.lineWidth = 1;
			for (let frac = 0.1; frac < 1; frac += 0.1) {
				ctx.beginPath();
				ctx.moveTo(frac * w, 0);
				ctx.lineTo(frac * w, h);
				ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(0, frac * h);
				ctx.lineTo(w, frac * h);
				ctx.stroke();
			}

			// Border
			ctx.strokeStyle = isDark ? "rgba(33, 38, 45, 0.6)" : "rgba(0, 0, 0, 0.1)";
			ctx.strokeRect(0, 0, w, h);

			// Corner accents
			const cornerLen = 12 * dpr;
			ctx.strokeStyle = isDark ? "rgba(34, 211, 238, 0.25)" : "rgba(8, 145, 178, 0.3)";
			ctx.lineWidth = 1.5;
			for (const [cx, cy, dx, dy] of [
				[0, 0, 1, 1],
				[w, 0, -1, 1],
				[0, h, 1, -1],
				[w, h, -1, -1],
			]) {
				ctx.beginPath();
				ctx.moveTo(cx + cornerLen * dx, cy);
				ctx.lineTo(cx, cy);
				ctx.lineTo(cx, cy + cornerLen * dy);
				ctx.stroke();
			}
			ctx.restore();

			// Heatmap blobs — gazePoints are screen-space 0-1
			const points = history.gazePoints;
			if (points.length > 0) {
				ctx.save();
				ctx.globalCompositeOperation = isDark ? "lighter" : "source-over";
				const radius = BLOB_RADIUS * dpr;

				for (const [px, py] of points) {
					const cx = px * w;
					const cy = py * h;
					const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
					if (isDark) {
						gradient.addColorStop(0, "rgba(34, 211, 238, 0.06)");
						gradient.addColorStop(0.2, "rgba(34, 211, 238, 0.04)");
						gradient.addColorStop(0.5, "rgba(52, 211, 153, 0.02)");
						gradient.addColorStop(0.8, "rgba(251, 191, 36, 0.008)");
						gradient.addColorStop(1, "rgba(52, 211, 153, 0)");
					} else {
						gradient.addColorStop(0, "rgba(8, 145, 178, 0.07)");
						gradient.addColorStop(0.2, "rgba(6, 182, 212, 0.045)");
						gradient.addColorStop(0.5, "rgba(5, 150, 105, 0.02)");
						gradient.addColorStop(0.8, "rgba(217, 119, 6, 0.006)");
						gradient.addColorStop(1, "rgba(5, 150, 105, 0)");
					}
					ctx.fillStyle = gradient;
					ctx.beginPath();
					ctx.arc(cx, cy, radius, 0, Math.PI * 2);
					ctx.fill();
				}
				ctx.restore();

				// Latest point highlight
				const [lx, ly] = points[points.length - 1];
				const lcx = lx * w;
				const lcy = ly * h;

				const accentR = isDark ? "34, 211, 238" : "8, 145, 178";
				const glow = ctx.createRadialGradient(lcx, lcy, 0, lcx, lcy, 24 * dpr);
				glow.addColorStop(0, `rgba(${accentR}, ${isDark ? 0.5 : 0.4})`);
				glow.addColorStop(0.3, `rgba(${accentR}, 0.15)`);
				glow.addColorStop(0.6, `rgba(${accentR}, 0.05)`);
				glow.addColorStop(1, `rgba(${accentR}, 0)`);
				ctx.fillStyle = glow;
				ctx.beginPath();
				ctx.arc(lcx, lcy, 16 * dpr, 0, Math.PI * 2);
				ctx.fill();

				ctx.fillStyle = isDark ? "#22d3ee" : "#0891b2";
				ctx.beginPath();
				ctx.arc(lcx, lcy, 3.5 * dpr, 0, Math.PI * 2);
				ctx.fill();

				ctx.fillStyle = isDark ? "#ffffff" : "#1a202c";
				ctx.beginPath();
				ctx.arc(lcx, lcy, 1.5 * dpr, 0, Math.PI * 2);
				ctx.fill();
			}
		});

		return () => cancelAnimationFrame(id);
	}, [history, historyVersion]);

	return (
		<div ref={containerRef} className="relative w-full h-full overflow-hidden">
			{/* Canvas — fills entire area */}
			<canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

			{/* Floating controls overlay */}
			<div className="absolute top-3 right-3 flex items-center gap-2 pointer-events-auto">
				<span className="glass-frosted px-2.5 py-1 rounded-lg text-[10px] font-mono text-[var(--color-text-secondary)] border border-[var(--color-border)]/30 tabular-nums pointer-events-none">
					{history.gazePoints.length.toLocaleString()} pts
				</span>
				<button
					type="button"
					onClick={onClear}
					className="glass-frosted flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/8 border border-[var(--color-border)]/30 hover:border-[var(--color-danger)]/20 transition-all duration-200 cursor-pointer"
				>
					<Trash2 className="w-3 h-3" />
					Clear
				</button>
			</div>

			{/* Empty state */}
			{history.gazePoints.length === 0 && (
				<motion.div
					initial={{ opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, delay: 0.2 }}
					className="absolute inset-0 flex flex-col items-center justify-center gap-3"
				>
					<motion.div
						animate={{ y: [0, -4, 0] }}
						transition={{
							duration: 2.5,
							repeat: Number.POSITIVE_INFINITY,
							ease: "easeInOut",
						}}
					>
						<Flame className="w-8 h-8 text-[var(--color-text-muted)] opacity-25" />
					</motion.div>
					<div className="flex flex-col items-center gap-1">
						<span className="text-[13px] font-medium text-[var(--color-text-muted)]">
							No gaze data yet
						</span>
						<span className="text-[11px] text-[var(--color-text-muted)]/50">
							Start tracking to see the heatmap
						</span>
					</div>
				</motion.div>
			)}
		</div>
	);
}
