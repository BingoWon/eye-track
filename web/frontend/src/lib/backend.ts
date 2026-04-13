const STORAGE_KEY = "eyetrack-backend";
const DEFAULT_URL = "http://localhost:8100";

/** Read the persisted backend base URL (no trailing slash). */
export function getBackendUrl(): string {
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored || DEFAULT_URL;
}

/** Persist a new backend base URL. */
export function setBackendUrl(url: string): void {
	const normalized = url.replace(/\/+$/, "") || DEFAULT_URL;
	localStorage.setItem(STORAGE_KEY, normalized);
}

/** Build a full HTTP URL for an API path (e.g. "/api/trackers"). */
export function apiUrl(path: string): string {
	// In dev mode (Vite proxy active), use relative paths
	if (isDevProxy()) return path;
	return `${getBackendUrl()}${path}`;
}

/** Build the WebSocket URL for the /ws endpoint. */
export function wsUrl(): string {
	if (isDevProxy()) {
		return `ws://${window.location.hostname}:${window.location.port || "5173"}/ws`;
	}
	const base = getBackendUrl();
	const protocol = base.startsWith("https") ? "wss" : "ws";
	const host = base.replace(/^https?:\/\//, "");
	return `${protocol}://${host}/ws`;
}

/** Returns true when running via Vite dev server (proxy handles /api and /ws). */
function isDevProxy(): boolean {
	const port = window.location.port;
	return port === "5173" || port === "5174";
}
