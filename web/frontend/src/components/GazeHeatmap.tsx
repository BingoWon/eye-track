import { motion } from "framer-motion";
import { Flame, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { TrackingHistory } from "../types/tracking";

interface GazeHeatmapProps {
	history: TrackingHistory;
	onClear: () => void;
}

const SRC_W = 640;
const SRC_H = 480;
const BLOB_RADIUS = 40;

export function GazeHeatmap({ history, onClear }: GazeHeatmapProps) {
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

	/* Draw heatmap */
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const id = requestAnimationFrame(() => {
			const w = canvas.width;
			const h = canvas.height;
			const dpr = window.devicePixelRatio || 1;

			// Scale factors
			const scaleX = w / SRC_W;
			const scaleY = h / SRC_H;
			const scale = Math.min(scaleX, scaleY);
			const offX = (w - SRC_W * scale) / 2;
			const offY = (h - SRC_H * scale) / 2;

			ctx.clearRect(0, 0, w, h);

			// Background with subtle radial gradient
			const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
			bgGrad.addColorStop(0, "#0a0f18");
			bgGrad.addColorStop(1, "#06080f");
			ctx.fillStyle = bgGrad;
			ctx.fillRect(0, 0, w, h);

			// Draw refined grid
			ctx.save();
			const gridStep = 80;

			// Grid lines - very subtle
			ctx.strokeStyle = "rgba(33, 38, 45, 0.3)";
			ctx.lineWidth = 1;
			for (let gx = 0; gx <= SRC_W; gx += gridStep) {
				const x = offX + gx * scale;
				ctx.beginPath();
				ctx.moveTo(x, offY);
				ctx.lineTo(x, offY + SRC_H * scale);
				ctx.stroke();
			}
			for (let gy = 0; gy <= SRC_H; gy += gridStep) {
				const y = offY + gy * scale;
				ctx.beginPath();
				ctx.moveTo(offX, y);
				ctx.lineTo(offX + SRC_W * scale, y);
				ctx.stroke();
			}

			// Border with subtle glow
			ctx.strokeStyle = "rgba(33, 38, 45, 0.6)";
			ctx.lineWidth = 1;
			ctx.strokeRect(offX, offY, SRC_W * scale, SRC_H * scale);

			// Corner accents
			const cornerLen = 12 * dpr;
			ctx.strokeStyle = "rgba(34, 211, 238, 0.25)";
			ctx.lineWidth = 1.5;
			const corners = [
				[offX, offY, 1, 1],
				[offX + SRC_W * scale, offY, -1, 1],
				[offX, offY + SRC_H * scale, 1, -1],
				[offX + SRC_W * scale, offY + SRC_H * scale, -1, -1],
			];
			for (const [cx, cy, dx, dy] of corners) {
				ctx.beginPath();
				ctx.moveTo(cx + cornerLen * dx, cy);
				ctx.lineTo(cx, cy);
				ctx.lineTo(cx, cy + cornerLen * dy);
				ctx.stroke();
			}
			ctx.restore();

			// Draw heatmap blobs with richer gradient
			if (history.gazePoints.length > 0) {
				ctx.save();
				ctx.globalCompositeOperation = "lighter";

				const radius = BLOB_RADIUS * scale * (1 / dpr) * dpr;
				const points = history.gazePoints;

				for (let i = 0; i < points.length; i++) {
					const [px, py] = points[i];
					const cx = offX + px * scale;
					const cy = offY + py * scale;

					const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
					gradient.addColorStop(0, "rgba(34, 211, 238, 0.05)");
					gradient.addColorStop(0.2, "rgba(34, 211, 238, 0.035)");
					gradient.addColorStop(0.5, "rgba(52, 211, 153, 0.018)");
					gradient.addColorStop(0.8, "rgba(251, 191, 36, 0.006)");
					gradient.addColorStop(1, "rgba(52, 211, 153, 0)");

					ctx.fillStyle = gradient;
					ctx.beginPath();
					ctx.arc(cx, cy, radius, 0, Math.PI * 2);
					ctx.fill();
				}

				ctx.restore();

				// Draw the most recent point
				if (points.length > 0) {
					const [lx, ly] = points[points.length - 1];
					const lcx = offX + lx * scale;
					const lcy = offY + ly * scale;

					// Outer glow
					const glow = ctx.createRadialGradient(lcx, lcy, 0, lcx, lcy, 16 * dpr);
					glow.addColorStop(0, "rgba(34, 211, 238, 0.5)");
					glow.addColorStop(0.3, "rgba(34, 211, 238, 0.15)");
					glow.addColorStop(0.6, "rgba(34, 211, 238, 0.05)");
					glow.addColorStop(1, "rgba(34, 211, 238, 0)");
					ctx.fillStyle = glow;
					ctx.beginPath();
					ctx.arc(lcx, lcy, 16 * dpr, 0, Math.PI * 2);
					ctx.fill();

					// Core dot with white center
					ctx.fillStyle = "#22d3ee";
					ctx.beginPath();
					ctx.arc(lcx, lcy, 3.5 * dpr, 0, Math.PI * 2);
					ctx.fill();

					ctx.fillStyle = "#ffffff";
					ctx.beginPath();
					ctx.arc(lcx, lcy, 1.5 * dpr, 0, Math.PI * 2);
					ctx.fill();
				}
			}

			// Axis labels - cleaner
			ctx.fillStyle = "rgba(72, 79, 88, 0.5)";
			ctx.font = `${9 * dpr}px "Inter", monospace`;
			ctx.textAlign = "center";
			for (let gx = 0; gx <= SRC_W; gx += gridStep * 2) {
				ctx.fillText(String(gx), offX + gx * scale, offY + SRC_H * scale + 14 * dpr);
			}
			ctx.textAlign = "right";
			for (let gy = 0; gy <= SRC_H; gy += gridStep * 2) {
				ctx.fillText(String(gy), offX - 6 * dpr, offY + gy * scale + 4 * dpr);
			}
		});

		return () => cancelAnimationFrame(id);
	}, [history]);

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 0.4 }}
			className="glass rounded-2xl border border-[var(--color-border)]/80 flex flex-col overflow-hidden h-full"
		>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]/60 shrink-0">
				<div className="flex items-center gap-2.5">
					<div className="w-6 h-6 rounded-md bg-[var(--color-accent)]/8 flex items-center justify-center border border-[var(--color-accent)]/10">
						<Flame className="w-3.5 h-3.5 text-[var(--color-accent)]" />
					</div>
					<h2 className="text-[13px] font-semibold text-[var(--color-text-primary)] tracking-tight">
						Gaze Heatmap
					</h2>
				</div>
				<div className="flex items-center gap-3">
					<span className="text-[10px] font-mono text-[var(--color-text-muted)] tabular-nums px-2 py-0.5 rounded-md bg-[var(--color-bg-primary)]/40 border border-[var(--color-border)]/40">
						{history.gazePoints.length.toLocaleString()} pts
					</span>
					<button
						type="button"
						onClick={onClear}
						className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/8 border border-[var(--color-border)]/60 hover:border-[var(--color-danger)]/20 transition-all duration-200 cursor-pointer"
					>
						<Trash2 className="w-3 h-3" />
						Clear
					</button>
				</div>
			</div>

			{/* Canvas */}
			<div ref={containerRef} className="flex-1 relative min-h-0">
				<canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

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
		</motion.div>
	);
}
