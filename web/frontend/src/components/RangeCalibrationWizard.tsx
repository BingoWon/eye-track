import { AnimatePresence, motion } from "framer-motion";
import { Check, Eye, ScanEye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TrackerState } from "../hooks/useTrackingData";
import { playComplete, playCountdownTick, playTick } from "../lib/audio";
import { apiUrl } from "../lib/backend";

interface RangeCalibrationWizardProps {
	isOpen: boolean;
	onComplete: () => void;
	onClose: () => void;
	/** All active trackers — bounds collected from each simultaneously */
	allTrackers: Map<string, TrackerState>;
	trackerIds: string[];
	rangeMargin: number;
}

type Stage = "intro" | "collecting" | "complete";

const DURATION_MS = 5000;

function computeBounds(points: [number, number][], margin: number) {
	const n = points.length;
	if (n === 0) return null;
	let mx = 0;
	let my = 0;
	for (const [x, y] of points) {
		mx += x;
		my += y;
	}
	mx /= n;
	my /= n;
	let maxDx = 0;
	let maxDy = 0;
	for (const [x, y] of points) {
		const dx = Math.abs(x - mx);
		const dy = Math.abs(y - my);
		if (dx > maxDx) maxDx = dx;
		if (dy > maxDy) maxDy = dy;
	}
	return { cx: mx, cy: my, rx: maxDx * margin, ry: maxDy * margin };
}

