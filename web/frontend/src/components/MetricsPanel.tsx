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
	Shield,
	Target,
} from "lucide-react";
import { useRef } from "react";
import type { TrackingData, TrackingHistory } from "../types/tracking";

interface MetricsPanelProps {
	tracking: TrackingData | null;
	history: TrackingHistory;
	isExpanded: boolean;
	onToggleExpand: () => void;
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

/* ---- Metric card — no animations, instant update ---- */

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
		<div className="rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-bg-card-hover)]/50 p-2.5 flex flex-col gap-1 min-w-0">
			<div className="flex items-center gap-1.5">
				<Icon className="w-3 h-3 shrink-0" style={{ color: color ?? "var(--color-text-muted)" }} />
				<span className="text-[9px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider truncate">
					{label}
				</span>
			</div>
			<div className="flex items-baseline gap-1 min-w-0">
				<span
					className="text-[14px] font-semibold font-mono truncate"
					style={{
						color: color ?? "var(--color-text-primary)",
						fontFeatureSettings: '"tnum"',
					}}
				>
					{value}
				</span>
				{unit && <span className="text-[9px] text-[var(--color-text-muted)] shrink-0">{unit}</span>}
			</div>
		</div>
	);
}

/* ---- Sparkline with global Y-axis max ---- */

function Sparkline({ data, globalMax }: { data: number[]; globalMax: number }) {
	if (data.length < 2) {
		return (
			<div className="h-10 flex items-center justify-center text-[10px] text-[var(--color-text-muted)]">
				Waiting for data...
			</div>
		);
	}

	const last100 = data.slice(-100);
	const w = 100;
	const h = 32;
	const yMax = globalMax || 1;
	const pts = last100
		.map((v, i) => {
			const x = (i / (last100.length - 1)) * w;
			const y = h - (v / yMax) * (h - 6) - 3;
			return `${x},${y}`;
		})
		.join(" ");

	return (
		<svg viewBox="0 0 100 32" preserveAspectRatio="none" className="w-full h-10" aria-hidden="true">
			<defs>
				<linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.2" />
					<stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.01" />
				</linearGradient>
			</defs>
			<polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#sparkFill)" />
			<polyline
				points={pts}
				fill="none"
				stroke="var(--color-accent)"
				strokeWidth="1.2"
				strokeOpacity="0.7"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

/* ---- Main panel ---- */

export function MetricsPanel({ tracking, history, isExpanded, onToggleExpand }: MetricsPanelProps) {
	const fps = tracking?.fps ?? 0;
	const confidence = tracking?.confidence ?? 0;
	const pupilSize = tracking?.pupil ? (tracking.pupil.axes[0] + tracking.pupil.axes[1]) / 2 : null;

	// Track global max for stable sparkline Y-axis
	const globalMaxRef = useRef(0);
	if (history.pupilSizes.length > 0) {
		const currentMax = Math.max(...history.pupilSizes);
		if (currentMax > globalMaxRef.current) {
			globalMaxRef.current = currentMax;
		}
	}

	return (
		<div className="glass rounded-2xl border border-[var(--color-border)]/80 flex flex-col overflow-hidden">
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

			{/* Content */}
			<div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
				{/* 3x3 grid */}
				<div className="grid grid-cols-3 gap-2">
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
						icon={Eye}
						label="Eye Center"
						value={fmtCoord2(tracking?.eyeCenter)}
						unit="px"
					/>
					<MetricCard icon={MapPin} label="Gaze Origin" value={fmtCoord3(tracking?.gaze?.origin)} />
					<MetricCard
						icon={Navigation}
						label="Gaze Dir"
						value={fmtCoord3(tracking?.gaze?.direction)}
					/>
					<MetricCard
						icon={Target}
						label="Tracking"
						value={tracking?.pupil ? "Active" : "Lost"}
						color={tracking?.pupil ? "var(--color-success)" : "var(--color-danger)"}
					/>
				</div>

				{/* Sparkline */}
				<div className="rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-bg-card-hover)]/50 p-2.5">
					<div className="flex items-center gap-1.5 mb-1.5">
						<Circle className="w-3 h-3 text-[var(--color-accent)]" />
						<span className="text-[9px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
							Pupil Size History
						</span>
						<span className="ml-auto text-[9px] text-[var(--color-text-muted)] font-mono tabular-nums">
							{history.pupilSizes.length > 0
								? `${Math.min(history.pupilSizes.length, 100)} pts`
								: ""}
						</span>
					</div>
					<Sparkline data={history.pupilSizes} globalMax={globalMaxRef.current} />
				</div>
			</div>
		</div>
	);
}
