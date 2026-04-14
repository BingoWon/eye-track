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

/* ── Shared ── */

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

function latencyColor(ms: number): string {
	if (ms <= 0) return "var(--color-text-muted)";
	if (ms < 16) return "var(--color-success)";
	if (ms < 33) return "var(--color-text-secondary)";
	if (ms < 80) return "var(--color-warning)";
	return "var(--color-danger)";
}

const COLOR_MAP = {
	accent: { bg: "34,211,238", text: "var(--color-accent)" },
	success: { bg: "52,211,153", text: "var(--color-success)" },
	warning: { bg: "251,191,36", text: "var(--color-warning)" },
};

const VIEW_TABS: {
	mode: ViewMode;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
}[] = [
	{ mode: "dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ mode: "heatmap", label: "Heatmap", icon: Flame },
	{ mode: "trail", label: "Trail", icon: Route },
];

/* ── Small reusable button ── */

function ActionButton({
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

/* ── Pill button (Backend / Camera) ── */

function PillButton({
	icon: Icon,
	label,
	onClick,
	color,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	onClick: () => void;
	color: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer transition-colors hover:opacity-80"
			style={{
				backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
				borderColor: `color-mix(in srgb, ${color} 20%, transparent)`,
				color,
			}}
		>
			<Icon className="w-3 h-3" />
			{label}
		</button>
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
			setBackendUrl(trimmed);
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 3000);
			const res = await fetch(apiUrl("/api/cameras"), { signal: controller.signal });
			clearTimeout(timeout);
			if (res.ok) {
				setOpen(false);
				onChangeBackend();
			} else {
				setBackendUrl(previousUrl);
				setError(`Server responded with ${res.status}`);
			}
		} catch {
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
	const dotColor = statusColor(connectionStatus);

	return (
		<div className="relative" ref={popoverRef}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer transition-colors hover:opacity-80"
				style={{
					backgroundColor: `color-mix(in srgb, ${dotColor} 10%, transparent)`,
					borderColor: `color-mix(in srgb, ${dotColor} 20%, transparent)`,
					color: dotColor,
				}}
			>
				<span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
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
						<div className="flex items-center gap-2 mb-3">
							<span
								className="w-2 h-2 rounded-full shrink-0"
								style={{ backgroundColor: dotColor }}
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

/* ── Clearable button wrapper ── */

function ClearableButton({
	children,
	onClear,
	showClear,
	clearTitle,
}: {
	children: React.ReactNode;
	onClear: () => void;
	showClear: boolean;
	clearTitle: string;
}) {
	return (
		<div className="relative group">
			{children}
			{showClear && (
				<button
					type="button"
					onClick={onClear}
					className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-danger)] text-white text-[8px] font-bold items-center justify-center cursor-pointer hidden group-hover:flex"
					title={clearTitle}
				>
					×
				</button>
			)}
		</div>
	);
}

/* ── Main Header ── */

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

	const active = latency.frameInterval > 0;
	const latencyItems = [
		{ label: "Proc", value: latency.processing, tip: "Backend processing (capture → encode)" },
		{ label: "Net", value: latency.network, tip: "Network transport jitter" },
		{ label: "Intv", value: latency.frameInterval, tip: "Frame interval at browser" },
	];

	return (
		<header className="glass-heavy h-13 flex items-center px-4 gap-4 relative z-50 shrink-0 border-b border-transparent">
			{/* Bottom gradient border */}
			<div
				className="absolute bottom-0 left-0 right-0 h-px"
				style={{
					background:
						"linear-gradient(90deg, transparent 0%, var(--color-border-active) 20%, var(--color-accent-dim) 50%, var(--color-border-active) 80%, transparent 100%)",
					opacity: 0.6,
				}}
			/>

			{/* ── Left: Brand + Context ── */}
			<div className="flex items-center gap-2.5 shrink-0">
				<Eye className="w-5 h-5 text-[var(--color-accent)]" />
				<span className="text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)]">
					EyeTrack
				</span>

				<span className="w-px h-4 bg-[var(--color-border)]/30" />

				<BackendSelector connectionStatus={connectionStatus} onChangeBackend={onChangeBackend} />

				{trackerCount > 0 && (
					<PillButton
						icon={Camera}
						label="Camera"
						onClick={onChangeCameraClick}
						color="var(--color-accent)"
					/>
				)}
			</div>

			{/* ── Center: Navigation ── */}
			<div className="flex-1 flex items-center justify-center gap-3">
				{/* Mode switcher */}
				<nav className="relative flex items-center gap-0.5 bg-[var(--color-bg-primary)]/50 rounded-lg p-0.5 border border-[var(--color-border)]/40">
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
							className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150 cursor-pointer ${
								mode === value
									? "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
									: "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
							}`}
						>
							{label}
						</button>
					))}
				</nav>

				{/* View switcher */}
				<nav className="relative flex items-center gap-0.5 bg-[var(--color-bg-primary)]/50 rounded-lg p-0.5 border border-[var(--color-border)]/40">
					<motion.div
						className="absolute top-0.5 bottom-0.5 rounded-md bg-[var(--color-accent)]/8 border border-[var(--color-accent)]/15"
						initial={false}
						animate={{ left: indicator.left, width: indicator.width }}
						transition={{ type: "spring", stiffness: 500, damping: 35 }}
					/>
					{VIEW_TABS.map(({ mode: vm, label, icon: Icon }) => (
						<button
							type="button"
							key={vm}
							ref={(el) => {
								if (el) tabRefs.current.set(vm, el);
							}}
							onClick={() => onViewModeChange(vm)}
							className={`relative z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150 cursor-pointer ${
								viewMode === vm
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

			{/* ── Right: Actions + Metrics ── */}
			<div className="flex items-center gap-1.5 shrink-0">
				<ActionButton
					icon={paused ? Play : Pause}
					label={paused ? "Resume" : "Pause"}
					onClick={onTogglePause}
					active={paused}
					activeColor="warning"
					inactiveColor="accent"
				/>
				<ClearableButton
					onClear={onClearRangeCalibration}
					showClear={rangeCalibrated}
					clearTitle="Clear range calibration"
				>
					<ActionButton
						icon={ScanEye}
						label={rangeCalibrated ? "Bounds ✓" : "Bounds"}
						onClick={onRangeCalibrateClick}
						active={rangeCalibrated}
						activeColor="success"
						inactiveColor="accent"
					/>
				</ClearableButton>
				<ClearableButton
					onClear={onClearCalibration}
					showClear={!!calibration}
					clearTitle="Clear gaze calibration"
				>
					<ActionButton
						icon={Crosshair}
						label={calibration ? "Gaze ✓" : "Gaze"}
						onClick={onCalibrateClick}
						active={!!calibration}
						activeColor="success"
						inactiveColor="accent"
					/>
				</ClearableButton>
				<ActionButton
					icon={MousePointer}
					label="Cursor"
					onClick={onToggleGazeCursor}
					disabled={!calibration}
					active={!!calibration && showGazeCursor}
				/>
				<ActionButton icon={RotateCcw} label="Reset" onClick={onResetAll} />

				<span className="w-px h-4 bg-[var(--color-border)]/30 mx-0.5" />

				{/* Theme */}
				<button
					type="button"
					onClick={onToggleTheme}
					className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card-hover)] transition-all cursor-pointer"
					title={theme === "dark" ? "Switch to light" : "Switch to dark"}
				>
					{theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
				</button>

				{/* Latency */}
				<div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--color-bg-primary)]/40 border border-[var(--color-border)]/30">
					{latencyItems.map(({ label, value, tip }) => (
						<div key={label} className="flex items-center gap-0.5" title={tip}>
							<span className="text-[9px] font-medium text-[var(--color-text-muted)] uppercase">
								{label}
							</span>
							<span
								className="text-[10px] font-semibold font-mono min-w-[24px] text-right"
								style={{
									color: active ? latencyColor(value) : "var(--color-text-muted)",
									fontFeatureSettings: '"tnum"',
								}}
							>
								{active ? `${Math.round(value)}` : "\u2014"}
							</span>
						</div>
					))}
				</div>
			</div>
		</header>
	);
}
