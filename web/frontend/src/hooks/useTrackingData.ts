import { useCallback, useRef, useState } from "react";
import type { TrackerFrame, TrackingData, TrackingHistory } from "../types/tracking";

const MAX_HISTORY = 500;

export interface TrackerState {
	image: string;
	tracking: TrackingData;
}

export function useTrackingData() {
	const [trackers, setTrackers] = useState<Map<string, TrackerState>>(new Map());
	const historyRef = useRef<TrackingHistory>({
		timestamps: [],
		gazePoints: [],
		gazeDirections: [],
		pupilSizes: [],
	});
	const [historyVersion, setHistoryVersion] = useState(0);
	const fpsRef = useRef({ count: 0, lastTime: Date.now(), value: 0 });

	const handleFrame = useCallback((frames: TrackerFrame[]) => {
		setTrackers((prev) => {
			const next = new Map(prev);
			for (const frame of frames) {
				next.set(frame.id, {
					image: frame.image,
					tracking: frame.tracking,
				});
			}
			return next;
		});

		// Calculate client-side FPS
		fpsRef.current.count++;
		const now = Date.now();
		if (now - fpsRef.current.lastTime >= 1000) {
			fpsRef.current.value = fpsRef.current.count;
			fpsRef.current.count = 0;
			fpsRef.current.lastTime = now;
		}

		// Update history — aggregate pupil data from ALL trackers
		const h = historyRef.current;
		for (const frame of frames) {
			const tracking = frame.tracking;
			h.timestamps.push(tracking.timestamp);

			if (tracking.pupil) {
				h.gazePoints.push(tracking.pupil.center);
				h.pupilSizes.push(Math.max(...tracking.pupil.axes));
			}
			if (tracking.gaze) {
				h.gazeDirections.push(tracking.gaze.direction);
			}
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
		trackers,
		history: historyRef.current,
		historyVersion,
		clientFps: fpsRef.current.value,
		handleFrame,
		clearHistory,
	};
}
