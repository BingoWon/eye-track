import { AnimatePresence, motion } from "framer-motion";
import { Check, Crosshair, MoveHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type CalibrationPoint,
	type CalibrationResult,
	checkStability,
	computeCalibration,
} from "../lib/calibration";
import type { TrackingData } from "../types/tracking";

interface CalibrationWizardProps {
	isOpen: boolean;
	onComplete: (result: CalibrationResult) => void;
	onClose: () => void;
	currentTracking: TrackingData | null;
}

type Stage = "intro" | "calibrating" | "complete";
type DotStatus = "waiting" | "collecting" | "success" | "failed";

/*
 * 9-point calibration grid — row-major left-to-right, top-to-bottom.
 * This ordering minimizes saccade distance between consecutive points
 * and ensures even coverage. Padding = 15% to avoid extreme gaze angles.
 *
 *   1 --- 2 --- 3
 *   |     |     |
 *   4 --- 5 --- 6
 *   |     |     |
 *   7 --- 8 --- 9
 */
const CALIBRATION_POSITIONS: [number, number][] = [
	[0.15, 0.15], // 1  top-left
	[0.5, 0.15], //  2  top-center
	[0.85, 0.15], // 3  top-right
	[0.15, 0.5], //  4  left-center
	[0.5, 0.5], //   5  center
	[0.85, 0.5], //  6  right-center
	[0.15, 0.85], // 7  bottom-left
	[0.5, 0.85], //  8  bottom-center
	[0.85, 0.85], // 9  bottom-right
];

const REQUIRED_SAMPLES = 40;
const STABILITY_CHECK_WINDOW = 10; // check last N samples for deviation

function accuracyLabel(accuracy: number): { label: string; color: string } {
	if (accuracy < 0.02) return { label: "Excellent", color: "var(--color-success)" };
	if (accuracy < 0.05) return { label: "Good", color: "var(--color-accent)" };
	return { label: "Fair", color: "var(--color-warning)" };
}

/* ------------------------------------------------------------------ */
/*  Background particles                                              */
/* ------------------------------------------------------------------ */

function Particles() {
	const particles = useRef(
		Array.from({ length: 40 }, (_, i) => ({
			id: i,
			x: Math.random() * 100,
			y: Math.random() * 100,
			size: Math.random() * 3 + 1,
			duration: Math.random() * 20 + 15,
			delay: Math.random() * 10,
			opacity: Math.random() * 0.3 + 0.05,
		})),
	).current;

	return (
		<div className="absolute inset-0 overflow-hidden pointer-events-none">
			{particles.map((p) => (
				<motion.div
					key={p.id}
					className="absolute rounded-full"
					style={{
						width: p.size,
						height: p.size,
						left: `${p.x}%`,
						top: `${p.y}%`,
						backgroundColor: "var(--color-accent)",
						opacity: p.opacity,
					}}
					animate={{
						y: [0, -30, 10, -20, 0],
						x: [0, 15, -10, 5, 0],
					}}
					transition={{
						duration: p.duration,
						repeat: Number.POSITIVE_INFINITY,
						delay: p.delay,
						ease: "easeInOut",
					}}
				/>
			))}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  SVG eye icon                                                      */
/* ------------------------------------------------------------------ */

function EyeIcon() {
	return (
		<motion.div
			initial={{ scale: 0, opacity: 0 }}
			animate={{ scale: 1, opacity: 1 }}
			transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.2 }}
		>
			<svg width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true">
				<motion.ellipse
					cx="60"
					cy="60"
					rx="50"
					ry="30"
					stroke="var(--color-accent)"
					strokeWidth="2"
					fill="none"
					initial={{ pathLength: 0 }}
					animate={{ pathLength: 1 }}
					transition={{ duration: 1.2, delay: 0.3, ease: "easeInOut" }}
				/>
				<motion.circle
					cx="60"
					cy="60"
					r="18"
					fill="var(--color-accent)"
					fillOpacity="0.15"
					stroke="var(--color-accent)"
					strokeWidth="1.5"
					initial={{ scale: 0 }}
					animate={{ scale: 1 }}
					transition={{ delay: 0.8, type: "spring", stiffness: 300 }}
				/>
				<motion.circle
					cx="60"
					cy="60"
					r="8"
					fill="var(--color-accent)"
					initial={{ scale: 0 }}
					animate={{ scale: 1 }}
					transition={{ delay: 1.0, type: "spring", stiffness: 400 }}
				/>
				<motion.circle
					cx="55"
					cy="55"
					r="3"
					fill="white"
					fillOpacity="0.8"
					initial={{ scale: 0 }}
					animate={{ scale: 1 }}
					transition={{ delay: 1.2, type: "spring", stiffness: 400 }}
				/>
			</svg>
		</motion.div>
	);
}

