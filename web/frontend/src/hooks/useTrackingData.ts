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
		pupilSizes: [],
	});
	const [historyVersion, setHistoryVersion] = useState(0);

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

		// Per-frame pupil sizes (average across all trackers with valid pupils)
		const h = historyRef.current;
		let totalSize = 0;
		let sizeCount = 0;
		for (const frame of frames) {
			if (frame.tracking.pupil) {
				totalSize += Math.max(...frame.tracking.pupil.axes);
				sizeCount++;
			}
		}
		if (sizeCount > 0) {
			h.pupilSizes.push(totalSize / sizeCount);
			h.timestamps.push(frames[0].tracking.timestamp);
		}

		// Trim
		if (h.timestamps.length > MAX_HISTORY) {
			h.timestamps = h.timestamps.slice(-MAX_HISTORY);
			h.gazePoints = h.gazePoints.slice(-MAX_HISTORY);
			h.pupilSizes = h.pupilSizes.slice(-MAX_HISTORY);
		}

		setHistoryVersion((v) => v + 1);
	}, []);

	/** Push a fused gaze point (screen-space 0-1) into history.
	 *  Called from App after computing the weighted average. */
	const pushGazePoint = useCallback((point: [number, number]) => {
		historyRef.current.gazePoints.push(point);
	}, []);

	const clearHistory = useCallback(() => {
		historyRef.current = {
			timestamps: [],
			gazePoints: [],
			pupilSizes: [],
		};
	}, []);

	return {
		trackers,
		history: historyRef.current,
		historyVersion,
		handleFrame,
		pushGazePoint,
		clearHistory,
	};
}
