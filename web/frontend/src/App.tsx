import { useCallback, useEffect, useRef, useState } from "react";
import { CalibrationWizard } from "./components/CalibrationWizard";
import { CameraSelector } from "./components/CameraSelector";
import { ControlPanel } from "./components/ControlPanel";
import { EyeModel3D } from "./components/EyeModel3D";
import { GazeCursor } from "./components/GazeCursor";
import { GazeHeatmap } from "./components/GazeHeatmap";
import { GazeTrail } from "./components/GazeTrail";
import { Header } from "./components/Header";
import { MetricsPanel } from "./components/MetricsPanel";
import { VideoFeed } from "./components/VideoFeed";
import { useTrackingData } from "./hooks/useTrackingData";
import { useWebSocket } from "./hooks/useWebSocket";
import type { CalibrationResult } from "./lib/calibration";
import { DEFAULT_SETTINGS } from "./types/tracking";
import type { Settings } from "./types/tracking";

type ViewMode = "dashboard" | "heatmap" | "trail";

export default function App() {
	const [cameraSelected, setCameraSelected] = useState(false);
	const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
	const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
	const [expandedPanel, setExpandedPanel] = useState<string | null>(null);
	const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
	const [showCalibration, setShowCalibration] = useState(false);
	const [showGazeCursor, setShowGazeCursor] = useState(false);
	const [paused, setPaused] = useState(false);
	const pausedBeforeCalibrationRef = useRef(false);
	const {
		currentData,
		currentImage,
		history,
		historyVersion,
		clientFps,
		handleFrame,
		clearHistory,
	} = useTrackingData();

	const wsUrl = `ws://${window.location.hostname}:${window.location.port || "5173"}/ws`;
	const { status: connectionStatus, send } = useWebSocket({
		url: wsUrl,
		onFrame: handleFrame,
	});

	// Sync pause state to backend
	const setPausedAndSync = useCallback((newPaused: boolean) => {
		setPaused(newPaused);
		fetch("/api/pause", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ paused: newPaused }),
		}).catch(() => {});
	}, []);

	// Auto-pause when tab is hidden, resume when visible
	useEffect(() => {
		const handleVisibility = () => {
			if (document.hidden) {
				setPausedAndSync(true);
			} else {
				setPausedAndSync(false);
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
	}, [showCalibration]);

	// Show camera selector before the main dashboard
	if (!cameraSelected) {
		return <CameraSelector onSelect={() => setCameraSelected(true)} />;
	}

	const updateSettings = (newSettings: Partial<Settings>) => {
		const merged = { ...settings, ...newSettings };
		setSettings(merged);
		send({ type: "settings", ...merged });
		fetch("/api/settings", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(merged),
		}).catch(() => {});
	};

	const togglePanel = (panel: string) => {
		setExpandedPanel(expandedPanel === panel ? null : panel);
	};

	const handleCalibrationComplete = (result: CalibrationResult) => {
		setCalibration(result);
		setShowCalibration(false);
		setShowGazeCursor(true);
		// Clear old history — pre-calibration data is invalid
		clearHistory();
	};

	return (
		<div className="h-screen flex flex-col">
			<Header
				connectionStatus={connectionStatus}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				fps={currentData?.fps ?? 0}
				clientFps={clientFps}
				calibration={calibration}
				showGazeCursor={showGazeCursor}
				paused={paused}
				onCalibrateClick={() => setShowCalibration(true)}
				onToggleGazeCursor={() => setShowGazeCursor((v) => !v)}
				onTogglePause={() => setPausedAndSync(!paused)}
			/>

			<main className={`flex-1 overflow-hidden ${viewMode === "dashboard" ? "p-3" : ""}`}>
				{viewMode === "dashboard" && (
					<div
						className={`h-full grid gap-3 ${
							expandedPanel ? "grid-cols-1 grid-rows-1" : "grid-cols-2 grid-rows-2"
						}`}
					>
						{(!expandedPanel || expandedPanel === "video") && (
							<VideoFeed
								image={currentImage}
								tracking={currentData}
								isExpanded={expandedPanel === "video"}
								onToggleExpand={() => togglePanel("video")}
							/>
						)}
						{(!expandedPanel || expandedPanel === "eye3d") && (
							<EyeModel3D
								tracking={currentData}
								isExpanded={expandedPanel === "eye3d"}
								onToggleExpand={() => togglePanel("eye3d")}
							/>
						)}
						{(!expandedPanel || expandedPanel === "metrics") && (
							<MetricsPanel
								tracking={currentData}
								history={history}
								isExpanded={expandedPanel === "metrics"}
								onToggleExpand={() => togglePanel("metrics")}
							/>
						)}
						{(!expandedPanel || expandedPanel === "controls") && (
							<ControlPanel
								settings={settings}
								onSettingsChange={updateSettings}
								onClearHistory={clearHistory}
								connectionStatus={connectionStatus}
								isExpanded={expandedPanel === "controls"}
								onToggleExpand={() => togglePanel("controls")}
							/>
						)}
					</div>
				)}
				{viewMode === "heatmap" && (
					<GazeHeatmap
						history={history}
						historyVersion={historyVersion}
						onClear={clearHistory}
						calibration={calibration}
					/>
				)}
				{viewMode === "trail" && (
					<GazeTrail history={history} tracking={currentData} calibration={calibration} />
				)}
			</main>

			{/* Calibration overlay */}
			<CalibrationWizard
				isOpen={showCalibration}
				onComplete={handleCalibrationComplete}
				onClose={() => setShowCalibration(false)}
				currentTracking={currentData}
			/>

			{/* Gaze cursor overlay */}
			<GazeCursor tracking={currentData} calibration={calibration} visible={showGazeCursor} />
		</div>
	);
}
