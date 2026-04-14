import { AnimatePresence, motion } from "framer-motion";
import {
	Camera,
	Crosshair,
	Eye,
	Flame,
	LayoutDashboard,
	Loader2,
	Moon,
	MousePointer,
	Pause,
	Play,
	RotateCcw,
	Route,
	ScanEye,
	Server,
	Sun,
	Wifi,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LatencyStats } from "../hooks/useLatency";
import type { Theme } from "../hooks/useTheme";
import { apiUrl, getBackendUrl, setBackendUrl } from "../lib/backend";
import type { CalibrationResult } from "../lib/calibration";
import type { ConnectionStatus, TrackingMode, ViewMode } from "../types/tracking";

interface HeaderProps {
	connectionStatus: ConnectionStatus;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	calibration: CalibrationResult | null;
	showGazeCursor: boolean;
	paused: boolean;
	trackerCount: number;
	rangeCalibrated: boolean;
	latency: LatencyStats;
	onCalibrateClick: () => void;
	onClearCalibration: () => void;
	onRangeCalibrateClick: () => void;
	onClearRangeCalibration: () => void;
	onToggleGazeCursor: () => void;
	onTogglePause: () => void;
	onChangeCameraClick: () => void;
	onChangeBackend: () => void;
	onResetAll: () => void;
	mode: TrackingMode;
	onModeChange: (mode: TrackingMode) => void;
	theme: Theme;
	onToggleTheme: () => void;
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
			className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-200 border ${
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

function latencyColor(ms: number): string {
	if (ms <= 0) return "var(--color-text-muted)";
	if (ms < 16) return "var(--color-success)";
	if (ms < 33) return "var(--color-text-secondary)";
	if (ms < 80) return "var(--color-warning)";
	return "var(--color-danger)";
}

function LatencyIndicator({ latency }: { latency: LatencyStats }) {
	const active = latency.frameInterval > 0;
	const items = [
		{ label: "Proc", value: latency.processing, tip: "Backend processing (capture → encode)" },
		{ label: "Net", value: latency.network, tip: "Network transport jitter" },
		{ label: "Intv", value: latency.frameInterval, tip: "Frame interval at browser" },
	];
	return (
		<div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-[var(--color-border)]/40 bg-[var(--color-bg-primary)]/40">
			{items.map(({ label, value, tip }) => (
				<div key={label} className="flex items-center gap-1" title={tip}>
					<span className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
						{label}
					</span>
					<span
						className="text-[11px] font-semibold font-mono min-w-[28px] text-right"
						style={{
							color: active ? latencyColor(value) : "var(--color-text-muted)",
							fontFeatureSettings: '"tnum"',
						}}
					>
						{active ? `${Math.round(value)}` : "\u2014"}
					</span>
					<span className="text-[9px] text-[var(--color-text-muted)]">ms</span>
				</div>
			))}
		</div>
	);
}

/* ── Backend selector popover ── */

function BackendSelector({
	connectionStatus,
	onChangeBackend,
}: {
	connectionStatus: ConnectionStatus;
	onChangeBackend: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState(getBackendUrl);
	const [testing, setTesting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const popoverRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	useEffect(() => {
		if (open) {
			setUrl(getBackendUrl());
			setError(null);
		}
	}, [open]);

	const handleConnect = useCallback(async () => {
		const trimmed = url.trim().replace(/\/+$/, "");
		if (!trimmed) return;
		setTesting(true);
		setError(null);
		const previousUrl = getBackendUrl();
		try {
			// Temporarily set URL so apiUrl() resolves against the new target
			setBackendUrl(trimmed);
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 3000);
			const res = await fetch(apiUrl("/api/cameras"), { signal: controller.signal });
			clearTimeout(timeout);
			if (res.ok) {
				// URL already saved — trigger reconnection
				setOpen(false);
				onChangeBackend();
			} else {
				// Revert to previous working URL
				setBackendUrl(previousUrl);
				setError(`Server responded with ${res.status}`);
			}
		} catch {
			// Revert to previous working URL
			setBackendUrl(previousUrl);
			setError("Cannot reach server");
		} finally {
			setTesting(false);
		}
	}, [url, onChangeBackend]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		handleConnect();
	};

	const isConnected = connectionStatus === "connected";

	return (
		<div className="relative" ref={popoverRef}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer transition-colors ${
					isConnected
						? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20 hover:bg-[var(--color-success)]/15"
						: "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/20 hover:bg-[var(--color-danger)]/15"
				}`}
			>
				<span
					className="w-1.5 h-1.5 rounded-full shrink-0"
					style={{ backgroundColor: statusColor(connectionStatus) }}
				/>
				<Server className="w-3 h-3" />
				Backend
			</button>

			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ opacity: 0, y: 4, scale: 0.97 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: 4, scale: 0.97 }}
						transition={{ duration: 0.15 }}
						className="absolute top-full left-0 mt-2 w-80 glass rounded-xl border border-[var(--color-border)]/60 p-4 shadow-lg z-[100]"
					>
						{/* Status */}
						<div className="flex items-center gap-2 mb-3">
							<span
								className="w-2.5 h-2.5 rounded-full shrink-0"
								style={{ backgroundColor: statusColor(connectionStatus) }}
							/>
							<span className="text-[12px] font-medium text-[var(--color-text-primary)]">
								{isConnected
									? "Connected"
									: connectionStatus === "connecting"
										? "Connecting..."
										: "Disconnected"}
							</span>
							{isConnected && (
								<span className="text-[11px] text-[var(--color-text-secondary)] font-mono ml-auto truncate max-w-[160px]">
									{getBackendUrl()}
								</span>
							)}
						</div>

						{/* URL form */}
						<form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
							<div className="flex items-center gap-2">
								<div className="relative flex-1">
									<Server className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
									<input
										type="text"
										value={url}
										onChange={(e) => {
											setUrl(e.target.value);
											setError(null);
										}}
										placeholder="http://localhost:8100"
										className="w-full pl-8 pr-3 py-2 rounded-lg text-[12px] font-mono bg-[var(--color-bg-primary)] border border-[var(--color-border)]/60 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]/50 focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all"
										disabled={testing}
									/>
								</div>
								<button
									type="submit"
									disabled={testing || !url.trim()}
									className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/15 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
								>
									{testing ? (
										<Loader2 className="w-3.5 h-3.5 animate-spin" />
									) : (
										<Wifi className="w-3.5 h-3.5" />
									)}
									Connect
								</button>
							</div>
							{error && <p className="text-[10px] text-[var(--color-danger)] px-0.5">{error}</p>}
						</form>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
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
	latency,
	onCalibrateClick,
	onClearCalibration,
	onRangeCalibrateClick,
	onClearRangeCalibration,
	onToggleGazeCursor,
	onTogglePause,
	onChangeCameraClick,
	onChangeBackend,
	onResetAll,
	mode,
	onModeChange,
	theme,
	onToggleTheme,
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
		<header className="glass-heavy h-14 flex items-center justify-between px-5 relative z-50 shrink-0 border-b border-transparent">
			<div
				className="absolute bottom-0 left-0 right-0 h-px"
				style={{
					background:
						"linear-gradient(90deg, transparent 0%, var(--color-border-active) 20%, var(--color-accent-dim) 50%, var(--color-border-active) 80%, transparent 100%)",
					opacity: 0.6,
				}}
			/>

			{/* Left: Logo + Backend + Camera */}
			<div className="flex items-center gap-3">
				<div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/8 flex items-center justify-center border border-[var(--color-accent)]/10">
					<Eye className="w-[18px] h-[18px] text-[var(--color-accent)]" />
				</div>
				<div className="flex flex-col">
					<span className="text-[15px] font-semibold tracking-tight text-[var(--color-text-primary)] leading-tight">
						EyeTrack
					</span>
					<span className="text-[10px] font-medium text-[var(--color-text-secondary)] tracking-wide uppercase">
						Gaze Tracker
					</span>
				</div>

				<span className="w-px h-5 bg-[var(--color-border)]/40 mx-0.5" />

				<BackendSelector connectionStatus={connectionStatus} onChangeBackend={onChangeBackend} />

				{trackerCount > 0 && (
					<button
						type="button"
						onClick={onChangeCameraClick}
						className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20 cursor-pointer hover:bg-[var(--color-accent)]/15 transition-colors"
					>
						<Camera className="w-3 h-3" />
						Camera
					</button>
				)}
			</div>

			{/* Center: Mode + View tabs */}
			<div className="flex items-center gap-3">
				{/* Tracking mode */}
				<div className="flex items-center gap-2">
					<span className="text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
						Mode
					</span>
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
								className={`relative z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200 cursor-pointer ${
									mode === value
										? "bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20"
										: "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-transparent"
								}`}
							>
								{label}
							</button>
						))}
					</nav>
				</div>

				<span className="w-1 h-1 rounded-full bg-[var(--color-text-muted)]/40" />

				{/* View tabs */}
				<div className="flex items-center gap-2">
					<span className="text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
						View
					</span>
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
										: "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
								}`}
							>
								<Icon className="w-3.5 h-3.5" />
								{label}
							</button>
						))}
					</nav>
				</div>
			</div>

