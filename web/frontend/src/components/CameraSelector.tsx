import { AnimatePresence, motion } from "framer-motion";
import { Camera, ChevronRight, Loader2, RefreshCw, Wifi } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface CameraSelectorProps {
	onSelect: (cameraIndex: number) => void;
}

interface CameraInfo {
	index: number;
	previewUrl: string;
	loading: boolean;
	error: boolean;
}

export function CameraSelector({ onSelect }: CameraSelectorProps) {
	const [cameras, setCameras] = useState<CameraInfo[]>([]);
	const [detecting, setDetecting] = useState(true);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [connecting, setConnecting] = useState(false);

	const detectCameras = useCallback(async () => {
		setDetecting(true);
		setCameras([]);
		try {
			const res = await fetch("/api/cameras");
			const data = await res.json();
			const cams: CameraInfo[] = (data.cameras as number[]).map((index) => ({
				index,
				previewUrl: "",
				loading: true,
				error: false,
			}));
			setCameras(cams);

			// Load previews sequentially to avoid opening multiple cameras at once
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
			// Server not reachable
		} finally {
			setDetecting(false);
		}
	}, []);

	useEffect(() => {
		detectCameras();
	}, [detectCameras]);

	const handleConfirm = async () => {
		if (selectedIndex === null) return;
		setConnecting(true);
		try {
			const res = await fetch(`/api/camera/${selectedIndex}`, { method: "POST" });
			if (res.ok) {
				onSelect(selectedIndex);
			}
		} catch {
			// error
		} finally {
			setConnecting(false);
		}
	};

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
							Select Camera
						</h1>
						<p className="text-[13px] text-[var(--color-text-muted)]">
							Choose your eye tracking camera to begin
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
								<Wifi className="w-8 h-8 text-[var(--color-text-muted)]" />
								<p className="text-[14px] text-[var(--color-text-secondary)]">
									No cameras detected
								</p>
								<p className="text-[12px] text-[var(--color-text-muted)]">
									Connect a camera and click Refresh
								</p>
							</motion.div>
						)}
						{cameras.map((cam, i) => (
							<motion.button
								type="button"
								key={cam.index}
								initial={{ opacity: 0, y: 10 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: -10 }}
								transition={{ delay: i * 0.08 }}
								onClick={() => setSelectedIndex(cam.index)}
								className={`group relative rounded-2xl border overflow-hidden cursor-pointer transition-all duration-300 text-left ${
									selectedIndex === cam.index
										? "border-[var(--color-accent)]/50 shadow-[0_0_20px_rgba(34,211,238,0.1)]"
										: "border-[var(--color-border)]/60 hover:border-[var(--color-border-active)]"
								}`}
							>
								{/* Selection indicator */}
								{selectedIndex === cam.index && (
									<motion.div
										layoutId="camera-selection"
										className="absolute inset-0 bg-[var(--color-accent)]/4 z-0"
										transition={{ type: "spring", stiffness: 400, damping: 30 }}
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
									{selectedIndex === cam.index && (
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
											Camera {cam.index}
										</p>
										<p className="text-[11px] text-[var(--color-text-muted)]">640 x 480</p>
									</div>
									<ChevronRight
										className={`w-4 h-4 transition-all duration-200 ${
											selectedIndex === cam.index
												? "text-[var(--color-accent)] translate-x-0"
												: "text-[var(--color-text-muted)] -translate-x-1 opacity-0 group-hover:opacity-100 group-hover:translate-x-0"
										}`}
									/>
								</div>
							</motion.button>
						))}
					</AnimatePresence>
				</div>

				{/* Confirm button */}
				<motion.button
					type="button"
					onClick={handleConfirm}
					disabled={selectedIndex === null || connecting}
					initial={{ opacity: 0 }}
					animate={{ opacity: selectedIndex !== null ? 1 : 0.4 }}
					className={`flex items-center gap-2 px-8 py-2.5 rounded-full text-[14px] font-medium transition-all duration-300 cursor-pointer ${
						selectedIndex !== null
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
							Start Tracking
							<ChevronRight className="w-4 h-4" />
						</>
					)}
				</motion.button>
			</motion.div>
		</div>
	);
}
