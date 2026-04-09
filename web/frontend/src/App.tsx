import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalibrationWizard } from "./components/CalibrationWizard";
import { CameraSelector, type TrackerSelection } from "./components/CameraSelector";
import { ControlPanel } from "./components/ControlPanel";
import { EyeModel3D } from "./components/EyeModel3D";
import { GazeCursor } from "./components/GazeCursor";
import { GazeHeatmap } from "./components/GazeHeatmap";
import { GazeTrail } from "./components/GazeTrail";
import { Header } from "./components/Header";
import { RangeCalibrationWizard } from "./components/RangeCalibrationWizard";
import { VideoFeed } from "./components/VideoFeed";
import { useTheme } from "./hooks/useTheme";
import { useTrackingData } from "./hooks/useTrackingData";
import { useWebSocket } from "./hooks/useWebSocket";
import { type CalibrationResult, applyCalibration } from "./lib/calibration";
import { DEFAULT_SETTINGS } from "./types/tracking";
import type { ActiveWizard, EyeSide, Settings, TrackingMode, ViewMode } from "./types/tracking";

interface TrackerInfo {
	id: string;
	cameraIndex: number;
	eye: EyeSide;
	running: boolean;
	rangeCalibrated: boolean;
	gazeCalibration: CalibrationResult | null;
	rotation: number;
}

