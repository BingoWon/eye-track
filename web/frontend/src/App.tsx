import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalibrationWizard } from "./components/CalibrationWizard";
import { CameraSelector } from "./components/CameraSelector";
import { ControlPanel } from "./components/ControlPanel";
import { EyeModel3D } from "./components/EyeModel3D";
import { GazeCursor } from "./components/GazeCursor";
import { GazeHeatmap } from "./components/GazeHeatmap";
import { GazeTrail } from "./components/GazeTrail";
import { Header } from "./components/Header";
import { MetricsPanel } from "./components/MetricsPanel";
import { RangeCalibrationWizard } from "./components/RangeCalibrationWizard";
import { VideoFeed } from "./components/VideoFeed";
import { useTrackingData } from "./hooks/useTrackingData";
import { useWebSocket } from "./hooks/useWebSocket";
import { type CalibrationResult, applyCalibration } from "./lib/calibration";
import { DEFAULT_SETTINGS } from "./types/tracking";
import type { Settings } from "./types/tracking";

type ViewMode = "dashboard" | "heatmap" | "trail";

export default function App() {
	const [trackerIds, setTrackerIds] = useState<string[]>([]);
	const [showCameraSelector, setShowCameraSelector] = useState(false);
	const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
	const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
	const [calibrations, setCalibrations] = useState<Map<string, CalibrationResult>>(new Map());
	const [showCalibration, setShowCalibration] = useState(false);
	const [showRangeCalibration, setShowRangeCalibration] = useState(false);
	const [rangeCalibrated, setRangeCalibrated] = useState<Set<string>>(new Set());
	const [showGazeCursor, setShowGazeCursor] = useState(false);
	const [paused, setPaused] = useState(false);
	const [selectedTracker, setSelectedTracker] = useState<string | null>(null);
	const manuallyPausedRef = useRef(false);
	const pausedBeforeCalibrationRef = useRef(false);
	const { trackers, history, historyVersion, handleFrame, clearHistory } = useTrackingData();

	const wsUrl = `ws://${window.location.hostname}:${window.location.port || "5173"}/ws`;
	const { status: connectionStatus, send } = useWebSocket({
		url: wsUrl,
		onFrame: handleFrame,
	});

	// Default selectedTracker to first tracker when trackerIds are set
	useEffect(() => {
		if (trackerIds.length > 0 && selectedTracker === null) {
			setSelectedTracker(trackerIds[0]);
		}
	}, [trackerIds, selectedTracker]);

	// Sync tracker list from backend on every reconnect
	useEffect(() => {
		if (connectionStatus !== "connected") return;
		(async () => {
			try {
				const res = await fetch("/api/trackers");
				const data = await res.json();
				const ids: string[] = data.trackers?.map((c: any) => c.id) ?? [];
				setTrackerIds(ids);
				if (ids.length > 0) {
					setSelectedTracker((prev) => (prev && ids.includes(prev) ? prev : ids[0]));
				}
			} catch {
				/* ignore */
			}
		})();
	}, [connectionStatus]);

	// Get the selected tracker's state
	const selectedState = selectedTracker ? (trackers.get(selectedTracker) ?? null) : null;
	const currentData = selectedState?.tracking ?? null;
	const currentImage = selectedState?.image ?? "";

	// Primary calibration (for heatmap/trail — uses selected tracker's)
	const primaryCalibration = selectedTracker ? (calibrations.get(selectedTracker) ?? null) : null;

	// Check if any camera is calibrated
	const hasAnyCalibration = calibrations.size > 0;

	// Fused gaze position from all calibrated cameras
	const fusedGaze = useMemo(() => {
		let totalWeight = 0;
		let sx = 0;
		let sy = 0;
		for (const [id, state] of trackers) {
			const cal = calibrations.get(id);
			if (!cal || !state.tracking.pupil) continue;
			const [x, y] = applyCalibration(state.tracking.pupil.center, cal);
			const w = state.tracking.confidence;
			sx += x * w;
			sy += y * w;
			totalWeight += w;
		}
		if (totalWeight === 0) return null;
		return [sx / totalWeight, sy / totalWeight] as [number, number];
	}, [trackers, calibrations]);

	// Sync pause state to backend
	const setPausedAndSync = useCallback((newPaused: boolean) => {
		setPaused(newPaused);
		fetch("/api/pause", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ paused: newPaused }),
		}).catch(() => {});
	}, []);

	// Auto-pause when tab is hidden — but respect manual pause
	useEffect(() => {
		const handleVisibility = () => {
			if (document.hidden) {
				// Always pause when tab hidden
				setPausedAndSync(true);
			} else {
				// Only resume if user didn't manually pause
				if (!manuallyPausedRef.current) {
					setPausedAndSync(false);
				}
			}
		};
		document.addEventListener("visibilitychange", handleVisibility);
		return () => document.removeEventListener("visibilitychange", handleVisibility);
	}, [setPausedAndSync]);

	// Resume tracking during calibration (it needs live data), pause after
	useEffect(() => {
		if (showCalibration && paused) {
			pausedBeforeCalibrationRef.current = true;
			setPausedAndSync(false);
		} else if (!showCalibration && pausedBeforeCalibrationRef.current) {
			pausedBeforeCalibrationRef.current = false;
			setPausedAndSync(true);
		}
	}, [showCalibration, paused, setPausedAndSync]);

	// Handlers (must be before any early return to keep hooks order stable)
	const updateSettings = useCallback(
		(newSettings: Partial<Settings>) => {
			const merged = { ...settings, ...newSettings };
			setSettings(merged);
			send({ type: "settings", ...merged });
			fetch("/api/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(merged),
			}).catch(() => {});
		},
		[settings, send],
	);

	const handleCalibrationComplete = useCallback(
		(result: CalibrationResult) => {
			if (selectedTracker) {
				setCalibrations((prev) => {
					const next = new Map(prev);
					next.set(selectedTracker, result);
					return next;
				});
			}
			setShowCalibration(false);
			setShowGazeCursor(true);
			clearHistory();
		},
		[selectedTracker, clearHistory],
	);

	const handleRangeCalibrationComplete = useCallback(
		(_bounds: { cx: number; cy: number; rx: number; ry: number }) => {
			if (selectedTracker) {
				setRangeCalibrated((prev) => new Set(prev).add(selectedTracker));
			}
		},
		[selectedTracker],
	);

	const clearGazeCalibration = useCallback(() => {
		if (selectedTracker) {
			setCalibrations((prev) => {
				const n = new Map(prev);
				n.delete(selectedTracker);
				return n;
			});
			setShowGazeCursor(false);
		}
	}, [selectedTracker]);

	const clearRangeCalibration = useCallback(() => {
		if (selectedTracker) {
			setRangeCalibrated((prev) => {
				const n = new Set(prev);
				n.delete(selectedTracker);
				return n;
			});
			fetch(`/api/trackers/${selectedTracker}/range-calibrate`, { method: "DELETE" }).catch(
				() => {},
			);
		}
	}, [selectedTracker]);

	const resetAll = useCallback(() => {
		setCalibrations(new Map());
		setRangeCalibrated(new Set());
		setShowGazeCursor(false);
		clearHistory();
		updateSettings(DEFAULT_SETTINGS);
	}, [clearHistory, updateSettings]);

	const isFullscreenView = viewMode === "heatmap" || viewMode === "trail";

	const handleTrackerSelect = useCallback((ids: string[]) => {
		setTrackerIds(ids);
		setSelectedTracker(ids[0] ?? null);
		setShowCameraSelector(false);
	}, []);

	// Show camera selector
	if (trackerIds.length === 0 || showCameraSelector) {
		return <CameraSelector onSelect={handleTrackerSelect} />;
	}

	return (
		<div className="h-screen relative overflow-hidden flex flex-col">
			{/* Fullscreen views render behind the header */}
			{isFullscreenView && (
				<div className="absolute inset-0 z-0">
					{viewMode === "heatmap" && (
						<GazeHeatmap
							history={history}
							historyVersion={historyVersion}
							onClear={clearHistory}
							calibration={primaryCalibration}
						/>
					)}
					{viewMode === "trail" && (
						<GazeTrail history={history} tracking={currentData} calibration={primaryCalibration} />
					)}
				</div>
			)}

			{/* Header always on top */}
			<Header
				connectionStatus={connectionStatus}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				calibration={primaryCalibration}
				showGazeCursor={showGazeCursor}
				paused={paused}
				trackerCount={trackerIds.length}
				rangeCalibrated={selectedTracker ? rangeCalibrated.has(selectedTracker) : false}
				onRangeCalibrateClick={() => setShowRangeCalibration(true)}
				onCalibrateClick={() => setShowCalibration(true)}
				onClearCalibration={clearGazeCalibration}
				onClearRangeCalibration={clearRangeCalibration}
				onResetAll={resetAll}
				onToggleGazeCursor={() => setShowGazeCursor((v) => !v)}
				onTogglePause={() => {
					const next = !paused;
					manuallyPausedRef.current = next;
					setPausedAndSync(next);
				}}
				onChangeCameraClick={() => setShowCameraSelector(true)}
			/>

			{/* Dashboard view */}
			{viewMode === "dashboard" && (
				<main className="flex-1 overflow-hidden p-3">
					{/* Camera selector tabs (when multiple cameras) */}
					{trackerIds.length > 1 && (
						<div className="flex items-center gap-1.5 mb-3">
							{trackerIds.map((id) => (
								<button
									key={id}
									type="button"
									onClick={() => setSelectedTracker(id)}
									className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200 cursor-pointer border ${
										selectedTracker === id
											? "bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/30"
											: "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border-[var(--color-border)]/50 hover:border-[var(--color-border-active)]"
									}`}
								>
									{id}
									{calibrations.has(id) && (
										<span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
									)}
								</button>
							))}
						</div>
					)}

					<div className="h-full grid gap-3 grid-cols-2 grid-rows-2">
						<VideoFeed image={currentImage} tracking={currentData} />
						<EyeModel3D tracking={currentData} />
						<MetricsPanel tracking={currentData} history={history} />
						<ControlPanel
							settings={settings}
							onSettingsChange={updateSettings}
							onReset={() => updateSettings(DEFAULT_SETTINGS)}
						/>
					</div>
				</main>
			)}

			{/* Calibration overlays */}
			<CalibrationWizard
				isOpen={showCalibration}
				onComplete={handleCalibrationComplete}
				onClose={() => setShowCalibration(false)}
				currentTracking={currentData}
			/>
			<RangeCalibrationWizard
				isOpen={showRangeCalibration}
				onComplete={handleRangeCalibrationComplete}
				onClose={() => setShowRangeCalibration(false)}
				currentTracking={currentData}
				trackerId={selectedTracker}
				rangeMargin={settings.rangeMargin}
			/>

			{/* Gaze cursor overlay */}
			<GazeCursor gazePosition={fusedGaze} visible={showGazeCursor && hasAnyCalibration} />
		</div>
	);
}
