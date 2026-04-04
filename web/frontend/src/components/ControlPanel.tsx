import { AnimatePresence, motion } from "framer-motion";
import {
	Camera,
	Circle,
	Download,
	Maximize2,
	Minimize2,
	RotateCcw,
	Sliders,
	Square,
	Trash2,
	Wifi,
	Zap,
} from "lucide-react";
import { useCallback, useState } from "react";
import type { Settings } from "../types/tracking";
import { DEFAULT_SETTINGS } from "../types/tracking";

interface ControlPanelProps {
	settings: Settings;
	onSettingsChange: (settings: Partial<Settings>) => void;
	onClearHistory: () => void;
	connectionStatus: string;
	isExpanded: boolean;
	onToggleExpand: () => void;
}

/* ---------- slider style injection ---------- */
const SLIDER_STYLES = `
.ctrl-range {
	-webkit-appearance: none;
	appearance: none;
	width: 100%;
	height: 3px;
	border-radius: 9999px;
	background: var(--color-border);
	outline: none;
	transition: background 0.3s ease;
}
.ctrl-range::-webkit-slider-thumb {
	-webkit-appearance: none;
	appearance: none;
	width: 14px;
	height: 14px;
	border-radius: 50%;
	background: var(--color-bg-card);
	border: 2px solid var(--color-accent);
	cursor: pointer;
	transition: box-shadow 0.25s ease, transform 0.2s ease,
		border-color 0.2s ease;
	box-shadow: 0 0 0 0 rgba(34, 211, 238, 0);
}
.ctrl-range::-webkit-slider-thumb:hover {
	box-shadow: 0 0 0 5px rgba(34, 211, 238, 0.12),
		0 0 12px rgba(34, 211, 238, 0.15);
	transform: scale(1.15);
}
.ctrl-range::-webkit-slider-thumb:active {
	box-shadow: 0 0 0 6px rgba(34, 211, 238, 0.18),
		0 0 16px rgba(34, 211, 238, 0.2);
	transform: scale(1.1);
}
.ctrl-range::-moz-range-thumb {
	width: 14px;
	height: 14px;
	border-radius: 50%;
	background: var(--color-bg-card);
	border: 2px solid var(--color-accent);
	cursor: pointer;
	box-shadow: 0 0 0 0 rgba(34, 211, 238, 0);
	transition: box-shadow 0.25s ease, transform 0.2s ease;
}
.ctrl-range::-moz-range-thumb:hover {
	box-shadow: 0 0 0 5px rgba(34, 211, 238, 0.12),
		0 0 12px rgba(34, 211, 238, 0.15);
	transform: scale(1.15);
}
.ctrl-range::-moz-range-track {
	height: 3px;
	border-radius: 9999px;
	background: var(--color-border);
}
`;

