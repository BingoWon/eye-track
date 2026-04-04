import { RotateCcw, Sliders } from "lucide-react";
import type { Settings } from "../types/tracking";

interface ControlPanelProps {
	settings: Settings;
	onSettingsChange: (settings: Partial<Settings>) => void;
	onReset: () => void;
}

const SLIDER_STYLES = `
.ctrl-range {
	-webkit-appearance: none;
	appearance: none;
	width: 100%;
	height: 4px;
	border-radius: 9999px;
	background: var(--color-border);
	outline: none;
	margin-top: 2px;
}
.ctrl-range::-webkit-slider-thumb {
	-webkit-appearance: none;
	width: 14px;
	height: 14px;
	border-radius: 50%;
	background: var(--color-bg-card);
	border: 2px solid var(--color-accent);
	cursor: pointer;
	transition: box-shadow 0.15s;
}
.ctrl-range::-webkit-slider-thumb:hover {
	box-shadow: 0 0 0 4px rgba(34,211,238,0.12);
}
.ctrl-range::-moz-range-thumb {
	width: 14px;
	height: 14px;
	border-radius: 50%;
	background: var(--color-bg-card);
	border: 2px solid var(--color-accent);
	cursor: pointer;
}
`;

function Slider({
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
		<div>
			<div className="flex items-center justify-between mb-0.5">
				<span className="text-[11px] text-[var(--color-text-secondary)]">{label}</span>
				<span className="text-[11px] font-mono text-[var(--color-accent)] tabular-nums">
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
					background: `linear-gradient(to right, var(--color-accent) ${pct}%, var(--color-border) ${pct}%)`,
				}}
			/>
		</div>
	);
}

export function ControlPanel({ settings, onSettingsChange, onReset }: ControlPanelProps) {
	return (
		<div className="glass rounded-2xl border border-[var(--color-border)]/80 flex flex-col overflow-hidden h-full">
			<style>{SLIDER_STYLES}</style>

			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]/60 shrink-0">
				<div className="flex items-center gap-2.5">
					<Sliders className="w-3.5 h-3.5 text-[var(--color-accent)]" />
					<span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
						Controls
					</span>
				</div>
				<button
					type="button"
					onClick={onReset}
					className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)] transition-all cursor-pointer"
					title="Reset to defaults"
				>
					<RotateCcw className="w-3.5 h-3.5" />
				</button>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-4 space-y-5">
				{/* Filter — 2 col */}
				<div>
					<h3 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
						Filter
					</h3>
					<div className="grid grid-cols-2 gap-x-4 gap-y-3">
						<Slider
							label="Confidence"
							value={Math.round(settings.minConfidence * 100)}
							min={0}
							max={100}
							step={5}
							unit="%"
							onChange={(v) => onSettingsChange({ minConfidence: v / 100 })}
						/>
						<Slider
							label="Aspect Ratio"
							value={Math.round(settings.maxAspectRatio * 10) / 10}
							min={1.5}
							max={5}
							step={0.1}
							onChange={(v) => onSettingsChange({ maxAspectRatio: v })}
						/>
						<Slider
							label="Range Margin"
							value={Math.round(settings.rangeMargin * 100)}
							min={100}
							max={150}
							step={5}
							unit="%"
							onChange={(v) => onSettingsChange({ rangeMargin: v / 100 })}
						/>
						<Slider
							label="Mask Size"
							value={settings.maskSize}
							min={100}
							max={400}
							step={10}
							unit="px"
							onChange={(v) => onSettingsChange({ maskSize: v })}
						/>
					</div>
				</div>

				{/* Separator */}
				<div className="h-px bg-[var(--color-border)]/40" />

				{/* Detection — 3 col */}
				<div>
					<h3 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
						Detection Thresholds
					</h3>
					<div className="grid grid-cols-3 gap-x-4 gap-y-3">
						<Slider
							label="Strict"
							value={settings.thresholdStrict}
							min={1}
							max={50}
							unit="px"
							onChange={(v) => onSettingsChange({ thresholdStrict: v })}
						/>
						<Slider
							label="Medium"
							value={settings.thresholdMedium}
							min={1}
							max={50}
							unit="px"
							onChange={(v) => onSettingsChange({ thresholdMedium: v })}
						/>
						<Slider
							label="Relaxed"
							value={settings.thresholdRelaxed}
							min={1}
							max={50}
							unit="px"
							onChange={(v) => onSettingsChange({ thresholdRelaxed: v })}
						/>
					</div>
				</div>

				{/* Separator */}
				<div className="h-px bg-[var(--color-border)]/40" />

				{/* Stream — 2 col */}
				<div>
					<h3 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
						Stream
					</h3>
					<div className="grid grid-cols-2 gap-x-4 gap-y-3">
						<Slider
							label="FPS"
							value={settings.streamFps}
							min={5}
							max={120}
							step={5}
							unit=" fps"
							onChange={(v) => onSettingsChange({ streamFps: v })}
						/>
						<Slider
							label="Quality"
							value={settings.jpegQuality}
							min={30}
							max={100}
							step={5}
							unit="%"
							onChange={(v) => onSettingsChange({ jpegQuality: v })}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
