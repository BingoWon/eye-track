import { AnimatePresence, motion } from "framer-motion";
import { Camera, Maximize2, Minimize2, Video } from "lucide-react";
import { useRef } from "react";
import type { TrackingData } from "../types/tracking";

interface VideoFeedProps {
	image: string;
	tracking: TrackingData | null;
	isExpanded: boolean;
	onToggleExpand: () => void;
}

export function VideoFeed({ image, tracking, isExpanded, onToggleExpand }: VideoFeedProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	const isActive = tracking !== null && tracking.confidence > 0;

	return (
		<motion.div
			layout
			className={`glass rounded-2xl flex flex-col overflow-hidden transition-all duration-500 ${
				isActive
					? "border border-[var(--color-accent)]/25 glow-cyan"
					: "border border-[var(--color-border)]/80"
			}`}
		>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]/60 shrink-0">
				<div className="flex items-center gap-2.5">
					<div className="w-6 h-6 rounded-md bg-[var(--color-accent)]/8 flex items-center justify-center">
						<Video className="w-3.5 h-3.5 text-[var(--color-accent)]" />
					</div>
					<span className="text-[13px] font-semibold text-[var(--color-text-primary)] tracking-tight">
						Live Feed
					</span>
					{tracking && (
						<span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-medium bg-[var(--color-accent)]/8 text-[var(--color-accent)] border border-[var(--color-accent)]/10">
							{Math.round(tracking.fps)} FPS
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={onToggleExpand}
					className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--color-bg-card-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-all cursor-pointer"
				>
					{isExpanded ? (
						<Minimize2 className="w-3.5 h-3.5" />
					) : (
						<Maximize2 className="w-3.5 h-3.5" />
					)}
				</button>
			</div>

			{/* Video area */}
			<div ref={containerRef} className="flex-1 relative min-h-0 bg-black/30">
				<AnimatePresence mode="wait">
					{image ? (
						<motion.div
							key="feed"
							initial={{ opacity: 0, scale: 0.98 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.3, ease: "easeOut" }}
							className="absolute inset-0 flex items-center justify-center"
						>
							<img
								src={`data:image/jpeg;base64,${image}`}
								alt="Camera feed"
								className="w-full h-full object-contain rounded-sm"
								draggable={false}
							/>
						</motion.div>
					) : (
						<motion.div
							key="placeholder"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							className="absolute inset-0 flex flex-col items-center justify-center gap-4"
						>
							{/* Shimmer loading skeleton */}
							<div className="absolute inset-0 animate-shimmer opacity-30" />

							<motion.div
								animate={{ y: [0, -4, 0] }}
								transition={{
									duration: 2.5,
									repeat: Number.POSITIVE_INFINITY,
									ease: "easeInOut",
								}}
								className="w-16 h-16 rounded-2xl bg-[var(--color-bg-card-hover)]/80 flex items-center justify-center border border-[var(--color-border)]/40"
							>
								<Camera className="w-7 h-7 text-[var(--color-text-muted)]" />
							</motion.div>
							<div className="flex flex-col items-center gap-2">
								<p className="text-[13px] font-medium text-[var(--color-text-muted)]">
									Waiting for camera feed
								</p>
								<div className="flex items-center gap-1.5">
									{[0, 1, 2].map((i) => (
										<motion.span
											key={i}
											className="w-1 h-1 rounded-full bg-[var(--color-accent)]/60"
											animate={{
												opacity: [0.3, 1, 0.3],
												scale: [0.8, 1.2, 0.8],
											}}
											transition={{
												duration: 1.2,
												repeat: Number.POSITIVE_INFINITY,
												delay: i * 0.2,
											}}
										/>
									))}
								</div>
							</div>
						</motion.div>
					)}
				</AnimatePresence>
			</div>

			{/* Bottom info bar - frosted glass */}
			<div className="glass-frosted flex items-center justify-between px-4 py-2 border-t border-[var(--color-border)]/40 text-[11px] font-mono shrink-0">
				<div className="flex items-center gap-2">
					<span className="text-[var(--color-text-muted)] text-[10px] uppercase tracking-wider">
						Pupil
					</span>
					<span className="text-[var(--color-text-secondary)] tabular-nums">
						{tracking?.pupil
							? `(${tracking.pupil.center[0].toFixed(1)}, ${tracking.pupil.center[1].toFixed(1)})`
							: "(---, ---)"}
					</span>
				</div>
				<div className="w-px h-3 bg-[var(--color-border)]/40" />
				<div className="flex items-center gap-2">
					<span className="text-[var(--color-text-muted)] text-[10px] uppercase tracking-wider">
						Angle
					</span>
					<span className="text-[var(--color-text-secondary)] tabular-nums">
						{tracking?.pupil ? `${tracking.pupil.angle.toFixed(1)}\u00B0` : "---\u00B0"}
					</span>
				</div>
				<div className="w-px h-3 bg-[var(--color-border)]/40" />
				<div className="flex items-center gap-2">
					<span className="text-[var(--color-text-muted)] text-[10px] uppercase tracking-wider">
						Conf
					</span>
					<span
						className="tabular-nums font-semibold"
						style={{
							color: tracking
								? tracking.confidence > 0.7
									? "var(--color-success)"
									: tracking.confidence > 0.4
										? "var(--color-warning)"
										: "var(--color-danger)"
								: "var(--color-text-muted)",
						}}
					>
						{tracking ? `${(tracking.confidence * 100).toFixed(0)}%` : "--%"}
					</span>
				</div>
			</div>
		</motion.div>
	);
}
