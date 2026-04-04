import { motion } from "framer-motion";
import {
	Crosshair,
	Eye,
	Flame,
	LayoutDashboard,
	MousePointer,
	Pause,
	Play,
	Route,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CalibrationResult } from "../lib/calibration";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
type ViewMode = "dashboard" | "heatmap" | "trail";

interface HeaderProps {
	connectionStatus: ConnectionStatus;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	fps: number;
	clientFps: number;
	calibration?: CalibrationResult | null;
	showGazeCursor?: boolean;
	paused?: boolean;
	onCalibrateClick?: () => void;
	onToggleGazeCursor?: () => void;
	onTogglePause?: () => void;
}

const VIEW_TABS: {
	mode: ViewMode;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
}[] = [
	{ mode: "dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ mode: "heatmap", label: "Heatmap", icon: Flame },
	{ mode: "trail", label: "Trail", icon: Route },
];

function fpsColor(fps: number): string {
	if (fps > 20) return "var(--color-success)";
	if (fps > 10) return "var(--color-warning)";
	return "var(--color-danger)";
}

function statusColor(status: ConnectionStatus): string {
	switch (status) {
		case "connected":
			return "var(--color-success)";
		case "connecting":
			return "var(--color-warning)";
		default:
			return "var(--color-danger)";
	}
}

function statusLabel(status: ConnectionStatus): string {
	switch (status) {
		case "connected":
			return "Connected";
		case "connecting":
			return "Connecting";
		case "disconnected":
			return "Disconnected";
		case "error":
			return "Error";
	}
}

export function Header({
	connectionStatus,
	viewMode,
	onViewModeChange,
	fps,
	clientFps,
	calibration,
	showGazeCursor,
	paused,
	onCalibrateClick,
	onToggleGazeCursor,
	onTogglePause,
}: HeaderProps) {
	const tabRefs = useRef<Map<ViewMode, HTMLButtonElement>>(new Map());
	const [indicator, setIndicator] = useState({ left: 0, width: 0 });

	useEffect(() => {
		const el = tabRefs.current.get(viewMode);
		if (el) {
			const parent = el.parentElement;
			if (parent) {
				const parentRect = parent.getBoundingClientRect();
				const elRect = el.getBoundingClientRect();
				setIndicator({
					left: elRect.left - parentRect.left,
					width: elRect.width,
				});
			}
		}
	}, [viewMode]);

	return (
		<header className="glass-heavy h-13 flex items-center justify-between px-5 relative z-50 shrink-0 border-b border-transparent">
			{/* Gradient bottom border */}
			<div
				className="absolute bottom-0 left-0 right-0 h-px"
				style={{
					background:
						"linear-gradient(90deg, transparent 0%, var(--color-border-active) 20%, var(--color-accent-dim) 50%, var(--color-border-active) 80%, transparent 100%)",
					opacity: 0.6,
				}}
			/>

			{/* Left: Logo */}
			<div className="flex items-center gap-3 min-w-[220px]">
				<div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/8 flex items-center justify-center border border-[var(--color-accent)]/10">
					<Eye className="w-[18px] h-[18px] text-[var(--color-accent)]" />
				</div>
				<div className="flex flex-col">
					<span className="text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)] leading-tight">
						Eye Tracking
					</span>
					<span className="text-[10px] font-medium text-[var(--color-text-muted)] tracking-wide uppercase">
						Platform
					</span>
				</div>
			</div>

			{/* Center: View mode tabs */}
			<nav className="relative flex items-center gap-0.5 bg-[var(--color-bg-primary)]/50 rounded-xl p-1 border border-[var(--color-border)]/50">
				<motion.div
					className="absolute top-1 bottom-1 rounded-lg bg-[var(--color-accent)]/8 border border-[var(--color-accent)]/15 shadow-[0_0_12px_rgba(34,211,238,0.06)]"
					initial={false}
					animate={{
						left: indicator.left,
						width: indicator.width,
					}}
					transition={{
						type: "spring",
						stiffness: 500,
						damping: 35,
					}}
				/>
				{VIEW_TABS.map(({ mode, label, icon: Icon }) => (
					<button
						type="button"
						key={mode}
						ref={(el) => {
							if (el) tabRefs.current.set(mode, el);
						}}
						onClick={() => onViewModeChange(mode)}
						className={`relative z-10 flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200 cursor-pointer ${
							viewMode === mode
								? "text-[var(--color-accent)]"
								: "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
						}`}
					>
						<Icon className="w-3.5 h-3.5" />
						{label}
					</button>
				))}
			</nav>

			{/* Right: Pause + FPS + Connection */}
			<div className="flex items-center gap-2.5 min-w-[320px] justify-end">
				{/* Pause/Resume button */}
				{onTogglePause && (
					<button
						type="button"
						onClick={onTogglePause}
						className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-all duration-200 border ${
							paused
								? "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/20 hover:bg-[var(--color-warning)]/15"
								: "bg-[var(--color-bg-primary)]/40 text-[var(--color-text-muted)] border-[var(--color-border)]/40 hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)]/40"
						}`}
					>
						{paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
						{paused ? "Resume" : "Pause"}
					</button>
				)}

				{/* Server FPS */}
				<div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--color-bg-primary)]/40 border border-[var(--color-border)]/40 text-[11px] font-mono">
					<span
						className="w-1.5 h-1.5 rounded-full transition-colors duration-500"
						style={{ backgroundColor: fpsColor(fps) }}
					/>
					<span className="text-[var(--color-text-muted)] text-[10px] uppercase tracking-wider">
						Srv
					</span>
					<span className="text-[var(--color-text-secondary)] font-semibold tabular-nums min-w-[18px] text-right">
						{Math.round(fps)}
					</span>
				</div>

				{/* Client FPS */}
				<div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--color-bg-primary)]/40 border border-[var(--color-border)]/40 text-[11px] font-mono">
					<span
						className="w-1.5 h-1.5 rounded-full transition-colors duration-500"
						style={{ backgroundColor: fpsColor(clientFps) }}
					/>
					<span className="text-[var(--color-text-muted)] text-[10px] uppercase tracking-wider">
						Cli
					</span>
					<span className="text-[var(--color-text-secondary)] font-semibold tabular-nums min-w-[18px] text-right">
						{Math.round(clientFps)}
					</span>
				</div>

				{/* Calibrate button */}
				{onCalibrateClick && (
					<button
						type="button"
						onClick={onCalibrateClick}
						className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-200 cursor-pointer border ${
							calibration
								? "bg-[var(--color-success)]/8 text-[var(--color-success)] border-[var(--color-success)]/15 hover:bg-[var(--color-success)]/15"
								: "bg-[var(--color-bg-primary)]/40 text-[var(--color-text-muted)] border-[var(--color-border)]/40 hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)]/40"
						}`}
					>
						<Crosshair className="w-3 h-3" />
						{calibration ? "Calibrated" : "Calibrate"}
					</button>
				)}

				{/* Gaze cursor toggle */}
				{onToggleGazeCursor && (
					<button
						type="button"
						onClick={onToggleGazeCursor}
						className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-200 cursor-pointer border ${
							showGazeCursor
								? "bg-[var(--color-accent)]/8 text-[var(--color-accent)] border-[var(--color-accent)]/15 hover:bg-[var(--color-accent)]/15"
								: "bg-[var(--color-bg-primary)]/40 text-[var(--color-text-muted)] border-[var(--color-border)]/40 hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)]/40"
						}`}
					>
						<MousePointer className="w-3 h-3" />
						Cursor
					</button>
				)}

				{/* Divider */}
				<div className="w-px h-5 bg-gradient-to-b from-transparent via-[var(--color-border-active)] to-transparent" />

				{/* Connection status */}
				<div className="flex items-center gap-2 text-[11px]">
					<span className="relative flex h-2 w-2">
						{connectionStatus === "connected" && (
							<span
								className="absolute inline-flex h-full w-full rounded-full animate-pulse-glow"
								style={{
									backgroundColor: statusColor(connectionStatus),
								}}
							/>
						)}
						<span
							className="relative inline-flex rounded-full h-2 w-2 shadow-[0_0_6px_currentColor]"
							style={{
								backgroundColor: statusColor(connectionStatus),
								color: statusColor(connectionStatus),
							}}
						/>
					</span>
					<span className="text-[var(--color-text-secondary)] font-medium tracking-wide">
						{statusLabel(connectionStatus)}
					</span>
				</div>
			</div>
		</header>
	);
}