export function RangeCalibrationWizard({
	isOpen,
	onComplete,
	onClose,
	allTrackers,
	trackerIds,
	rangeMargin,
}: RangeCalibrationWizardProps) {
	const [stage, setStage] = useState<Stage>("intro");
	const [progress, setProgress] = useState(0);
	const [computedRx, setComputedRx] = useState(0);
	const [computedRy, setComputedRy] = useState(0);
	const [sampleCount, setSampleCount] = useState(0);

	const startTimeRef = useRef(0);
	// Per-tracker point collection
	const pointsRef = useRef<Map<string, [number, number][]>>(new Map());
	const animRef = useRef(0);
	const lastTickSecondRef = useRef(-1);

	// Reset on open
	useEffect(() => {
		if (isOpen) {
			setStage("intro");
			setProgress(0);
			setComputedRx(0);
			setComputedRy(0);
			setSampleCount(0);
			pointsRef.current = new Map();
			lastTickSecondRef.current = -1;
		}
	}, [isOpen]);

	// Collect pupil positions from ALL trackers during "collecting"
	useEffect(() => {
		if (stage !== "collecting") return;

		let totalSamples = 0;
		for (const [id, state] of allTrackers) {
			if (!state.tracking.pupil?.center) continue;
			const [px, py] = state.tracking.pupil.center;
			const pts = pointsRef.current.get(id) ?? [];
			pts.push([px, py]);
			pointsRef.current.set(id, pts);
			totalSamples = Math.max(totalSamples, pts.length);
		}
		setSampleCount(totalSamples);

		// Live preview: use aggregate max deviation across all trackers
		let maxRx = 0;
		let maxRy = 0;
		for (const pts of pointsRef.current.values()) {
			const bounds = computeBounds(pts, rangeMargin);
			if (bounds) {
				maxRx = Math.max(maxRx, bounds.rx);
				maxRy = Math.max(maxRy, bounds.ry);
			}
		}
		setComputedRx(maxRx);
		setComputedRy(maxRy);
	}, [allTrackers, stage, rangeMargin]);

	// When collecting starts, clear existing range on ALL trackers
	useEffect(() => {
		if (stage !== "collecting") return;
		for (const id of trackerIds) {
			fetch(apiUrl(`/api/trackers/${id}/range-calibrate`), { method: "DELETE" }).catch(() => {});
		}
	}, [stage, trackerIds]);

	// Progress timer
	useEffect(() => {
		if (stage !== "collecting") return;

		startTimeRef.current = Date.now();
		playTick();

		const tick = () => {
			const elapsed = Date.now() - startTimeRef.current;
			const p = Math.min(elapsed / DURATION_MS, 1);
			setProgress(p);

			const secondsLeft = Math.ceil((DURATION_MS - elapsed) / 1000);
			if (secondsLeft !== lastTickSecondRef.current && secondsLeft > 0) {
				lastTickSecondRef.current = secondsLeft;
				playCountdownTick(secondsLeft);
			}

			if (p >= 1) {
				// Compute and POST bounds for each tracker independently
				let anySuccess = false;
				let lastRx = 0;
				let lastRy = 0;

				for (const [id, pts] of pointsRef.current) {
					const bounds = computeBounds(pts, rangeMargin);
					if (!bounds) continue;
					anySuccess = true;
					lastRx = Math.max(lastRx, bounds.rx);
					lastRy = Math.max(lastRy, bounds.ry);
					fetch(apiUrl(`/api/trackers/${id}/range-calibrate`), {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(bounds),
					}).catch(() => {});
				}

				if (!anySuccess) {
					setStage("intro");
					return;
				}

				setComputedRx(lastRx);
				setComputedRy(lastRy);
				setStage("complete");
				playComplete();
				onComplete();
				return;
			}

			animRef.current = requestAnimationFrame(tick);
		};

		animRef.current = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(animRef.current);
	}, [stage, onComplete, rangeMargin]);

	// Keyboard
	useEffect(() => {
		if (!isOpen) return;
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			} else if ((e.key === " " || e.key === "Enter") && stage === "intro") {
				e.preventDefault();
				setStage("collecting");
			} else if ((e.key === " " || e.key === "Enter") && stage === "complete") {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [isOpen, stage, onClose]);

	useEffect(() => {
		if (!isOpen && document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
	}, [isOpen]);

	if (!isOpen) return null;

	return (
		<motion.div
			className="fixed inset-0 z-50 flex items-center justify-center"
			style={{ background: "rgba(0, 0, 0, 0.95)" }}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
		>
			<AnimatePresence mode="wait">
				{stage === "intro" && (
					<motion.div
						key="intro"
						className="relative z-10 flex flex-col items-center text-center max-w-sm"
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -20 }}
					>
						<motion.div
							initial={{ scale: 0 }}
							animate={{ scale: 1 }}
							transition={{ type: "spring", stiffness: 200, damping: 20 }}
						>
							<ScanEye className="w-16 h-16 text-[var(--color-accent)]" strokeWidth={1.2} />
						</motion.div>
						<h1
							className="mt-6 text-3xl font-light tracking-tight"
							style={{ color: "var(--color-text-primary)" }}
						>
							Bounds Calibration
						</h1>
						<p
							className="mt-3 text-[14px] leading-relaxed"
							style={{ color: "var(--color-text-secondary)" }}
						>
							Look as far as you can in every direction while keeping your head still. This
							establishes the valid pupil range to filter out blink artifacts.
						</p>
						<div className="mt-6 flex items-center gap-2">
							<div
								className="w-7 h-7 rounded-lg flex items-center justify-center"
								style={{ backgroundColor: "rgba(34,211,238,0.1)" }}
							>
								<Eye className="w-3.5 h-3.5 text-[var(--color-accent)]" />
							</div>
							<p className="text-[13px] text-[var(--color-text-secondary)]">
								Takes 5 seconds. Move only your eyes. Do not blink or squint.
							</p>
						</div>
						<motion.button
							type="button"
							className="mt-8 px-8 py-3 rounded-full text-[15px] font-medium cursor-pointer"
							style={{
								backgroundColor: "var(--color-accent)",
								color: "var(--color-bg-primary)",
								boxShadow: "0 0 30px var(--color-glow-cyan)",
							}}
							whileHover={{ scale: 1.03 }}
							whileTap={{ scale: 0.97 }}
							onClick={() => setStage("collecting")}
						>
							Start
						</motion.button>
						<button
							type="button"
							className="mt-3 text-[13px] cursor-pointer bg-transparent border-none"
							style={{ color: "var(--color-text-muted)" }}
							onClick={onClose}
						>
							Skip
						</button>
					</motion.div>
				)}

				{stage === "collecting" && (
					<motion.div
						key="collecting"
						className="relative z-10 flex flex-col items-center text-center"
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0 }}
					>
						<div className="relative w-48 h-48 flex items-center justify-center">
							<svg className="absolute inset-0 w-full h-full" aria-hidden="true">
								<circle
									cx="96"
									cy="96"
									r="90"
									fill="none"
									stroke="var(--color-border)"
									strokeWidth="2"
									opacity="0.3"
								/>
								<circle
									cx="96"
									cy="96"
									r="90"
									fill="none"
									stroke="var(--color-accent)"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeDasharray={2 * Math.PI * 90}
									strokeDashoffset={2 * Math.PI * 90 * (1 - progress)}
									transform="rotate(-90 96 96)"
								/>
							</svg>
							<motion.div
								className="rounded-full border-2 border-[var(--color-accent)]"
								style={{ backgroundColor: "rgba(34,211,238,0.06)" }}
								animate={{
									width: Math.max(20, Math.min(140, computedRx * 0.7)),
									height: Math.max(20, Math.min(140, computedRy * 0.7)),
								}}
								transition={{ type: "spring", stiffness: 300, damping: 25 }}
							/>
							<div
								className="absolute rounded-full"
								style={{
									width: 8,
									height: 8,
									backgroundColor: "var(--color-accent)",
									left: "50%",
									top: "50%",
									transform: "translate(-50%, -50%)",
								}}
							/>
						</div>
						<p
							className="mt-6 text-[18px] font-medium"
							style={{ color: "var(--color-text-primary)" }}
						>
							Look around...
						</p>
						<p className="mt-2 text-[13px] font-mono" style={{ color: "var(--color-text-muted)" }}>
							{sampleCount} samples · {computedRx.toFixed(0)} &times; {computedRy.toFixed(0)}px
						</p>
						<p className="mt-1 text-[12px]" style={{ color: "var(--color-text-muted)" }}>
							{Math.ceil((DURATION_MS - progress * DURATION_MS) / 1000)}s remaining
						</p>
					</motion.div>
				)}

				{stage === "complete" && (
					<motion.div
						key="complete"
						className="relative z-10 flex flex-col items-center text-center"
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -20 }}
					>
						<motion.div
							initial={{ scale: 0 }}
							animate={{ scale: 1 }}
							transition={{ type: "spring", stiffness: 300, damping: 20 }}
						>
							<div
								className="w-16 h-16 rounded-full flex items-center justify-center"
								style={{ backgroundColor: "rgba(52,211,153,0.15)" }}
							>
								<Check className="w-8 h-8 text-[var(--color-success)]" />
							</div>
						</motion.div>
						<h1
							className="mt-5 text-2xl font-light tracking-tight"
							style={{ color: "var(--color-text-primary)" }}
						>
							Bounds Calibration Complete
						</h1>
						<p className="mt-2 text-[13px]" style={{ color: "var(--color-text-secondary)" }}>
							Bounding ellipse: {computedRx.toFixed(0)} &times; {computedRy.toFixed(0)}px (
							{sampleCount} samples)
						</p>
						<motion.button
							type="button"
							className="mt-6 px-6 py-2.5 rounded-full text-[14px] font-medium cursor-pointer"
							style={{ backgroundColor: "var(--color-success)", color: "var(--color-bg-primary)" }}
							whileHover={{ scale: 1.03 }}
							whileTap={{ scale: 0.97 }}
							onClick={onClose}
						>
							Done
						</motion.button>
						<button
							type="button"
							className="mt-3 text-[13px] cursor-pointer bg-transparent border-none"
							style={{ color: "var(--color-text-muted)" }}
							onClick={() => {
								pointsRef.current = new Map();
								lastTickSecondRef.current = -1;
								setSampleCount(0);
								setComputedRx(0);
								setComputedRy(0);
								setProgress(0);
								setStage("collecting");
							}}
						>
							Recalibrate
						</button>
					</motion.div>
				)}
			</AnimatePresence>
		</motion.div>
	);
}