export default function App() {
	const { theme, toggleTheme } = useTheme();
	const [trackerIds, setTrackerIds] = useState<string[]>([]);
	const [trackerEyes, setTrackerEyes] = useState<Map<string, EyeSide>>(new Map());
	const [initialLoading, setInitialLoading] = useState(true);
	const [showCameraSelector, setShowCameraSelector] = useState(false);
	const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
	const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
	const [calibrations, setCalibrations] = useState<Map<string, CalibrationResult>>(new Map());
	const [activeWizard, setActiveWizard] = useState<ActiveWizard>(null);
	const [rangeCalibrated, setRangeCalibrated] = useState<Set<string>>(new Set());
	const [showGazeCursor, setShowGazeCursor] = useState(false);
	const [mirrored, setMirrored] = useState(true);
	const [paused, setPaused] = useState(false);
	const manuallyPausedRef = useRef(false);
	const pausedBeforeCalibrationRef = useRef(false);
	const { trackers, history, historyVersion, handleFrame, pushGazePoint, clearHistory } =
		useTrackingData();

	const wsUrl = `ws://${window.location.hostname}:${window.location.port || "5173"}/ws`;
	const { status: connectionStatus, send } = useWebSocket({
		url: wsUrl,
		onFrame: handleFrame,
	});

	// Sync tracker list from backend on every (re)connect
	useEffect(() => {
		if (connectionStatus !== "connected") return;
		(async () => {
			try {
				const res = await fetch("/api/trackers");
				const data: { trackers: TrackerInfo[] } = await res.json();
				const list = data.trackers ?? [];
				const ids = list.map((t) => t.id);
				setTrackerIds(ids);
				const eyes = new Map<string, EyeSide>();
				const calibrated = new Set<string>();
				const restoredCals = new Map<string, CalibrationResult>();
				for (const t of list) {
					eyes.set(t.id, t.eye);
					if (t.rangeCalibrated) calibrated.add(t.id);
					if (t.gazeCalibration) restoredCals.set(t.id, t.gazeCalibration);
				}
				setTrackerEyes(eyes);
				setRangeCalibrated(calibrated);
				if (restoredCals.size > 0) {
					setCalibrations(restoredCals);
					setShowGazeCursor(true);
				}
				if (ids.length > 0) {
					// Ensure broadcast is running
					fetch("/api/pause", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ paused: false }),
					}).catch(() => {});
					setPaused(false);
				}
			} catch {
				/* ignore */
			} finally {
				setInitialLoading(false);
			}
		})();
	}, [connectionStatus]);

	// Eye-tracker lookups
	const findByEye = useCallback(
		(eye: EyeSide) => {
			for (const [id, e] of trackerEyes) {
				if (e === eye) return id;
			}
			return null;
		},
		[trackerEyes],
	);

	const leftTrackerId = findByEye("left");
	const rightTrackerId = findByEye("right");
	const leftState = leftTrackerId ? (trackers.get(leftTrackerId) ?? null) : null;
	const rightState = rightTrackerId ? (trackers.get(rightTrackerId) ?? null) : null;
	const hasBothEyes = leftTrackerId != null && rightTrackerId != null;
	const hasAnyCalibration = calibrations.size > 0;
	const allRangeCalibrated =
		trackerIds.length > 0 && trackerIds.every((id) => rangeCalibrated.has(id));

	// Any calibration exists (for header UI state)
	const anyCalibration =
		calibrations.size > 0 ? (calibrations.values().next().value ?? null) : null;

	// Fused gaze — weighted by detection confidence × calibration accuracy
	const fusedGaze = useMemo(() => {
		let totalWeight = 0;
		let sx = 0;
		let sy = 0;
		for (const [id, state] of trackers) {
			const cal = calibrations.get(id);
			if (!cal || !state.tracking.pupil) continue;
			const [x, y] = applyCalibration(state.tracking.pupil.center, cal);
			// Weight = detection confidence × inverse calibration error
			// Lower accuracy (error) → higher weight
			const calWeight = cal.accuracy > 0 ? 1 / cal.accuracy : 1;
			const w = state.tracking.confidence * calWeight;
			sx += x * w;
			sy += y * w;
			totalWeight += w;
		}
		if (totalWeight === 0) return null;
		return [sx / totalWeight, sy / totalWeight] as [number, number];
	}, [trackers, calibrations]);

	// Push fused gaze into history for heatmap/trail
	useEffect(() => {
		if (fusedGaze) pushGazePoint(fusedGaze);
	}, [fusedGaze, pushGazePoint]);

	// Pause
	const setPausedAndSync = useCallback((newPaused: boolean) => {
		setPaused(newPaused);
		fetch("/api/pause", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ paused: newPaused }),
		}).catch(() => {});
	}, []);

	useEffect(() => {
		const handleVisibility = () => {
			if (document.hidden) {
				setPausedAndSync(true);
			} else if (!manuallyPausedRef.current) {
				setPausedAndSync(false);
			}
		};
		document.addEventListener("visibilitychange", handleVisibility);
		return () => document.removeEventListener("visibilitychange", handleVisibility);
	}, [setPausedAndSync]);

	// Auto-resume during calibration
	const isCalibrating = activeWizard === "gaze";
	useEffect(() => {
		if (isCalibrating && paused) {
			pausedBeforeCalibrationRef.current = true;
			setPausedAndSync(false);
		} else if (!isCalibrating && pausedBeforeCalibrationRef.current) {
			pausedBeforeCalibrationRef.current = false;
			setPausedAndSync(true);
		}
	}, [isCalibrating, paused, setPausedAndSync]);

	// Settings
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

	// Calibration handlers — operate on ALL trackers simultaneously
	const handleGazeCalibrationComplete = useCallback(
		(results: Map<string, CalibrationResult>) => {
			setCalibrations(results);
			setActiveWizard(null);
			setShowGazeCursor(true);
			clearHistory();
			// Persist each tracker's calibration to backend
			for (const [id, result] of results) {
				fetch(`/api/trackers/${id}/gaze-calibrate`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(result),
				}).catch(() => {});
			}
		},
		[clearHistory],
	);

	const handleRangeCalibrationComplete = useCallback(() => {
		setRangeCalibrated(new Set(trackerIds));
	}, [trackerIds]);

	const clearGazeCalibration = useCallback(() => {
		setCalibrations(new Map());
		setShowGazeCursor(false);
		for (const id of trackerIds) {
			fetch(`/api/trackers/${id}/gaze-calibrate`, { method: "DELETE" }).catch(() => {});
		}
	}, [trackerIds]);

	const clearRangeCalibration = useCallback(() => {
		setRangeCalibrated(new Set());
		for (const id of trackerIds) {
			fetch(`/api/trackers/${id}/range-calibrate`, { method: "DELETE" }).catch(() => {});
		}
	}, [trackerIds]);

	const resetAll = useCallback(() => {
		setCalibrations(new Map());
		setRangeCalibrated(new Set());
		setShowGazeCursor(false);
		clearHistory();
		updateSettings(DEFAULT_SETTINGS);
		for (const id of trackerIds) {
			fetch(`/api/trackers/${id}/range-calibrate`, { method: "DELETE" }).catch(() => {});
		}
	}, [clearHistory, updateSettings, trackerIds]);

	const handleModeChange = useCallback(
		(newMode: TrackingMode) => updateSettings({ mode: newMode }),
		[updateSettings],
	);

	const isFullscreenView = viewMode === "heatmap" || viewMode === "trail";

	const handleTrackerSelect = useCallback((selections: TrackerSelection[]) => {
		setTrackerIds(selections.map((s) => s.id));
		const eyes = new Map<string, EyeSide>();
		for (const s of selections) eyes.set(s.id, s.eye);
		setTrackerEyes(eyes);
		setShowCameraSelector(false);
		setPaused(false);
	}, []);

	// Wait for initial backend sync before deciding what to show
	if (initialLoading) return null;

	if (trackerIds.length === 0 || showCameraSelector) {
		return <CameraSelector onSelect={handleTrackerSelect} />;
	}

	// Feed order follows mirror/anatomical mode
	const feedOrder = mirrored
		? [
				{ id: leftTrackerId, label: "Left Eye" },
				{ id: rightTrackerId, label: "Right Eye" },
			]
		: [
				{ id: rightTrackerId, label: "Right Eye" },
				{ id: leftTrackerId, label: "Left Eye" },
			];

	const singleTrackerId = trackerIds[0];
	const singleEye = trackerEyes.get(singleTrackerId);
	const singleState = trackers.get(singleTrackerId);

	return (
		<div className="h-screen relative overflow-hidden flex flex-col">
			{isFullscreenView && (
				<div className="absolute inset-0 z-0">
					{viewMode === "heatmap" && (
						<GazeHeatmap history={history} historyVersion={historyVersion} onClear={clearHistory} />
					)}
					{viewMode === "trail" && <GazeTrail history={history} />}
				</div>
			)}

			<Header
				connectionStatus={connectionStatus}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				calibration={anyCalibration}
				showGazeCursor={showGazeCursor}
				paused={paused}
				trackerCount={trackerIds.length}
				rangeCalibrated={allRangeCalibrated}
				onRangeCalibrateClick={() => setActiveWizard("bounds")}
				onCalibrateClick={() => setActiveWizard("gaze")}
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
				mode={settings.mode}
				onModeChange={handleModeChange}
				theme={theme}
				onToggleTheme={toggleTheme}
			/>

			{viewMode === "dashboard" && (
				<main className="flex-1 overflow-y-auto p-3">
					{hasBothEyes ? (
						<div className="grid gap-3 grid-cols-3">
							{feedOrder.map(
								(feed) =>
									feed.id && (
										<VideoFeed
											key={feed.id}
											label={feed.label}
											trackerId={feed.id}
											image={trackers.get(feed.id)?.image ?? ""}
											tracking={trackers.get(feed.id)?.tracking ?? null}
											history={history}
											showMetrics
										/>
									),
							)}
							<div className="flex flex-col gap-3">
								{settings.mode !== "screen" && (
									<EyeModel3D
										leftTracking={leftState?.tracking ?? null}
										rightTracking={rightState?.tracking ?? null}
										mirrored={mirrored}
										onToggleMirror={() => setMirrored((v) => !v)}
									/>
								)}
								<ControlPanel
									settings={settings}
									onSettingsChange={updateSettings}
									onReset={() => updateSettings(DEFAULT_SETTINGS)}
								/>
							</div>
						</div>
					) : (
						/* Single eye: same 3-col grid, feed in first col, sidebar in last */
						<div className="grid gap-3 grid-cols-3">
							<VideoFeed
								label={singleEye === "left" ? "Left Eye" : "Right Eye"}
								trackerId={singleTrackerId}
								image={singleState?.image ?? ""}
								tracking={singleState?.tracking ?? null}
								history={history}
								showMetrics
							/>
							{/* Empty middle column */}
							<div />
							<div className="flex flex-col gap-3">
								{settings.mode !== "screen" && (
									<EyeModel3D
										leftTracking={leftState?.tracking ?? null}
										rightTracking={rightState?.tracking ?? null}
										mirrored={mirrored}
										onToggleMirror={() => setMirrored((v) => !v)}
									/>
								)}
								<ControlPanel
									settings={settings}
									onSettingsChange={updateSettings}
									onReset={() => updateSettings(DEFAULT_SETTINGS)}
								/>
							</div>
						</div>
					)}
				</main>
			)}

			<CalibrationWizard
				isOpen={activeWizard === "gaze"}
				onComplete={handleGazeCalibrationComplete}
				onClose={() => setActiveWizard(null)}
				allTrackers={trackers}
			/>
			<RangeCalibrationWizard
				isOpen={activeWizard === "bounds"}
				onComplete={handleRangeCalibrationComplete}
				onClose={() => setActiveWizard(null)}
				allTrackers={trackers}
				trackerIds={trackerIds}
				rangeMargin={settings.rangeMargin}
			/>

			<GazeCursor gazePosition={fusedGaze} visible={showGazeCursor && hasAnyCalibration} />
		</div>
	);
}
