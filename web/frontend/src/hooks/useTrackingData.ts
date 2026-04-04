import { useCallback, useRef, useState } from "react";
import type { TrackingData, TrackingHistory } from "../types/tracking";

const MAX_HISTORY = 500;

export function useTrackingData() {
	const [currentData, setCurrentData] = useState<TrackingData | null>(null);
	const [currentImage, setCurrentImage] = useState<string>("");
	const historyRef = useRef<TrackingHistory>({
		timestamps: [],
		gazePoints: [],
		gazeDirections: [],
		pupilSizes: [],
	});
	const [frameCount, setFrameCount] = useState(0);
	const [historyVersion, setHistoryVersion] = useState(0);
	const fpsRef = useRef({ count: 0, lastTime: Date.now(), value: 0 });

	const handleFrame = useCallback((image: string, tracking: TrackingData) => {
		setCurrentImage(image);
		setCurrentData(tracking);
		setFrameCount((c) => c + 1);

		// Calculate client-side FPS
		fpsRef.current.count++;
		const now = Date.now();
		if (now - fpsRef.current.lastTime >= 1000) {
			fpsRef.current.value = fpsRef.current.count;
			fpsRef.current.count = 0;
			fpsRef.current.lastTime = now;
		}

		// Update history
		const h = historyRef.current;
		h.timestamps.push(tracking.timestamp);

		if (tracking.pupil) {
			h.gazePoints.push(tracking.pupil.center);
			h.pupilSizes.push(Math.max(...tracking.pupil.axes));
		}
		if (tracking.gaze) {
			h.gazeDirections.push(tracking.gaze.direction);
		}

		// Trim history
		if (h.timestamps.length > MAX_HISTORY) {
			h.timestamps = h.timestamps.slice(-MAX_HISTORY);
			h.gazePoints = h.gazePoints.slice(-MAX_HISTORY);
			h.gazeDirections = h.gazeDirections.slice(-MAX_HISTORY);
			h.pupilSizes = h.pupilSizes.slice(-MAX_HISTORY);
		}

		// Bump version so consumers re-render
		setHistoryVersion((v) => v + 1);
	}, []);

	const clearHistory = useCallback(() => {
		historyRef.current = {
			timestamps: [],
			gazePoints: [],
			gazeDirections: [],
			pupilSizes: [],
		};
	}, []);

	return {
		currentData,
		currentImage,
		history: historyRef.current,
		historyVersion,
		frameCount,
		clientFps: fpsRef.current.value,
		handleFrame,
		clearHistory,
	};
}
