import { useCallback, useRef, useState } from "react";

export interface LatencyStats {
	/** Backend processing time in ms (capture → encode → ready to send) */
	processing: number;
	/** Network jitter in ms (extra delay introduced by transport) */
	network: number;
	/** Actual frame interval in ms as seen by the browser */
	frameInterval: number;
}

const EWMA_ALPHA = 0.15;

function ewma(prev: number, next: number): number {
	return prev === 0 ? next : prev * (1 - EWMA_ALPHA) + next * EWMA_ALPHA;
}

export function useLatency() {
	const [stats, setStats] = useState<LatencyStats>({
		processing: 0,
		network: 0,
		frameInterval: 0,
	});

	const prevRef = useRef({
		tReceive: 0,
		tSend: 0,
		processing: 0,
		network: 0,
		frameInterval: 0,
	});

	const recordFrame = useCallback(
		(tProcessingMs: number | undefined, tSend: number | undefined) => {
			const now = performance.now();
			const prev = prevRef.current;

			// Processing — EWMA of backend-reported per-frame processing time
			let processing = prev.processing;
			if (tProcessingMs != null && tProcessingMs > 0) {
				processing = ewma(prev.processing, tProcessingMs);
			}

			// Frame interval — time between consecutive browser receives
			let frameInterval = prev.frameInterval;
			if (prev.tReceive > 0) {
				const interval = now - prev.tReceive;
				if (interval > 0 && interval < 1000) {
					frameInterval = ewma(prev.frameInterval, interval);
				}
			}

			// Network jitter — compare backend send intervals vs browser receive intervals
			let network = prev.network;
			if (tSend != null && prev.tSend > 0 && prev.tReceive > 0) {
				const backendInterval = (tSend - prev.tSend) * 1000; // seconds → ms
				const browserInterval = now - prev.tReceive;
				if (backendInterval > 0 && browserInterval > 0 && backendInterval < 1000) {
					const jitter = Math.max(0, browserInterval - backendInterval);
					network = ewma(prev.network, jitter);
				}
			}

			prev.tReceive = now;
			prev.tSend = tSend ?? prev.tSend;
			prev.processing = processing;
			prev.network = network;
			prev.frameInterval = frameInterval;

			setStats({ processing, network, frameInterval });
		},
		[],
	);

	return { latency: stats, recordFrame };
}
