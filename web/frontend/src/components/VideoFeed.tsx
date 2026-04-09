import { AnimatePresence, motion } from "framer-motion";
import {
	Activity,
	Camera,
	Circle,
	Crosshair,
	ImageDown,
	Navigation,
	RotateCw,
	Shield,
	Target,
	Video,
} from "lucide-react";
import { useCallback, useRef } from "react";
import type { TrackingData, TrackingHistory } from "../types/tracking";

interface VideoFeedProps {
	image: string;
	tracking: TrackingData | null;
	history?: TrackingHistory;
	label?: string;
	trackerId?: string;
	showMetrics?: boolean;
}

function fpsColor(fps: number): string {
	if (fps >= 25) return "var(--color-success)";
	if (fps >= 12) return "var(--color-warning)";
	return "var(--color-danger)";
}

function confidenceColor(c: number): string {
	if (c >= 0.7) return "var(--color-success)";
	if (c >= 0.4) return "var(--color-warning)";
	return "var(--color-danger)";
}

function fmt(n: number | undefined | null, decimals = 1): string {
	if (n == null || Number.isNaN(n)) return "\u2014";
	return n.toFixed(decimals);
}

function fmtCoord2(pair: [number, number] | null | undefined): string {
	if (!pair) return "\u2014";
	return `${pair[0].toFixed(1)}, ${pair[1].toFixed(1)}`;
}

function fmtCoord3(triple: [number, number, number] | null | undefined): string {
	if (!triple) return "\u2014";
	return `${triple[0].toFixed(2)}, ${triple[1].toFixed(2)}, ${triple[2].toFixed(2)}`;
}

export function VideoFeed({
	image,
	tracking,
	history,
	label,
	trackerId,
	showMetrics = false,
}: VideoFeedProps) {
	const imgRef = useRef<HTMLImageElement>(null);
	const globalMaxRef = useRef(0);

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

	const fps = tracking?.fps ?? 0;
	const confidence = tracking?.confidence ?? 0;
	const pupilSize = tracking?.pupil ? (tracking.pupil.axes[0] + tracking.pupil.axes[1]) / 2 : null;
	const hasClassic = tracking?.eyeCenterClassic != null;
	const hasEnhanced = tracking?.eyeCenterEnhanced != null;
	const hasGaze = tracking?.gaze != null;

	if (history && history.pupilSizes.length > 0) {
		const currentMax = Math.max(...history.pupilSizes);
		if (currentMax > globalMaxRef.current) globalMaxRef.current = currentMax;
	} else {
		globalMaxRef.current = 0;
	}

	return (
		<div
			className={`glass rounded-2xl flex flex-col overflow-hidden transition-all duration-200 ${
				isRejected
					? "border border-[var(--color-danger)]/40"
					: isActive
						? "border border-[var(--color-accent)]/25"
						: "border border-[var(--color-border)]/80"
			}`}
		>
			{/* Header */}
			<div className="flex items-center px-3 py-2 border-b border-[var(--color-border)]/40 shrink-0 gap-2 min-w-0">
				<Video className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
				<span className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">
					{label ?? "Live Feed"}
				</span>
				{trackerId && (
					<span className="text-[11px] text-[var(--color-text-secondary)] font-mono truncate">
						{trackerId}
					</span>
				)}
			</div>

			{/* Video — fixed 4:3 aspect ratio */}
			<div className="relative w-full" style={{ aspectRatio: "4/3" }}>
				<AnimatePresence mode="wait">
					{image ? (
						<motion.div
							key="feed"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.2 }}
							className="absolute inset-0"
						>
							<img
								ref={imgRef}
								src={`data:image/jpeg;base64,${image}`}
								alt="Camera feed"
								className="w-full h-full object-cover"
								style={isRejected ? { filter: "saturate(0) brightness(0.6)" } : undefined}
								draggable={false}
							/>
							<button
								type="button"
								onClick={copyScreenshot}
								className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center bg-black/40 hover:bg-black/60 text-white/60 hover:text-white transition-all cursor-pointer"
								title="Screenshot"
							>
								<ImageDown className="w-3 h-3" />
							</button>
						</motion.div>
					) : (
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/20">
							<Camera className="w-8 h-8 text-[var(--color-text-muted)]/40" />
							<p className="text-[11px] text-[var(--color-text-muted)]">Waiting for feed</p>
						</div>
					)}
				</AnimatePresence>
			</div>

			{/* Metrics — full stats below video */}
			{showMetrics && (
				<div className="p-2.5 flex flex-col gap-2 border-t border-[var(--color-border)]/40">
					{/* Primary 3x2 grid */}
					<div className="grid grid-cols-3 gap-1.5">
						<MetricCard
							icon={Activity}
							label="FPS"
							value={tracking ? Math.round(fps).toString() : "\u2014"}
							unit="fps"
							color={tracking ? fpsColor(fps) : undefined}
						/>
						<MetricCard
							icon={Shield}
							label="Confidence"
							value={tracking ? `${(confidence * 100).toFixed(0)}%` : "\u2014"}
							color={tracking ? confidenceColor(confidence) : undefined}
						/>
						<MetricCard
							icon={Circle}
							label="Pupil Size"
							value={fmt(pupilSize)}
							unit="px"
							color="var(--color-accent)"
						/>
						<MetricCard
							icon={Crosshair}
							label="Pupil XY"
							value={fmtCoord2(tracking?.pupil?.center)}
							unit="px"
						/>
						<MetricCard
							icon={RotateCw}
							label="Pupil Angle"
							value={fmt(tracking?.pupil?.angle, 1)}
							unit="deg"
						/>
						<MetricCard
							icon={Target}
							label="Tracking"
							value={tracking?.pupil ? "Active" : "Lost"}
							color={tracking?.pupil ? "var(--color-success)" : "var(--color-danger)"}
						/>
					</div>

					{/* Eye center + gaze row */}
					{(hasClassic || hasEnhanced || hasGaze) && (
						<div className="grid grid-cols-3 gap-1.5">
							{hasClassic && (
								<MetricCard
									icon={Crosshair}
									label="Classic Eye"
									value={fmtCoord2(tracking?.eyeCenterClassic)}
									unit="px"
									color="rgb(50, 130, 255)"
								/>
							)}
							{hasEnhanced && (
								<MetricCard
									icon={Crosshair}
									label="Enhanced Eye"
									value={fmtCoord2(tracking?.eyeCenterEnhanced)}
									unit="px"
									color="rgb(200, 50, 200)"
								/>
							)}
							{hasGaze && (
								<MetricCard
									icon={Navigation}
									label="Gaze Dir"
									value={fmtCoord3(tracking?.gaze?.direction)}
								/>
							)}
						</div>
					)}

					{/* Sparkline */}
					{history && history.pupilSizes.length > 1 && (
						<Sparkline data={history.pupilSizes} globalMax={globalMaxRef.current} />
					)}
				</div>
			)}
		</div>
	);
}

