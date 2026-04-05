import { motion } from "framer-motion";
import {
	Crosshair,
	Eye,
	Flame,
	LayoutDashboard,
	MousePointer,
	Pause,
	Play,
	RotateCcw,
	Route,
	ScanEye,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CalibrationResult } from "../lib/calibration";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
type ViewMode = "dashboard" | "heatmap" | "trail";

interface HeaderProps {
	connectionStatus: ConnectionStatus;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	calibration?: CalibrationResult | null;
	showGazeCursor?: boolean;
	paused?: boolean;
	trackerCount?: number;
	rangeCalibrated?: boolean;
	onCalibrateClick?: () => void;
	onClearCalibration?: () => void;
	onRangeCalibrateClick?: () => void;
	onClearRangeCalibration?: () => void;
	onToggleGazeCursor?: () => void;
	onTogglePause?: () => void;
	onChangeCameraClick?: () => void;
	onResetAll?: () => void;
	mode?: "classic" | "enhanced" | "screen";
	onModeChange?: (mode: "classic" | "enhanced" | "screen") => void;
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

const COLOR_MAP = {
	accent: { bg: "34,211,238", text: "var(--color-accent)" },
	success: { bg: "52,211,153", text: "var(--color-success)" },
	warning: { bg: "251,191,36", text: "var(--color-warning)" },
};

function HeaderButton({
	icon: Icon,
	label,
	onClick,
	active = false,
	disabled = false,
	activeColor = "accent",
	inactiveColor = "accent",
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	onClick?: () => void;
	active?: boolean;
	disabled?: boolean;
	activeColor?: keyof typeof COLOR_MAP;
	inactiveColor?: keyof typeof COLOR_MAP;
}) {
	const c = active ? COLOR_MAP[activeColor] : COLOR_MAP[inactiveColor];
	return (
		<button
			type="button"
			onClick={disabled ? undefined : onClick}
			disabled={disabled}
			className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 border ${
				disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer active:scale-95"
			}`}
			style={
				disabled
					? {
							backgroundColor: "rgba(139,148,158,0.06)",
							borderColor: "rgba(139,148,158,0.1)",
							color: "var(--color-text-muted)",
						}
					: {
							backgroundColor: `rgba(${c.bg}, ${active ? 0.12 : 0.08})`,
							borderColor: `rgba(${c.bg}, ${active ? 0.3 : 0.2})`,
							color: c.text,
						}
			}
		>
			<Icon className="w-3.5 h-3.5" />
			{label}
		</button>
	);
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
	calibration,
	showGazeCursor,
	paused,
	trackerCount,
	rangeCalibrated,
	onCalibrateClick,
	onClearCalibration,
	onRangeCalibrateClick,
	onClearRangeCalibration,
	onToggleGazeCursor,
	onTogglePause,
	onChangeCameraClick,
	onResetAll,
	mode,
	onModeChange,
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
				{trackerCount != null && trackerCount > 0 && onChangeCameraClick && (
					<button
						type="button"
						onClick={onChangeCameraClick}
						className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20 cursor-pointer hover:bg-[var(--color-accent)]/15 transition-colors"
					>
						{trackerCount} {trackerCount === 1 ? "Camera" : "Cameras"}
					</button>
				)}
			</div>

			{/* Center: Mode tabs + View tabs */}
			<div className="flex items-center gap-3">
				{/* Mode tabs */}
				{onModeChange && (
					<nav className="relative flex items-center gap-0.5 bg-[var(--color-bg-primary)]/50 rounded-xl p-1 border border-[var(--color-border)]/50">
						{(
							[
								{ value: "classic", label: "Classic" },
								{ value: "enhanced", label: "Enhanced" },
								{ value: "screen", label: "Screen" },
							] as const
						).map(({ value, label }) => (
							<button
								key={value}
								type="button"
								onClick={() => onModeChange(value)}
								className={`relative z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 cursor-pointer ${
									mode === value
										? "bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20"
										: "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-transparent"
								}`}
							>
								{label}
							</button>
						))}
					</nav>
				)}

				{/* Divider dot */}
				<span className="w-1 h-1 rounded-full bg-[var(--color-text-muted)]/40" />

				{/* View tabs */}
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
			</div>

			{/* Right: Actions + FPS + Connection */}
			<div className="flex items-center gap-2 min-w-[320px] justify-end">
				{/* Action buttons — unified style */}
				{onTogglePause && (
					<HeaderButton
						icon={paused ? Play : Pause}
						label={paused ? "Resume" : "Pause"}
						onClick={onTogglePause}
						active={paused}
						activeColor="warning"
						inactiveColor="accent"
					/>
				)}
				{onRangeCalibrateClick && (
					<div className="relative group">
						<HeaderButton
							icon={ScanEye}
							label={rangeCalibrated ? "Bounds Cal ✓" : "Bounds Cal"}
							onClick={onRangeCalibrateClick}
							active={!!rangeCalibrated}
							activeColor="success"
							inactiveColor="accent"
						/>
						{rangeCalibrated && onClearRangeCalibration && (
							<button
								type="button"
								onClick={onClearRangeCalibration}
								className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-danger)] text-white text-[8px] font-bold items-center justify-center cursor-pointer hidden group-hover:flex"
								title="Clear range calibration"
							>
								×
							</button>
						)}
					</div>
				)}
				{onCalibrateClick && (
					<div className="relative group">
						<HeaderButton
							icon={Crosshair}
							label={calibration ? "Gaze Cal ✓" : "Gaze Cal"}
							onClick={onCalibrateClick}
							active={!!calibration}
							activeColor="success"
							inactiveColor="accent"
						/>
						{calibration && onClearCalibration && (
							<button
								type="button"
								onClick={onClearCalibration}
								className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-danger)] text-white text-[8px] font-bold items-center justify-center cursor-pointer hidden group-hover:flex"
								title="Clear gaze calibration"
							>
								×
							</button>
						)}
					</div>
				)}
				{onToggleGazeCursor && (
					<HeaderButton
						icon={MousePointer}
						label="Cursor"
						onClick={calibration ? onToggleGazeCursor : undefined}
						disabled={!calibration}
						active={!!calibration && !!showGazeCursor}
						activeColor="accent"
						inactiveColor="accent"
					/>
				)}

				{onResetAll && (
					<HeaderButton
						icon={RotateCcw}
						label="Reset"
						onClick={onResetAll}
						inactiveColor="accent"
					/>
				)}

				{/* Connection dot */}
				<span
					className="w-2 h-2 rounded-full"
					style={{ backgroundColor: statusColor(connectionStatus) }}
					title={statusLabel(connectionStatus)}
				/>
			</div>
		</header>
	);
}