/* ---------- reusable slider row ---------- */
function SliderRow({
	label,
	value,
	min,
	max,
	step = 1,
	unit = "",
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	unit?: string;
	onChange: (v: number) => void;
}) {
	const pct = ((value - min) / (max - min)) * 100;

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between text-[12px]">
				<span className="text-[var(--color-text-secondary)] font-medium">{label}</span>
				<span className="font-mono text-[var(--color-accent)] tabular-nums text-[11px] px-1.5 py-0.5 rounded-md bg-[var(--color-accent)]/6">
					{value}
					{unit}
				</span>
			</div>
			<input
				type="range"
				className="ctrl-range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				style={{
					background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${pct}%, var(--color-border) ${pct}%, var(--color-border) 100%)`,
				}}
			/>
		</div>
	);
}

/* ---------- section wrapper ---------- */
function Section({
	icon: Icon,
	title,
	children,
	last = false,
}: {
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	children: React.ReactNode;
	last?: boolean;
}) {
	return (
		<>
			<div className="space-y-3">
				<div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
					<Icon className="w-3 h-3" />
					{title}
				</div>
				{children}
			</div>
			{!last && (
				<div
					className="h-px"
					style={{
						background:
							"linear-gradient(90deg, transparent 0%, var(--color-border) 30%, var(--color-border) 70%, transparent 100%)",
					}}
				/>
			)}
		</>
	);
}

/* ---------- action button ---------- */
function ActionButton({
	icon: Icon,
	label,
	onClick,
	variant = "default",
	pulse = false,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	onClick: () => void;
	variant?: "default" | "danger" | "success";
	pulse?: boolean;
}) {
	const colors = {
		default:
			"bg-[var(--color-bg-primary)]/60 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card-hover)] border-[var(--color-border)]/60 hover:border-[var(--color-border-active)]/60",
		danger:
			"bg-[var(--color-danger)]/6 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 border-[var(--color-danger)]/15 hover:border-[var(--color-danger)]/30",
		success:
			"bg-[var(--color-success)]/6 text-[var(--color-success)] hover:bg-[var(--color-success)]/15 border-[var(--color-success)]/15 hover:border-[var(--color-success)]/30",
	};

	return (
		<button
			type="button"
			onClick={onClick}
			className={`relative flex items-center gap-2 w-full px-3 py-2 rounded-xl border text-[12px] font-medium transition-all duration-200 cursor-pointer active:scale-[0.98] ${colors[variant]}`}
		>
			{pulse && (
				<span className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3">
					<span className="absolute inset-0 rounded-full bg-[var(--color-danger)] animate-pulse-glow" />
				</span>
			)}
			<Icon className={`w-3.5 h-3.5 shrink-0 ${pulse ? "ml-1" : ""}`} />
			{label}
		</button>
	);
}

/* ========== main component ========== */
export function ControlPanel({
	settings,
	onSettingsChange,
	onClearHistory,
	connectionStatus,
	isExpanded,
	onToggleExpand,
}: ControlPanelProps) {
	const [isRecording, setIsRecording] = useState(false);

	const startRecording = useCallback(async () => {
		try {
			await fetch("/api/recording/start", {
				method: "POST",
			});
			setIsRecording(true);
		} catch {
			/* ignore */
		}
	}, []);

	const stopRecording = useCallback(async () => {
		try {
			await fetch("/api/recording/stop", {
				method: "POST",
			});
			setIsRecording(false);
		} catch {
			/* ignore */
		}
	}, []);

	const downloadCsv = useCallback(() => {
		window.open("/api/recording/download", "_blank");
	}, []);

	const takeScreenshot = useCallback(() => {
		const canvas = document.querySelector("canvas");
		if (canvas) {
			const link = document.createElement("a");
			link.download = `screenshot-${Date.now()}.png`;
			link.href = canvas.toDataURL("image/png");
			link.click();
		}
	}, []);

	const resetDefaults = useCallback(() => {
		onSettingsChange(DEFAULT_SETTINGS);
	}, [onSettingsChange]);

	return (
		<motion.div
			layout
			className="glass rounded-2xl border border-[var(--color-border)]/80 flex flex-col overflow-hidden h-full"
		>
			<style>{SLIDER_STYLES}</style>

			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]/60 shrink-0">
				<div className="flex items-center gap-2.5">
					<div className="w-6 h-6 rounded-md bg-[var(--color-accent)]/8 flex items-center justify-center border border-[var(--color-accent)]/10">
						<Sliders className="w-3.5 h-3.5 text-[var(--color-accent)]" />
					</div>
					<h2 className="text-[13px] font-semibold text-[var(--color-text-primary)] tracking-tight">
						Controls
					</h2>
				</div>
				<div className="flex items-center gap-2">
					{/* Connection badge */}
					<span
						className={`text-[10px] px-2 py-0.5 rounded-full font-medium border transition-all duration-300 ${
							connectionStatus === "connected"
								? "bg-[var(--color-success)]/8 text-[var(--color-success)] border-[var(--color-success)]/15"
								: "bg-[var(--color-danger)]/8 text-[var(--color-danger)] border-[var(--color-danger)]/15"
						}`}
					>
						{connectionStatus}
					</span>
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
			</div>

			{/* Scrollable content */}
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				{/* Detection Thresholds */}
				<Section icon={Sliders} title="Detection">
					<div className="space-y-3">
						<SliderRow
							label="Strict"
							value={settings.thresholdStrict}
							min={1}
							max={50}
							unit="px"
							onChange={(v) =>
								onSettingsChange({
									thresholdStrict: v,
								})
							}
						/>
						<SliderRow
							label="Medium"
							value={settings.thresholdMedium}
							min={1}
							max={50}
							unit="px"
							onChange={(v) =>
								onSettingsChange({
									thresholdMedium: v,
								})
							}
						/>
						<SliderRow
							label="Relaxed"
							value={settings.thresholdRelaxed}
							min={1}
							max={50}
							unit="px"
							onChange={(v) =>
								onSettingsChange({
									thresholdRelaxed: v,
								})
							}
						/>
					</div>
				</Section>

				{/* Stream Settings */}
				<Section icon={Wifi} title="Stream">
					<div className="space-y-3">
						<SliderRow
							label="Stream FPS"
							value={settings.streamFps}
							min={5}
							max={60}
							step={5}
							unit=" fps"
							onChange={(v) =>
								onSettingsChange({
									streamFps: v,
								})
							}
						/>
						<SliderRow
							label="JPEG Quality"
							value={settings.jpegQuality}
							min={30}
							max={100}
							step={5}
							unit="%"
							onChange={(v) =>
								onSettingsChange({
									jpegQuality: v,
								})
							}
						/>
						<SliderRow
							label="Mask Size"
							value={settings.maskSize}
							min={100}
							max={400}
							step={10}
							unit="px"
							onChange={(v) =>
								onSettingsChange({
									maskSize: v,
								})
							}
						/>
					</div>
				</Section>

				{/* Actions */}
				<Section icon={Zap} title="Actions" last>
					<div className="space-y-2">
						<ActionButton icon={Trash2} label="Clear History" onClick={onClearHistory} />
						<AnimatePresence mode="wait">
							{!isRecording ? (
								<motion.div
									key="start"
									initial={{
										opacity: 0,
										y: -4,
									}}
									animate={{
										opacity: 1,
										y: 0,
									}}
									exit={{
										opacity: 0,
										y: 4,
									}}
								>
									<ActionButton
										icon={Circle}
										label="Start Recording"
										onClick={startRecording}
										variant="danger"
									/>
								</motion.div>
							) : (
								<motion.div
									key="stop"
									initial={{
										opacity: 0,
										y: -4,
									}}
									animate={{
										opacity: 1,
										y: 0,
									}}
									exit={{
										opacity: 0,
										y: 4,
									}}
								>
									<ActionButton
										icon={Square}
										label="Stop Recording"
										onClick={stopRecording}
										variant="danger"
										pulse
									/>
								</motion.div>
							)}
						</AnimatePresence>
						<ActionButton
							icon={Download}
							label="Download CSV"
							onClick={downloadCsv}
							variant="success"
						/>
						<ActionButton icon={Camera} label="Screenshot" onClick={takeScreenshot} />
					</div>
				</Section>

				{/* Reset defaults */}
				<button
					type="button"
					onClick={resetDefaults}
					className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)]/60 border border-transparent hover:border-[var(--color-border)]/40 transition-all duration-200 cursor-pointer"
				>
					<RotateCcw className="w-3 h-3" />
					Reset to Defaults
				</button>
			</div>
		</motion.div>
	);
}