/* Metric card — compact */
function MetricCard({
	icon: Icon,
	label,
	value,
	unit,
	color,
}: {
	icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
	label: string;
	value: string;
	unit?: string;
	color?: string;
}) {
	return (
		<div className="rounded-lg border border-[var(--color-border)]/40 bg-[var(--color-bg-card-hover)]/50 p-2.5 flex flex-col gap-0.5 min-w-0">
			<div className="flex items-center gap-1.5">
				<Icon className="w-3 h-3 shrink-0" style={{ color: color ?? "var(--color-text-muted)" }} />
				<span className="text-[10px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wider truncate">
					{label}
				</span>
			</div>
			<div className="flex items-baseline gap-1 min-w-0">
				<span
					className="text-[13px] font-semibold font-mono truncate"
					style={{ color: color ?? "var(--color-text-primary)", fontFeatureSettings: '"tnum"' }}
				>
					{value}
				</span>
				{unit && (
					<span className="text-[10px] text-[var(--color-text-secondary)] shrink-0">{unit}</span>
				)}
			</div>
		</div>
	);
}

/* Sparkline */
function Sparkline({ data, globalMax }: { data: number[]; globalMax: number }) {
	const last100 = data.slice(-100);
	const yMax = globalMax || 1;
	const w = 100;
	const h = 24;
	const pts = last100
		.map((v, i) => {
			const x = (i / (last100.length - 1)) * w;
			const y = h - (v / yMax) * (h - 4) - 2;
			return `${x},${y}`;
		})
		.join(" ");

	return (
		<div className="rounded-lg border border-[var(--color-border)]/40 bg-[var(--color-bg-card-hover)]/50 p-2.5">
			<div className="flex items-center gap-1.5 mb-1">
				<Circle className="w-3 h-3 text-[var(--color-accent)]" />
				<span className="text-[10px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
					Pupil Size
				</span>
				<span className="ml-auto text-[10px] text-[var(--color-text-secondary)] font-mono">
					{Math.min(last100.length, 100)} pts
				</span>
			</div>
			<svg
				viewBox={`0 0 ${w} ${h}`}
				preserveAspectRatio="none"
				className="w-full h-6"
				aria-hidden="true"
			>
				<defs>
					<linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.15" />
						<stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.01" />
					</linearGradient>
				</defs>
				<polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#sparkFill)" />
				<polyline
					points={pts}
					fill="none"
					stroke="var(--color-accent)"
					strokeWidth="1"
					strokeOpacity="0.6"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
		</div>
	);
}