/* ------------------------------------------------------------------ */
/*  Celebration + Checkmark                                           */
/* ------------------------------------------------------------------ */

function CelebrationBurst() {
	const burstParticles = useRef(
		Array.from({ length: 24 }, (_, i) => {
			const angle = (i / 24) * Math.PI * 2;
			const distance = 60 + Math.random() * 80;
			return {
				id: i,
				x: Math.cos(angle) * distance,
				y: Math.sin(angle) * distance,
				size: Math.random() * 5 + 2,
				color: i % 3 === 0 ? "var(--color-accent)" : i % 3 === 1 ? "var(--color-success)" : "#fff",
			};
		}),
	).current;

	return (
		<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
			{burstParticles.map((p) => (
				<motion.div
					key={p.id}
					className="absolute rounded-full"
					style={{ width: p.size, height: p.size, backgroundColor: p.color }}
					initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
					animate={{ x: p.x, y: p.y, opacity: 0, scale: 0 }}
					transition={{ duration: 1.2, ease: "easeOut" }}
				/>
			))}
		</div>
	);
}

function AnimatedCheckmark() {
	return (
		<motion.div
			initial={{ scale: 0 }}
			animate={{ scale: 1 }}
			transition={{ type: "spring", stiffness: 300, damping: 20 }}
		>
			<svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true">
				<motion.circle
					cx="40"
					cy="40"
					r="36"
					stroke="var(--color-success)"
					strokeWidth="3"
					fill="none"
					initial={{ pathLength: 0 }}
					animate={{ pathLength: 1 }}
					transition={{ duration: 0.6, ease: "easeInOut" }}
				/>
				<motion.path
					d="M24 40 L34 50 L56 28"
					stroke="var(--color-success)"
					strokeWidth="3.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					fill="none"
					initial={{ pathLength: 0 }}
					animate={{ pathLength: 1 }}
					transition={{ duration: 0.4, delay: 0.5, ease: "easeInOut" }}
				/>
			</svg>
		</motion.div>
	);
}

/* ------------------------------------------------------------------ */
/*  Calibration Dot — ring and dot are properly centered              */
/* ------------------------------------------------------------------ */

