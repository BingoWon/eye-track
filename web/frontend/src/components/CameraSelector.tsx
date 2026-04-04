import { AnimatePresence, motion } from "framer-motion";
import { Camera, ChevronRight, Loader2, RefreshCw, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface CameraSelectorProps {
	onSelect: (trackerIds: string[]) => void;
}

interface CameraInfo {
	index: number;
	name: string;
	previewUrl: string;
	loading: boolean;
	error: boolean;
}

export function CameraSelector({ onSelect }: CameraSelectorProps) {
	const [cameras, setCameras] = useState<CameraInfo[]>([]);
	const [detecting, setDetecting] = useState(true);
	const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
	const [connecting, setConnecting] = useState(false);
	const [serverReachable, setServerReachable] = useState(true);
	const retryTimerRef = useRef<number>(0);

	const detectCameras = useCallback(async () => {
		setDetecting(true);
		// Revoke old preview blob URLs to prevent memory leaks
		setCameras((prev) => {
			for (const c of prev) {
				if (c.previewUrl) URL.revokeObjectURL(c.previewUrl);
			}
			return [];
		});
		try {
			const res = await fetch("/api/cameras");
			const data = await res.json();
			setServerReachable(true);
			const cams: CameraInfo[] = (data.cameras as { index: number; name: string }[]).map((cam) => ({
				index: cam.index,
				name: cam.name,
				previewUrl: "",
				loading: true,
				error: false,
			}));
			setCameras(cams);

			if (cams.length === 0) {
				// No cameras found — schedule auto-retry in 3 seconds
				clearTimeout(retryTimerRef.current);
				retryTimerRef.current = window.setTimeout(() => {
					detectCameras();
				}, 3000);
				setDetecting(false);
				return;
			}

			// Load previews sequentially to avoid opening multiple cameras
			for (const cam of cams) {
				try {
					const previewRes = await fetch(`/api/cameras/${cam.index}/preview`);
					if (previewRes.ok) {
						const blob = await previewRes.blob();
						const url = URL.createObjectURL(blob);
						setCameras((prev) =>
							prev.map((c) =>
								c.index === cam.index ? { ...c, previewUrl: url, loading: false } : c,
							),
						);
					} else {
						setCameras((prev) =>
							prev.map((c) => (c.index === cam.index ? { ...c, loading: false, error: true } : c)),
						);
					}
				} catch {
					setCameras((prev) =>
						prev.map((c) => (c.index === cam.index ? { ...c, loading: false, error: true } : c)),
					);
				}
			}
		} catch {
			setServerReachable(false);
			// Server not reachable — retry in 3 seconds
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = window.setTimeout(() => {
				detectCameras();
			}, 3000);
		} finally {
			setDetecting(false);
		}
	}, []);

	useEffect(() => {
		detectCameras();
		return () => clearTimeout(retryTimerRef.current);
	}, [detectCameras]);

	// Cleanup blob URLs on unmount to prevent memory leaks
	useEffect(() => {
		return () => {
			setCameras((prev) => {
				for (const c of prev) {
					if (c.previewUrl) URL.revokeObjectURL(c.previewUrl);
				}
				return prev;
			});
		};
	}, []);

	const toggleCamera = (index: number) => {
		setSelectedIndices((prev) => {
			const next = new Set(prev);
			if (next.has(index)) {
				next.delete(index);
			} else {
				next.add(index);
			}
			return next;
		});
	};

	const handleConfirm = async () => {
		if (selectedIndices.size === 0) return;
		setConnecting(true);
		try {
			const trackerIds: string[] = [];
			for (const idx of selectedIndices) {
				const res = await fetch("/api/trackers", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ cameraIndex: idx }),
				});
				if (res.ok) {
					const data = await res.json();
					trackerIds.push(data.id ?? `tracker-${idx}`);
				}
			}
			if (trackerIds.length > 0) {
				onSelect(trackerIds);
			}
		} catch {
			// error
		} finally {
			setConnecting(false);
		}
	};

	const selectedCount = selectedIndices.size;
	const buttonLabel =
		selectedCount === 1 ? "Start Tracking" : `Start with ${selectedCount} Trackers`;

	return (
		<div className="h-screen flex flex-col items-center justify-center bg-[var(--color-bg-primary)] relative overflow-hidden">
			{/* Background glow */}
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
				{/* Header */}
				<div className="flex items-center gap-3 mb-2">
					<div className="w-10 h-10 rounded-xl bg-[var(--color-accent)]/8 flex items-center justify-center border border-[var(--color-accent)]/15">
						<Camera className="w-5 h-5 text-[var(--color-accent)]" />
					</div>
					<div>
						<h1 className="text-2xl font-semibold text-[var(--color-text-primary)] tracking-tight">
							Select Cameras
						</h1>
						<p className="text-[13px] text-[var(--color-text-muted)]">
							Choose one or more eye tracking cameras
						</p>
					</div>
				</div>

				{/* Refresh button */}
				<button
					type="button"
					onClick={detectCameras}
					disabled={detecting}
					className="self-end mb-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)] transition-all cursor-pointer border border-transparent hover:border-[var(--color-border)]/50"
				>
					<RefreshCw className={`w-3.5 h-3.5 ${detecting ? "animate-spin" : ""}`} />
					Refresh
				</button>

				{/* Camera grid */}
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
							const isSelected = selectedIndices.has(cam.index);
							return (
								<motion.button
									type="button"
									key={cam.index}
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -10 }}
									transition={{ delay: i * 0.08 }}
									onClick={() => toggleCamera(cam.index)}
									className={`group relative rounded-2xl border overflow-hidden cursor-pointer transition-all duration-300 text-left ${
										isSelected
											? "border-[var(--color-accent)]/50 shadow-[0_0_20px_rgba(34,211,238,0.1)]"
											: "border-[var(--color-border)]/60 hover:border-[var(--color-border-active)]"
									}`}
								>
									{/* Selection indicator */}
									{isSelected && (
										<motion.div
											className="absolute inset-0 bg-[var(--color-accent)]/4 z-0"
											transition={{
												type: "spring",
												stiffness: 400,
												damping: 30,
											}}
										/>
									)}

									{/* Preview */}
									<div className="relative aspect-[4/3] bg-[var(--color-bg-card)] overflow-hidden">
										{cam.loading && (
											<div className="absolute inset-0 flex items-center justify-center">
												<Loader2 className="w-6 h-6 text-[var(--color-text-muted)] animate-spin" />
											</div>
										)}
										{cam.error && (
											<div className="absolute inset-0 flex items-center justify-center">
												<Camera className="w-6 h-6 text-[var(--color-text-muted)]" />
											</div>
										)}
										{cam.previewUrl && (
											<img
												src={cam.previewUrl}
												alt={`Camera ${cam.index}`}
												className="w-full h-full object-cover"
											/>
										)}
										{/* Selected check */}
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
												>
													<path
														d="M2 6L5 9L10 3"
														stroke="white"
														strokeWidth="2"
														strokeLinecap="round"
														strokeLinejoin="round"
													/>
												</svg>
											</motion.div>
										)}
									</div>

									{/* Label */}
									<div className="relative z-10 px-3.5 py-2.5 flex items-center justify-between bg-[var(--color-bg-card)]">
										<div>
											<p className="text-[13px] font-medium text-[var(--color-text-primary)]">
												{cam.name}
											</p>
											<p className="text-[11px] text-[var(--color-text-muted)]">640 x 480</p>
										</div>
										<ChevronRight
											className={`w-4 h-4 transition-all duration-200 ${
												isSelected
													? "text-[var(--color-accent)] translate-x-0"
													: "text-[var(--color-text-muted)] -translate-x-1 opacity-0 group-hover:opacity-100 group-hover:translate-x-0"
											}`}
										/>
									</div>
								</motion.button>
							);
						})}
					</AnimatePresence>
				</div>

				{/* Confirm button */}
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
