import { AnimatePresence, motion } from "framer-motion";
import {
	Activity,
	BarChart3,
	Circle,
	Crosshair,
	Eye,
	MapPin,
	Maximize2,
	Minimize2,
	Navigation,
	RotateCw,
	Target,
} from "lucide-react";
import { useMemo } from "react";
import type { TrackingData, TrackingHistory } from "../types/tracking";

interface MetricsPanelProps {
	tracking: TrackingData | null;
	history: TrackingHistory;
	isExpanded: boolean;
	onToggleExpand: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Mini circular progress (confidence ring)                          */
/* ------------------------------------------------------------------ */

function ConfidenceRing({ value, color }: { value: number; color: string }) {
	const r = 11;
	const circumference = 2 * Math.PI * r;
	const offset = circumference * (1 - value);

	return (
		<svg width="30" height="30" viewBox="0 0 30 30" className="shrink-0" aria-hidden="true">
			<circle
				cx="15"
				cy="15"
				r={r}
				fill="none"
				stroke="var(--color-border)"
				strokeWidth="2"
				opacity="0.5"
			/>
			<circle
				cx="15"
				cy="15"
				r={r}
				fill="none"
				stroke={color}
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeDasharray={circumference}
				strokeDashoffset={offset}
				transform="rotate(-90 15 15)"
				style={{
					transition: "stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
					filter: `drop-shadow(0 0 3px ${color})`,
				}}
			/>
			<text
				x="15"
				y="15"
				textAnchor="middle"
				dominantBaseline="central"
				fill={color}
				fontSize="7.5"
				fontWeight="600"
				fontFamily="'Inter', monospace"
			>
				{Math.round(value * 100)}
			</text>
		</svg>
	);
}

/* ------------------------------------------------------------------ */
/*  Sparkline (pupil size history)                                    */
/* ------------------------------------------------------------------ */

function Sparkline({ data }: { data: number[] }) {
	const { points, areaPoints } = useMemo(() => {
		if (data.length < 2) return { points: "", areaPoints: "" };
		const last100 = data.slice(-100);
		const min = Math.min(...last100);
		const max = Math.max(...last100);
		const range = max - min || 1;
		const w = 100;
		const h = 32;
		const pts = last100.map((v, i) => {
			const x = (i / (last100.length - 1)) * w;
			const y = h - ((v - min) / range) * (h - 6) - 3;
			return `${x},${y}`;
		});
		return {
			points: pts.join(" "),
			areaPoints: `0,${h} ${pts.join(" ")} ${w},${h}`,
		};
	}, [data]);

	if (data.length < 2) {
		return (
			<div className="h-10 flex items-center justify-center text-[11px] text-[var(--color-text-muted)]">
				<motion.span
					animate={{ opacity: [0.4, 0.8, 0.4] }}
					transition={{
						duration: 2,
						repeat: Number.POSITIVE_INFINITY,
					}}
				>
					Waiting for data...
				</motion.span>
			</div>
		);
	}

	return (
		<svg viewBox="0 0 100 32" preserveAspectRatio="none" className="w-full h-10" aria-hidden="true">
			<defs>
				<linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.25" />
					<stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.01" />
				</linearGradient>
				<linearGradient id="sparkLine" x1="0" y1="0" x2="1" y2="0">
					<stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.2" />
					<stop offset="100%" stopColor="var(--color-accent)" stopOpacity="1" />
				</linearGradient>
			</defs>
			{/* Fill area */}
			{areaPoints && <polygon points={areaPoints} fill="url(#sparkGrad)" />}
			{/* Line */}
			<polyline
				points={points}
				fill="none"
				stroke="url(#sparkLine)"
				strokeWidth="1.2"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

/* ------------------------------------------------------------------ */
/*  Individual metric card                                            */
/* ------------------------------------------------------------------ */

interface MetricCardProps {
	icon: React.ComponentType<{
		className?: string;
		style?: React.CSSProperties;
	}>;
	label: string;
	value: string;
	unit?: string;
	color?: string;
	extra?: React.ReactNode;
}

function MetricCard({ icon: Icon, label, value, unit, color, extra }: MetricCardProps) {
	return (
		<motion.div
			whileHover={{
				y: -1,
				transition: { duration: 0.2 },
			}}
			className="rounded-xl border border-[var(--color-border)]/60 bg-[var(--color-bg-card-hover)]/60 p-3 flex flex-col gap-1.5 min-w-0 hover:border-[var(--color-border-active)]/60 hover:bg-[var(--color-bg-card-hover)] transition-all duration-300 group"
		>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<Icon
						className="w-3.5 h-3.5 shrink-0 transition-colors duration-300"
						style={{
							color: color ?? "var(--color-text-muted)",
						}}
					/>
					<span className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider truncate group-hover:text-[var(--color-text-secondary)] transition-colors duration-300">
						{label}
					</span>
				</div>
				{extra}
			</div>
			<AnimatePresence mode="wait">
				<motion.div
					key={value}
					initial={{ opacity: 0, y: 4 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -4 }}
					transition={{ duration: 0.18 }}
					className="flex items-baseline gap-1 min-w-0"
				>
					<span
						className="text-[15px] font-semibold font-mono truncate"
						style={{
							color: color ?? "var(--color-text-primary)",
							fontFeatureSettings: '"tnum"',
						}}
					>
						{value}
					</span>
					{unit && (
						<span className="text-[9px] text-[var(--color-text-muted)] shrink-0 font-medium">
							{unit}
						</span>
					)}
				</motion.div>
			</AnimatePresence>
		</motion.div>
	);
}

/* ------------------------------------------------------------------ */
/*  Main panel                                                        */
/* ------------------------------------------------------------------ */

export function MetricsPanel({ tracking, history, isExpanded, onToggleExpand }: MetricsPanelProps) {
	const fps = tracking?.fps ?? 0;
	const confidence = tracking?.confidence ?? 0;
	const pupilSize = tracking?.pupil ? (tracking.pupil.axes[0] + tracking.pupil.axes[1]) / 2 : null;

	return (
		<motion.div
			layout
			className="glass rounded-2xl border border-[var(--color-border)]/80 flex flex-col overflow-hidden"
			transition={{
				layout: { duration: 0.25, ease: "easeInOut" },
			}}
		>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]/60 shrink-0">
				<div className="flex items-center gap-2.5">
					<div className="w-6 h-6 rounded-md bg-[var(--color-accent)]/8 flex items-center justify-center border border-[var(--color-accent)]/10">
						<BarChart3 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
					</div>
					<h2 className="text-[13px] font-semibold text-[var(--color-text-primary)] tracking-tight">
						Metrics
					</h2>
				</div>
				<button
					type="button"
					onClick={onToggleExpand}
					className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)] transition-all cursor-pointer"
				>
					{isExpanded ? (
						<Minimize2 className="w-3.5 h-3.5" />
					) : (
						<Maximize2 className="w-3.5 h-3.5" />
					)}
				</button>
			</div>

			{/* Scrollable content */}
			<div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
				{/* Metric cards grid */}
				<div className="grid grid-cols-2 gap-2">
					{/* 1. FPS */}
					<MetricCard
						icon={Activity}
						label="FPS"
						value={tracking ? Math.round(fps).toString() : "\u2014"}
						unit="fps"
						color={tracking ? fpsColor(fps) : undefined}
					/>

					{/* 2. Confidence */}
					<MetricCard
						icon={Target}
						label="Confidence"
						value={tracking ? `${(confidence * 100).toFixed(0)}%` : "\u2014"}
						color={tracking ? confidenceColor(confidence) : undefined}
						extra={
							tracking ? (
								<ConfidenceRing value={confidence} color={confidenceColor(confidence)} />
							) : undefined
						}
					/>

					{/* 3. Pupil Center */}
					<MetricCard
						icon={Crosshair}
						label="Pupil Center"
						value={fmtCoord2(tracking?.pupil?.center)}
						unit="px"
					/>

					{/* 4. Pupil Size */}
					<MetricCard
						icon={Circle}
						label="Pupil Size"
						value={fmt(pupilSize)}
						unit="px"
						color="var(--color-accent)"
					/>

					{/* 5. Gaze Origin */}
					<MetricCard
						icon={MapPin}
						label="Gaze Origin"
						value={fmtCoord3(tracking?.gaze?.origin)}
						unit="mm"
					/>

					{/* 6. Gaze Direction */}
					<MetricCard
						icon={Navigation}
						label="Gaze Dir"
						value={fmtCoord3(tracking?.gaze?.direction)}
					/>

					{/* 7. Eye Center */}
					<MetricCard
						icon={Eye}
						label="Eye Center"
						value={fmtCoord2(tracking?.eyeCenter)}
						unit="px"
					/>

					{/* 8. Pupil Angle */}
					<MetricCard
						icon={RotateCw}
						label="Pupil Angle"
						value={fmt(tracking?.pupil?.angle, 1)}
						unit="deg"
					/>
				</div>

				{/* Sparkline: Pupil Size History */}
				<div className="rounded-xl border border-[var(--color-border)]/60 bg-[var(--color-bg-card-hover)]/60 p-3">
					<div className="flex items-center gap-1.5 mb-2">
						<Circle className="w-3 h-3 text-[var(--color-accent)]" />
						<span className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
							Pupil Size History
						</span>
						<span className="ml-auto text-[10px] text-[var(--color-text-muted)] font-mono tabular-nums">
							{history.pupilSizes.length > 0
								? `${Math.min(history.pupilSizes.length, 100)} pts`
								: ""}
						</span>
					</div>
					<Sparkline data={history.pupilSizes} />
				</div>
			</div>
		</motion.div>
	);
}