function CalibrationDot({
	position,
	progress,
	status,
	warningText,
	spaceHeld,
}: {
	position: [number, number];
	progress: number;
	status: DotStatus;
	warningText: string | null;
	spaceHeld: boolean;
}) {
	const ringRadius = 28;
	const svgSize = (ringRadius + 4) * 2;
	const svgCenter = svgSize / 2;
	const circumference = 2 * Math.PI * ringRadius;
	const dashOffset = circumference * (1 - progress);

	const ringColor =
		status === "success"
			? "var(--color-success)"
			: status === "failed"
				? "var(--color-danger)"
				: "var(--color-accent)";

	return (
		<motion.div
			className="absolute"
			style={{
				left: `${position[0] * 100}%`,
				top: `${position[1] * 100}%`,
			}}
			initial={{ scale: 0, opacity: 0 }}
			animate={{
				scale: 1,
				opacity: 1,
				x: status === "failed" ? [0, -8, 8, -5, 5, 0] : 0,
			}}
			exit={{ scale: 0, opacity: 0 }}
			transition={
				status === "failed"
					? { duration: 0.4, ease: "easeInOut" }
					: { type: "spring", stiffness: 300, damping: 20 }
			}
		>
			{/* Container: centered on the position point */}
			<div
				className="relative flex items-center justify-center"
				style={{
					width: svgSize,
					height: svgSize,
					transform: "translate(-50%, -50%)",
				}}
			>
				{/* Outer pulsing ring (only when waiting for spacebar) */}
				{status === "waiting" && (
					<motion.div
						className="absolute rounded-full border-2"
						style={{
							width: svgSize + 16,
							height: svgSize + 16,
							borderColor: "var(--color-accent)",
							opacity: 0.2,
						}}
						animate={{ scale: [1, 1.2, 1] }}
						transition={{
							duration: 2,
							repeat: Number.POSITIVE_INFINITY,
							ease: "easeInOut",
						}}
					/>
				)}

				{/* Progress ring SVG — centered */}
				<svg
					width={svgSize}
					height={svgSize}
					className="absolute inset-0"
					style={{ transform: "rotate(-90deg)" }}
					aria-hidden="true"
				>
					{/* Background ring */}
					<circle
						cx={svgCenter}
						cy={svgCenter}
						r={ringRadius}
						fill="none"
						stroke="var(--color-border)"
						strokeWidth="2"
						opacity="0.3"
					/>
					{/* Progress arc */}
					<circle
						cx={svgCenter}
						cy={svgCenter}
						r={ringRadius}
						fill="none"
						stroke={ringColor}
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeDasharray={circumference}
						strokeDashoffset={dashOffset}
						style={{
							transition: "stroke-dashoffset 0.1s linear",
							filter: `drop-shadow(0 0 6px ${ringColor})`,
						}}
					/>
				</svg>

				{/* Center dot — absolutely centered */}
				{status === "success" ? (
					<motion.div
						className="relative z-10 flex items-center justify-center rounded-full"
						style={{
							width: 24,
							height: 24,
							backgroundColor: "var(--color-success)",
						}}
						initial={{ scale: 0 }}
						animate={{ scale: [0, 1.3, 1] }}
						transition={{ duration: 0.3 }}
					>
						<Check className="w-3.5 h-3.5 text-[var(--color-bg-primary)]" strokeWidth={3} />
					</motion.div>
				) : (
					<motion.div
						className="relative z-10 rounded-full flex items-center justify-center"
						style={{
							width: 24,
							height: 24,
							backgroundColor: spaceHeld ? "var(--color-accent)" : "var(--color-accent)",
							opacity: status === "waiting" ? 0.7 : 1,
							boxShadow: spaceHeld
								? "0 0 20px var(--color-glow-cyan), 0 0 40px var(--color-glow-cyan)"
								: "0 0 12px var(--color-glow-cyan)",
						}}
						animate={status === "collecting" ? { scale: [1, 1.08, 1] } : undefined}
						transition={
							status === "collecting"
								? {
										duration: 0.8,
										repeat: Number.POSITIVE_INFINITY,
										ease: "easeInOut",
									}
								: undefined
						}
					>
						<div
							className="rounded-full"
							style={{ width: 8, height: 8, backgroundColor: "#fff" }}
						/>
					</motion.div>
				)}
			</div>

			{/* Status text below */}
			<div
				className="absolute w-48 text-center"
				style={{
					top: svgSize / 2 + 40,
					left: "50%",
					transform: "translateX(-50%)",
				}}
			>
				<AnimatePresence mode="wait">
					{warningText && (
						<motion.p
							key="warning"
							className="text-[13px] font-medium whitespace-nowrap"
							style={{ color: "var(--color-danger)" }}
							initial={{ opacity: 0, y: -5 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -5 }}
						>
							{warningText}
						</motion.p>
					)}
					{status === "waiting" && !warningText && (
						<motion.p
							key="hint"
							className="text-[12px] font-medium whitespace-nowrap"
							style={{ color: "var(--color-text-muted)" }}
							initial={{ opacity: 0, y: -5 }}
							animate={{ opacity: [0.4, 0.8, 0.4] }}
							exit={{ opacity: 0 }}
							transition={{
								opacity: {
									duration: 2,
									repeat: Number.POSITIVE_INFINITY,
								},
							}}
						>
							Hold Space when ready
						</motion.p>
					)}
				</AnimatePresence>
			</div>
		</motion.div>
	);
}

/* ------------------------------------------------------------------ */
/*  Main CalibrationWizard component                                  */
/* ------------------------------------------------------------------ */

