import { AnimatePresence, motion } from "framer-motion";
import { Camera, ChevronRight, FlipVertical2, Loader2, RefreshCw, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SOURCE_H, SOURCE_W } from "../types/tracking";
import type { EyeSide } from "../types/tracking";

export interface TrackerSelection {
	id: string;
	eye: EyeSide;
}

interface CameraSelectorProps {
	onSelect: (selections: TrackerSelection[]) => void;
}

interface CameraInfo {
	index: number;
	name: string;
	uniqueId: string;
}

interface SelectedCamera {
	index: number;
	eye: EyeSide;
}

const MAX_CAMERAS = 2;
const PREVIEW_INTERVAL_MS = 200;

export function CameraSelector({ onSelect }: CameraSelectorProps) {
	const [cameras, setCameras] = useState<CameraInfo[]>([]);
	const [previews, setPreviews] = useState<Map<number, string>>(new Map());
	const [loadingPreviews, setLoadingPreviews] = useState<Set<number>>(new Set());
	const [failedPreviews, setFailedPreviews] = useState<Map<number, number>>(new Map());
	const [detecting, setDetecting] = useState(true);
	const [selected, setSelected] = useState<SelectedCamera[]>([]);
	const [rotations, setRotations] = useState<Map<number, number>>(new Map());
	const [connecting, setConnecting] = useState(false);
	const [serverReachable, setServerReachable] = useState(true);
	const [tabVisible, setTabVisible] = useState(!document.hidden);
	const retryTimerRef = useRef<number>(0);
	const rotationsRef = useRef(rotations);
	rotationsRef.current = rotations;

	// Pause preview when tab is hidden
	useEffect(() => {
		const handler = () => setTabVisible(!document.hidden);
		document.addEventListener("visibilitychange", handler);
		return () => document.removeEventListener("visibilitychange", handler);
	}, []);

	// --- Data fetching ---

	const detectCameras = useCallback(async () => {
		setDetecting(true);
		setPreviews((prev) => {
			for (const url of prev.values()) URL.revokeObjectURL(url);
			return new Map();
		});
		setLoadingPreviews(new Set());
		setFailedPreviews(new Map());
		setCameras([]);
		await fetch("/api/cameras/enter-selection", { method: "POST" }).catch(() => {});
		await fetch("/api/cameras/preview", { method: "DELETE" }).catch(() => {});
		try {
			const res = await fetch("/api/cameras");
			const data = await res.json();
			setServerReachable(true);
			const cams: CameraInfo[] = (
				data.cameras as { index: number; name: string; uniqueId: string }[]
			).map((cam) => ({ index: cam.index, name: cam.name, uniqueId: cam.uniqueId }));
			setCameras(cams);
			if (cams.length > 0) {
				setLoadingPreviews(new Set(cams.map((c) => c.index)));
			} else {
				clearTimeout(retryTimerRef.current);
				retryTimerRef.current = window.setTimeout(() => detectCameras(), 3000);
			}
		} catch {
			setServerReachable(false);
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = window.setTimeout(() => detectCameras(), 3000);
		} finally {
			setDetecting(false);
		}
	}, []);

	useEffect(() => {
		detectCameras();
		return () => clearTimeout(retryTimerRef.current);
	}, [detectCameras]);

	// --- Preview polling — stops when tab is hidden, aborts in-flight fetches on cleanup ---
	// biome-ignore lint/correctness/useExhaustiveDependencies: cameras.length is intentional
	useEffect(() => {
		if (detecting || cameras.length === 0 || !tabVisible) return;
		const indices = cameras.map((c) => c.index);
		const retries = new Map<number, number>();
		const MAX_RETRIES = 10;
		const abortController = new AbortController();

		const fetchFrame = async (idx: number) => {
			if (abortController.signal.aborted) return;
			const failures = retries.get(idx) ?? 0;
			if (failures >= MAX_RETRIES) return;
			const rot = rotationsRef.current.get(idx) ?? 0;
			try {
				const res = await fetch(`/api/cameras/${idx}/preview?rotation=${rot}`, {
					signal: abortController.signal,
				});
				if (abortController.signal.aborted) return;
				if (res.ok) {
					retries.set(idx, 0);
					const blob = await res.blob();
					const url = URL.createObjectURL(blob);
					setPreviews((prev) => {
						const old = prev.get(idx);
						if (old) URL.revokeObjectURL(old);
						return new Map(prev).set(idx, url);
					});
					setLoadingPreviews((prev) => {
						if (!prev.has(idx)) return prev;
						const next = new Set(prev);
						next.delete(idx);
						return next;
					});
				} else {
					retries.set(idx, failures + 1);
					if (failures + 1 >= MAX_RETRIES) {
						setFailedPreviews((prev) => new Map(prev).set(idx, MAX_RETRIES));
						setLoadingPreviews((prev) => {
							const next = new Set(prev);
							next.delete(idx);
							return next;
						});
					}
				}
			} catch {
				/* aborted or transient network error */
			}
		};

		const poll = async () => {
			while (!abortController.signal.aborted) {
				for (const idx of indices) {
					if (abortController.signal.aborted) break;
					await fetchFrame(idx);
				}
				if (!abortController.signal.aborted) {
					await new Promise((r) => setTimeout(r, PREVIEW_INTERVAL_MS));
				}
			}
		};
		poll();

		return () => {
			abortController.abort();
			fetch("/api/cameras/preview", { method: "DELETE" }).catch(() => {});
		};
	}, [detecting, cameras.length, tabVisible]);

	useEffect(() => {
		return () => {
			setPreviews((prev) => {
				for (const url of prev.values()) URL.revokeObjectURL(url);
				return prev;
			});
		};
	}, []);

	// --- Selection logic ---

	const getSelection = (index: number) => selected.find((s) => s.index === index);

	const toggleSelect = (index: number) => {
		setSelected((prev) => {
			const exists = prev.find((s) => s.index === index);
			if (exists) {
				return prev.filter((s) => s.index !== index);
			}
			if (prev.length >= MAX_CAMERAS) return prev;
			// Auto-assign: if other eye is taken, pick the remaining one
			const usedEyes = new Set(prev.map((s) => s.eye));
			const eye: EyeSide = usedEyes.has("right") ? "left" : "right";
			return [...prev, { index, eye }];
		});
	};

	const setEye = (e: React.MouseEvent, index: number, eye: EyeSide) => {
		e.stopPropagation();
		setSelected((prev) => {
			// If another camera already has this eye, swap
			const other = prev.find((s) => s.eye === eye && s.index !== index);
			const current = prev.find((s) => s.index === index);
			if (!current) return prev;
			if (other) {
				return prev.map((s) => {
					if (s.index === index) return { ...s, eye };
					if (s.index === other.index) return { ...s, eye: current.eye };
					return s;
				});
			}
			return prev.map((s) => (s.index === index ? { ...s, eye } : s));
		});
	};

	const rotateCamera = (e: React.MouseEvent, index: number) => {
		e.stopPropagation();
		setRotations((prev) => {
			const next = new Map(prev);
			next.set(index, (next.get(index) ?? 0) === 0 ? 180 : 0);
			return next;
		});
	};

	// --- Confirm ---

	const handleConfirm = async () => {
		if (selected.length === 0) return;
		setConnecting(true);
		try {
			// Release all preview cameras and wait for OS to fully release handles
			await fetch("/api/cameras/preview", { method: "DELETE" });
			await new Promise((r) => setTimeout(r, 500));
			const selections: TrackerSelection[] = [];
			for (const sel of selected) {
				const cam = cameras.find((c) => c.index === sel.index);
				const rotation = rotations.get(sel.index) ?? 0;
				const res = await fetch("/api/trackers", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						cameraIndex: sel.index,
						rotation,
						uniqueId: cam?.uniqueId,
						eye: sel.eye,
					}),
				});
				if (res.ok) {
					const data = await res.json();
					selections.push({
						id: data.id ?? `camera-${sel.index}`,
						eye: sel.eye,
					});
				}
			}
			if (selections.length > 0) {
				await fetch("/api/pause", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ paused: false }),
				}).catch(() => {});
				onSelect(selections);
			}
		} catch {
			/* error */
		} finally {
			setConnecting(false);
		}
	};

	const selectedCount = selected.length;
	const buttonLabel =
		selectedCount === 0
			? "Select a Camera"
			: selectedCount === 1
				? "Start Tracking"
				: "Start with 2 Cameras";

	// --- Render ---

	return (
		<div className="h-screen flex flex-col items-center justify-center bg-[var(--color-bg-primary)] relative overflow-hidden">
			<div
				className="absolute inset-0 pointer-events-none"
				style={{
					background:
						"radial-gradient(ellipse 60% 40% at 50% 45%, rgba(34,211,238,0.04) 0%, transparent 70%)",
				}}
			/>

			<motion.div
				initial={{ opacity: 0, y: 20 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5 }}
				className="relative z-10 flex flex-col items-center max-w-3xl w-full px-6"
			>
				<div className="flex items-center gap-3 mb-2">
					<div className="w-10 h-10 rounded-xl bg-[var(--color-accent)]/8 flex items-center justify-center border border-[var(--color-accent)]/15">
						<Camera className="w-5 h-5 text-[var(--color-accent)]" />
					</div>
					<div>
						<h1 className="text-2xl font-semibold text-[var(--color-text-primary)] tracking-tight">
							Select Cameras
						</h1>
						<p className="text-[13px] text-[var(--color-text-muted)]">
							Choose up to 2 cameras and assign each to an eye
						</p>
					</div>
				</div>

				<button
					type="button"
					onClick={detectCameras}
					disabled={detecting}
					className="self-end mb-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)] transition-all cursor-pointer border border-transparent hover:border-[var(--color-border)]/50"
				>
					<RefreshCw className={`w-3.5 h-3.5 ${detecting ? "animate-spin" : ""}`} />
					Refresh
				</button>

				<div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
					<AnimatePresence mode="popLayout">
						{detecting && cameras.length === 0 && (
							<motion.div
								key="detecting"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								className="col-span-full flex flex-col items-center py-16 gap-3"
							>
								<Loader2 className="w-8 h-8 text-[var(--color-accent)] animate-spin" />
								<p className="text-[13px] text-[var(--color-text-muted)]">Detecting cameras...</p>
							</motion.div>
						)}
						{!detecting && cameras.length === 0 && (
							<motion.div
								key="empty"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								className="col-span-full flex flex-col items-center py-16 gap-3"
							>
								{serverReachable ? (
									<Camera className="w-8 h-8 text-[var(--color-text-muted)]" />
								) : (
									<Wifi className="w-8 h-8 text-[var(--color-danger)]" />
								)}
								<p className="text-[14px] text-[var(--color-text-secondary)]">
									{serverReachable ? "No cameras detected" : "Server not reachable"}
								</p>
								<p className="text-[12px] text-[var(--color-text-muted)]">
									{serverReachable
										? "Connect a camera — auto-retrying..."
										: "Start the backend server first"}
								</p>
								<Loader2 className="w-4 h-4 text-[var(--color-text-muted)] animate-spin mt-1" />
							</motion.div>
						)}
						{cameras.map((cam, i) => {
							const sel = getSelection(cam.index);
							const isSelected = !!sel;
							const rotation = rotations.get(cam.index) ?? 0;
							const isMaxed = selected.length >= MAX_CAMERAS && !isSelected;
							const previewUrl = previews.get(cam.index);
							const isLoading = loadingPreviews.has(cam.index);
							const isFailed = failedPreviews.has(cam.index);
							return (
								<motion.div
									key={cam.index}
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: isMaxed ? 0.4 : 1, y: 0 }}
									exit={{ opacity: 0, y: -10 }}
									transition={{ delay: i * 0.08 }}
									className={`group relative rounded-2xl border overflow-hidden transition-all duration-300 ${
										isSelected
											? "border-[var(--color-accent)]/50 shadow-[0_0_20px_rgba(34,211,238,0.1)]"
											: "border-[var(--color-border)]/60 hover:border-[var(--color-border-active)]"
									}`}
								>
									{isSelected && (
										<motion.div
											className="absolute inset-0 bg-[var(--color-accent)]/4 z-0"
											layoutId={`sel-bg-${cam.index}`}
										/>
									)}

									{/* Clickable preview area */}
									<button
										type="button"
										onClick={() => !isMaxed && toggleSelect(cam.index)}
										className={`relative w-full aspect-[4/3] bg-[var(--color-bg-card)] overflow-hidden ${isMaxed ? "cursor-not-allowed" : "cursor-pointer"}`}
									>
										{isLoading && (
											<div className="absolute inset-0 flex items-center justify-center">
												<Loader2 className="w-6 h-6 text-[var(--color-text-muted)] animate-spin" />
											</div>
										)}
										{isFailed && (
											<div className="absolute inset-0 flex items-center justify-center">
												<Camera className="w-6 h-6 text-[var(--color-text-muted)]" />
											</div>
										)}
										{previewUrl && (
											<img
												src={previewUrl}
												alt={cam.name}
												className="w-full h-full object-cover"
												draggable={false}
											/>
										)}
										{/* Selection checkmark */}
										{isSelected && (
											<motion.div
												initial={{ scale: 0 }}
												animate={{ scale: 1 }}
												className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-[var(--color-accent)] flex items-center justify-center"
											>
												<svg
													width="12"
													height="12"
													viewBox="0 0 12 12"
													fill="none"
													aria-hidden="true"
													role="img"
												>
													<title>Selected</title>
													<path
														d="M2 6L5 9L10 3"
														stroke="#06080f"
														strokeWidth="2"
														strokeLinecap="round"
														strokeLinejoin="round"
													/>
												</svg>
											</motion.div>
										)}
										{/* Flip button */}
										{!isLoading && !isFailed && (
											<button
												type="button"
												onClick={(e) => rotateCamera(e, cam.index)}
												className={`absolute bottom-2 left-2 w-7 h-7 rounded-lg backdrop-blur-sm flex items-center justify-center transition-all duration-200 cursor-pointer border ${
													rotation === 180
														? "bg-[var(--color-accent)]/20 border-[var(--color-accent)]/40"
														: "bg-black/50 hover:bg-black/70 border-white/10"
												}`}
												title={rotation === 180 ? "Flipped" : "Flip 180°"}
											>
												<FlipVertical2
													className={`w-3.5 h-3.5 ${rotation === 180 ? "text-[var(--color-accent)]" : "text-white/80"}`}
												/>
											</button>
										)}
									</button>

									{/* Footer: name + eye selector */}
									<div className="relative z-10 px-3.5 py-2.5 bg-[var(--color-bg-card)] flex items-center justify-between gap-2">
										<div className="min-w-0">
											<p className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">
												{cam.name}
											</p>
											<p className="text-[11px] text-[var(--color-text-muted)]">
												{SOURCE_W} × {SOURCE_H}
												{rotation === 180 && (
													<span className="ml-1.5 text-[var(--color-accent)]">Flipped</span>
												)}
											</p>
										</div>

										{/* Eye toggle — only when selected */}
										{isSelected ? (
											<div className="flex rounded-lg border border-[var(--color-border)]/60 overflow-hidden shrink-0">
												{(["left", "right"] as const).map((eye) => (
													<button
														key={eye}
														type="button"
														onClick={(e) => setEye(e, cam.index, eye)}
														className={`px-3 py-1.5 text-[11px] font-semibold transition-all cursor-pointer ${
															sel?.eye === eye
																? "bg-[var(--color-accent)] text-[#06080f]"
																: "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)]"
														}`}
													>
														{eye === "left" ? "Left" : "Right"}
													</button>
												))}
											</div>
										) : (
											<ChevronRight
												className={`w-4 h-4 shrink-0 transition-all duration-200 ${
													isMaxed
														? "text-[var(--color-text-muted)]/20"
														: "text-[var(--color-text-muted)] -translate-x-1 opacity-0 group-hover:opacity-100 group-hover:translate-x-0"
												}`}
											/>
										)}
									</div>
								</motion.div>
							);
						})}
					</AnimatePresence>
				</div>

				{/* Confirm */}
				<motion.button
					type="button"
					onClick={handleConfirm}
					disabled={selectedCount === 0 || connecting}
					initial={{ opacity: 0 }}
					animate={{ opacity: selectedCount > 0 ? 1 : 0.4 }}
					className={`flex items-center gap-2 px-8 py-2.5 rounded-full text-[14px] font-medium transition-all duration-300 cursor-pointer ${
						selectedCount > 0
							? "bg-[var(--color-accent)] text-[#06080f] hover:shadow-[0_0_24px_rgba(34,211,238,0.25)] active:scale-[0.97]"
							: "bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed"
					}`}
				>
					{connecting ? (
						<>
							<Loader2 className="w-4 h-4 animate-spin" />
							Connecting...
						</>
					) : (
						<>
							{buttonLabel}
							<ChevronRight className="w-4 h-4" />
						</>
					)}
				</motion.button>
			</motion.div>
		</div>
	);
}
