import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus, FrameMessage, TrackerFrame } from "../types/tracking";

interface UseWebSocketOptions {
	url: string;
	onFrame?: (trackers: TrackerFrame[], tSend?: number) => void;
	onStatus?: (status: Record<string, unknown>) => void;
}

const MIN_BACKOFF = 1000;
const MAX_BACKOFF = 10000;

export function useWebSocket({ url, onFrame, onStatus }: UseWebSocketOptions) {
	const wsRef = useRef<WebSocket | null>(null);
	const [status, setStatus] = useState<ConnectionStatus>("disconnected");
	const reconnectTimeoutRef = useRef<number>(0);
	const backoffRef = useRef(MIN_BACKOFF);
	const onFrameRef = useRef(onFrame);
	const onStatusRef = useRef(onStatus);

	onFrameRef.current = onFrame;
	onStatusRef.current = onStatus;

	const connect = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) return;

		setStatus("connecting");

		let ws: WebSocket;
		try {
			ws = new WebSocket(url);
		} catch {
			setStatus("error");
			return;
		}

		ws.onopen = () => {
			setStatus("connected");
			backoffRef.current = MIN_BACKOFF;
		};

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === "frame") {
					const frameMsg = msg as FrameMessage;
					onFrameRef.current?.(frameMsg.trackers, frameMsg.tSend);
				} else if (msg.type === "status") {
					onStatusRef.current?.(msg);
				}
			} catch {
				// Malformed message — ignore
			}
		};

		ws.onclose = () => {
			setStatus("disconnected");
			reconnectTimeoutRef.current = window.setTimeout(connect, backoffRef.current);
			backoffRef.current = Math.min(backoffRef.current * 1.5, MAX_BACKOFF);
		};

		ws.onerror = () => {
			setStatus("error");
		};

		wsRef.current = ws;
	}, [url]);

	const disconnect = useCallback(() => {
		clearTimeout(reconnectTimeoutRef.current);
		wsRef.current?.close();
		wsRef.current = null;
		setStatus("disconnected");
	}, []);

	const send = useCallback((data: Record<string, unknown>) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(data));
		}
	}, []);

	useEffect(() => {
		backoffRef.current = MIN_BACKOFF;
		connect();
		return () => disconnect();
	}, [connect, disconnect]);

	return { status, send };
}
