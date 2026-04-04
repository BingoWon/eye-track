import { AnimatePresence, motion } from "framer-motion";
import { Camera, ImageDown, Video } from "lucide-react";
import { useCallback, useRef } from "react";
import type { TrackingData } from "../types/tracking";

interface VideoFeedProps {
	image: string;
	tracking: TrackingData | null;
}

export function VideoFeed({ image, tracking }: VideoFeedProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);

	const isActive = tracking !== null && tracking.pupil !== null;
	const isRejected = tracking !== null && tracking.pupil === null && tracking.confidence > 0;

	const copyScreenshot = useCallback(() => {
		const img = imgRef.current;
		if (!img) return;
		const canvas = document.createElement("canvas");
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.drawImage(img, 0, 0);
		canvas.toBlob((blob) => {
			if (blob) {
				navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(() => {});
			}
		});
	}, []);

	return (
		<motion.div
			layout
			className={`glass rounded-2xl flex flex-col overflow-hidden transition-all duration-300 ${
				isRejected
					? "border border-[var(--color-danger)]/40"
					: isActive
						? "border border-[var(--color-accent)]/25"
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
				</div>
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
								ref={imgRef}
								src={`data:image/jpeg;base64,${image}`}
								alt="Camera feed"
								className="w-full h-full object-contain rounded-sm transition-all duration-150"
								style={isRejected ? { filter: "saturate(0) brightness(0.6)" } : undefined}
								draggable={false}
							/>
							{/* Screenshot button */}
							<button
								type="button"
								onClick={copyScreenshot}
								className="absolute bottom-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center bg-black/40 hover:bg-black/60 text-white/60 hover:text-white transition-all cursor-pointer"
								title="Screenshot to clipboard"
							>
								<ImageDown className="w-3.5 h-3.5" />
							</button>
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
		</motion.div>
	);
}