			{/* Right: Actions + Theme + Latency */}
			<div className="flex items-center gap-2 justify-end">
				<HeaderButton
					icon={paused ? Play : Pause}
					label={paused ? "Resume" : "Pause"}
					onClick={onTogglePause}
					active={paused}
					activeColor="warning"
					inactiveColor="accent"
				/>
				<div className="relative group">
					<HeaderButton
						icon={ScanEye}
						label={rangeCalibrated ? "Bounds ✓" : "Bounds"}
						onClick={onRangeCalibrateClick}
						active={rangeCalibrated}
						activeColor="success"
						inactiveColor="accent"
					/>
					{rangeCalibrated && (
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
				<div className="relative group">
					<HeaderButton
						icon={Crosshair}
						label={calibration ? "Gaze ✓" : "Gaze"}
						onClick={onCalibrateClick}
						active={!!calibration}
						activeColor="success"
						inactiveColor="accent"
					/>
					{calibration && (
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
				<HeaderButton
					icon={MousePointer}
					label="Cursor"
					onClick={onToggleGazeCursor}
					disabled={!calibration}
					active={!!calibration && showGazeCursor}
				/>
				<HeaderButton icon={RotateCcw} label="Reset" onClick={onResetAll} />

				<span className="w-px h-5 bg-[var(--color-border)]/40 mx-0.5" />

				{/* Theme toggle */}
				<button
					type="button"
					onClick={onToggleTheme}
					className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card-hover)] transition-all cursor-pointer border border-transparent hover:border-[var(--color-border)]/50"
					title={theme === "dark" ? "Switch to light" : "Switch to dark"}
				>
					{theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
				</button>

				{/* Latency metrics */}
				<LatencyIndicator latency={latency} />
			</div>
		</header>
	);
}