export function CalibrationWizard({
	isOpen,
	onComplete,
	onClose,
	currentTracking,
}: CalibrationWizardProps) {
	const [stage, setStage] = useState<Stage>("intro");
	const [currentPoint, setCurrentPoint] = useState(0);
	const [progress, setProgress] = useState(0);
	const [dotStatus, setDotStatus] = useState<DotStatus>("waiting");
	const [warningText, setWarningText] = useState<string | null>(null);
	const [completedPoints, setCompletedPoints] = useState<number[]>([]);
	const [calibrationResult, setCalibrationResult] = useState<CalibrationResult | null>(null);
	const [spaceHeld, setSpaceHeld] = useState(false);

	const samplesRef = useRef<[number, number][]>([]);
	const calibrationDataRef = useRef<CalibrationPoint[]>([]);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Reset state when wizard opens
	useEffect(() => {
		if (isOpen) {
			setStage("intro");
			setCurrentPoint(0);
			setProgress(0);
			setDotStatus("waiting");
			setWarningText(null);
			setCompletedPoints([]);
			setCalibrationResult(null);
			setSpaceHeld(false);
			samplesRef.current = [];
			calibrationDataRef.current = [];
		}
	}, [isOpen]);

	// Space key hold handling
	useEffect(() => {
		if (!isOpen || stage !== "calibrating") return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === " " && !e.repeat) {
				e.preventDefault();
				setSpaceHeld(true);
				// Start collecting if we were waiting
				setDotStatus((prev) => {
					if (prev === "waiting") {
						samplesRef.current = [];
						setProgress(0);
						setWarningText(null);
						return "collecting";
					}
					return prev;
				});
			}
			if (e.key === "Escape") {
				onClose();
			}
		};

		const handleKeyUp = (e: KeyboardEvent) => {
			if (e.key === " ") {
				e.preventDefault();
				setSpaceHeld(false);
				// If still collecting, abort and reset to waiting
				setDotStatus((prev) => {
					if (prev === "collecting") {
						samplesRef.current = [];
						setProgress(0);
						setWarningText("Released — hold Space to retry");
						// Clear warning after a moment
						if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
						retryTimerRef.current = setTimeout(() => setWarningText(null), 1500);
						return "waiting";
					}
					return prev;
				});
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
		};
	}, [isOpen, stage, onClose]);

	// Intro/complete keyboard shortcuts
	useEffect(() => {
		if (!isOpen || stage === "calibrating") return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			} else if ((e.key === " " || e.key === "Enter") && stage === "intro") {
				e.preventDefault();
				startCalibration();
			} else if ((e.key === " " || e.key === "Enter") && stage === "complete") {
				e.preventDefault();
				handleFinish();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, stage, onClose]);

	const startCalibration = useCallback(() => {
		setStage("calibrating");
		setCurrentPoint(0);
		setProgress(0);
		setDotStatus("waiting");
		setWarningText(null);
		setSpaceHeld(false);
		samplesRef.current = [];
		calibrationDataRef.current = [];
	}, []);

	// Collect samples while Space is held
	useEffect(() => {
		if (stage !== "calibrating" || dotStatus !== "collecting") return;
		if (!currentTracking?.pupil?.center) return;

		const sample: [number, number] = [
			currentTracking.pupil.center[0],
			currentTracking.pupil.center[1],
		];
		samplesRef.current.push(sample);

		const count = samplesRef.current.length;
		setProgress(Math.min(count / REQUIRED_SAMPLES, 1));

		// Real-time stability check — if recent samples deviate too much, fail immediately
		if (count >= STABILITY_CHECK_WINDOW) {
			const recentSamples = samplesRef.current.slice(-STABILITY_CHECK_WINDOW);
			if (!checkStability(recentSamples, 12)) {
				// Gaze deviated — immediate failure
				setDotStatus("failed");
				setWarningText("Gaze moved — hold Space to retry");
				setSpaceHeld(false);
				samplesRef.current = [];
				setProgress(0);
				if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
				retryTimerRef.current = setTimeout(() => {
					setWarningText(null);
					setDotStatus("waiting");
				}, 1500);
				return;
			}
		}

		// Enough stable samples collected — success!
		if (count >= REQUIRED_SAMPLES) {
			if (checkStability(samplesRef.current)) {
				const [sx, sy] = CALIBRATION_POSITIONS[currentPoint];
				calibrationDataRef.current.push({
					screenX: sx,
					screenY: sy,
					samples: [...samplesRef.current],
				});

				setDotStatus("success");
				setProgress(1);
				setCompletedPoints((prev) => [...prev, currentPoint]);

				// Advance to next point
				setTimeout(() => {
					const nextPoint = currentPoint + 1;
					if (nextPoint >= CALIBRATION_POSITIONS.length) {
						const result = computeCalibration(calibrationDataRef.current);
						setCalibrationResult(result);
						setStage("complete");
					} else {
						setCurrentPoint(nextPoint);
						setProgress(0);
						setDotStatus("waiting");
						setWarningText(null);
						setSpaceHeld(false);
						samplesRef.current = [];
					}
				}, 500);
			} else {
				// Accumulated samples are unstable
				setDotStatus("failed");
				setWarningText("Unstable — hold Space to retry");
				setSpaceHeld(false);
				samplesRef.current = [];
				setProgress(0);
				if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
				retryTimerRef.current = setTimeout(() => {
					setWarningText(null);
					setDotStatus("waiting");
				}, 1500);
			}
		}
	}, [currentTracking, stage, currentPoint, dotStatus]);

	// Cleanup
	useEffect(() => {
		return () => {
			if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
		};
	}, []);

	const handleFinish = useCallback(() => {
		if (calibrationResult) onComplete(calibrationResult);
	}, [calibrationResult, onComplete]);

	const handleRecalibrate = useCallback(() => {
		setStage("intro");
		setCurrentPoint(0);
		setProgress(0);
		setDotStatus("waiting");
		setWarningText(null);
		setCompletedPoints([]);
		setCalibrationResult(null);
		setSpaceHeld(false);
		samplesRef.current = [];
		calibrationDataRef.current = [];
	}, []);

	if (!isOpen) return null;

	return (
		<motion.div
			className="fixed inset-0 z-50 flex items-center justify-center"
			style={{
				background:
					"radial-gradient(ellipse at center, rgba(14,116,144,0.08) 0%, rgba(0,0,0,0.95) 70%)",
			}}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.3 }}
		>
			<Particles />

			<AnimatePresence mode="wait">
				{/* -------- Stage 1: Intro -------- */}
				{stage === "intro" && (
					<motion.div
						key="intro"
						className="relative z-10 flex flex-col items-center text-center max-w-md"
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -20 }}
						transition={{ duration: 0.4 }}
					>
						<EyeIcon />

						<motion.h1
							className="mt-8 text-4xl font-light tracking-tight"
							style={{ color: "var(--color-text-primary)" }}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.4 }}
						>
							Eye Calibration
						</motion.h1>

						<motion.p
							className="mt-3 text-[15px] leading-relaxed"
							style={{ color: "var(--color-text-secondary)" }}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.5 }}
						>
							Look at each dot and hold{" "}
							<kbd className="px-1.5 py-0.5 mx-1 rounded bg-white/10 text-[var(--color-accent)] font-mono text-[13px]">
								Space
							</kbd>{" "}
							to calibrate.
						</motion.p>

						<motion.div
							className="mt-8 space-y-3 text-left"
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.6 }}
						>
							<div className="flex items-start gap-3">
								<div
									className="mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
									style={{ backgroundColor: "rgba(34,211,238,0.1)" }}
								>
									<Crosshair className="w-4 h-4" style={{ color: "var(--color-accent)" }} />
								</div>
								<p className="text-[13px]" style={{ color: "var(--color-text-secondary)" }}>
									9 points in a 3×3 grid. Look at each dot, then hold Space while keeping your gaze
									steady.
								</p>
							</div>
							<div className="flex items-start gap-3">
								<div
									className="mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
									style={{ backgroundColor: "rgba(34,211,238,0.1)" }}
								>
									<MoveHorizontal className="w-4 h-4" style={{ color: "var(--color-accent)" }} />
								</div>
								<p className="text-[13px]" style={{ color: "var(--color-text-secondary)" }}>
									If your gaze drifts or you release Space, the point resets. Keep your head still.
								</p>
							</div>
						</motion.div>

						<motion.button
							type="button"
							className="mt-10 px-8 py-3 rounded-full text-[15px] font-medium cursor-pointer"
							style={{
								backgroundColor: "var(--color-accent)",
								color: "var(--color-bg-primary)",
								boxShadow: "0 0 30px var(--color-glow-cyan)",
							}}
							whileHover={{ scale: 1.03 }}
							whileTap={{ scale: 0.97 }}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.7 }}
							onClick={startCalibration}
						>
							Begin Calibration
						</motion.button>

						<motion.button
							type="button"
							className="mt-4 text-[13px] cursor-pointer bg-transparent border-none"
							style={{ color: "var(--color-text-muted)" }}
							whileHover={{ color: "var(--color-text-secondary)" }}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ delay: 0.8 }}
							onClick={onClose}
						>
							Skip
						</motion.button>
					</motion.div>
				)}

				{/* -------- Stage 2: Calibrating -------- */}
				{stage === "calibrating" && (
					<motion.div
						key="calibrating"
						className="absolute inset-0"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
					>
						{/* Completed points as small green dots */}
						{completedPoints.map((idx) => {
							const [x, y] = CALIBRATION_POSITIONS[idx];
							return (
								<motion.div
									key={`done-${idx}`}
									className="absolute rounded-full"
									style={{
										left: `${x * 100}%`,
										top: `${y * 100}%`,
										width: 8,
										height: 8,
										backgroundColor: "var(--color-success)",
										opacity: 0.35,
										transform: "translate(-50%, -50%)",
									}}
									initial={{ scale: 0 }}
									animate={{ scale: 1 }}
								/>
							);
						})}

						{/* Current calibration dot */}
						<AnimatePresence mode="wait">
							<CalibrationDot
								key={`point-${currentPoint}`}
								position={CALIBRATION_POSITIONS[currentPoint]}
								progress={progress}
								status={dotStatus}
								warningText={warningText}
								spaceHeld={spaceHeld}
							/>
						</AnimatePresence>

						{/* Progress counter */}
						<motion.div
							className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 text-[14px] font-medium"
							style={{ color: "var(--color-text-muted)" }}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ delay: 0.3 }}
						>
							<span>
								{currentPoint + 1} / {CALIBRATION_POSITIONS.length}
							</span>
							<span className="text-[11px] px-2 py-0.5 rounded-md bg-white/5">Esc to cancel</span>
						</motion.div>
					</motion.div>
				)}

				{/* -------- Stage 3: Complete -------- */}
				{stage === "complete" && calibrationResult && (
					<motion.div
						key="complete"
						className="relative z-10 flex flex-col items-center text-center"
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -20 }}
						transition={{ duration: 0.4 }}
					>
						<CelebrationBurst />
						<AnimatedCheckmark />

						<motion.h1
							className="mt-6 text-3xl font-light tracking-tight"
							style={{ color: "var(--color-text-primary)" }}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.3 }}
						>
							Calibration Complete
						</motion.h1>

						<motion.div
							className="mt-4 flex items-center gap-3"
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.5 }}
						>
							<span className="text-[14px]" style={{ color: "var(--color-text-secondary)" }}>
								Accuracy: ~{(calibrationResult.accuracy * 100).toFixed(1)}%
							</span>
							<span
								className="px-2.5 py-0.5 rounded-full text-[12px] font-semibold"
								style={{
									backgroundColor: `color-mix(in srgb, ${accuracyLabel(calibrationResult.accuracy).color} 15%, transparent)`,
									color: accuracyLabel(calibrationResult.accuracy).color,
								}}
							>
								{accuracyLabel(calibrationResult.accuracy).label}
							</span>
						</motion.div>

						<motion.button
							type="button"
							className="mt-8 px-8 py-3 rounded-full text-[15px] font-medium cursor-pointer"
							style={{
								backgroundColor: "var(--color-success)",
								color: "var(--color-bg-primary)",
								boxShadow: "0 0 30px var(--color-glow-green)",
							}}
							whileHover={{ scale: 1.03 }}
							whileTap={{ scale: 0.97 }}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.6 }}
							onClick={handleFinish}
						>
							Start Tracking
						</motion.button>

						<motion.button
							type="button"
							className="mt-4 text-[13px] cursor-pointer bg-transparent border-none"
							style={{ color: "var(--color-text-muted)" }}
							whileHover={{ color: "var(--color-text-secondary)" }}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ delay: 0.7 }}
							onClick={handleRecalibrate}
						>
							Recalibrate
						</motion.button>
					</motion.div>
				)}
			</AnimatePresence>
		</motion.div>
	);
}
