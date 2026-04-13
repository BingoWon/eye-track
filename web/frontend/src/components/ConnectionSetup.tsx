import { motion } from "framer-motion";
import { Eye, Loader2, Server, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, getBackendUrl, setBackendUrl } from "../lib/backend";

interface ConnectionSetupProps {
	onConnected: () => void;
}

type Phase = "probing" | "manual";

export function ConnectionSetup({ onConnected }: ConnectionSetupProps) {
	const [phase, setPhase] = useState<Phase>("probing");
	const [url, setUrl] = useState(getBackendUrl);
	const [testing, setTesting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const mountedRef = useRef(true);

	const probe = useCallback(
		async (targetUrl?: string) => {
			if (targetUrl) {
				setBackendUrl(targetUrl);
			}
			setTesting(true);
			setError(null);
			try {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 3000);
				const res = await fetch(apiUrl("/api/cameras"), { signal: controller.signal });
				clearTimeout(timeout);
				if (res.ok && mountedRef.current) {
					onConnected();
					return;
				}
				if (mountedRef.current) {
					setError(`Server responded with ${res.status}`);
					setPhase("manual");
				}
			} catch {
				if (mountedRef.current) {
					setPhase("manual");
				}
			} finally {
				if (mountedRef.current) setTesting(false);
			}
		},
		[onConnected],
	);

	// Auto-probe on mount
	useEffect(() => {
		mountedRef.current = true;
		probe();
		return () => {
			mountedRef.current = false;
		};
	}, [probe]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = url.trim().replace(/\/+$/, "");
		if (!trimmed) return;
		setUrl(trimmed);
		probe(trimmed);
	};

	return (
		<div className="h-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
			<motion.div
				initial={{ opacity: 0, y: 20 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4 }}
				className="w-full max-w-md mx-4"
			>
				{/* Logo */}
				<div className="flex flex-col items-center gap-3 mb-8">
					<div className="w-14 h-14 rounded-2xl bg-[var(--color-accent)]/10 flex items-center justify-center border border-[var(--color-accent)]/15">
						<Eye className="w-7 h-7 text-[var(--color-accent)]" />
					</div>
					<div className="text-center">
						<h1 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight">
							EyeTrack
						</h1>
						<p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">Gaze Tracker</p>
					</div>
				</div>

				{/* Card */}
				<div className="glass rounded-2xl border border-[var(--color-border)]/60 p-6">
					{phase === "probing" ? (
						<div className="flex flex-col items-center gap-4 py-4">
							<Loader2 className="w-6 h-6 text-[var(--color-accent)] animate-spin" />
							<p className="text-[13px] text-[var(--color-text-secondary)]">
								Connecting to backend...
							</p>
						</div>
					) : (
						<>
							<div className="flex items-center gap-2.5 mb-5">
								<div className="w-8 h-8 rounded-lg bg-[var(--color-warning)]/10 flex items-center justify-center">
									<WifiOff className="w-4 h-4 text-[var(--color-warning)]" />
								</div>
								<div>
									<h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
										Backend not reachable
									</h2>
									<p className="text-[11px] text-[var(--color-text-secondary)]">
										Make sure the Python backend is running
									</p>
								</div>
							</div>

							<form onSubmit={handleSubmit} className="flex flex-col gap-3">
								<label className="flex flex-col gap-1.5">
									<span className="text-[11px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
										Backend URL
									</span>
									<div className="flex items-center gap-2">
										<div className="relative flex-1">
											<Server className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
											<input
												type="text"
												value={url}
												onChange={(e) => {
													setUrl(e.target.value);
													setError(null);
												}}
												placeholder="http://localhost:8100"
												className="w-full pl-9 pr-3 py-2.5 rounded-xl text-[13px] font-mono bg-[var(--color-bg-primary)] border border-[var(--color-border)]/60 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]/50 focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all"
												disabled={testing}
											/>
										</div>
										<button
											type="submit"
											disabled={testing || !url.trim()}
											className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[12px] font-semibold bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/15 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
										>
											{testing ? (
												<Loader2 className="w-3.5 h-3.5 animate-spin" />
											) : (
												<Wifi className="w-3.5 h-3.5" />
											)}
											Connect
										</button>
									</div>
								</label>

								{error && <p className="text-[11px] text-[var(--color-danger)] px-1">{error}</p>}

								<div className="mt-2 px-1 flex flex-col gap-1.5">
									<p className="text-[11px] text-[var(--color-text-muted)]">
										Start the backend with:
									</p>
									<code className="text-[11px] font-mono bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] px-3 py-2 rounded-lg border border-[var(--color-border)]/40 select-all">
										python web/server.py
									</code>
								</div>
							</form>
						</>
					)}
				</div>
			</motion.div>
		</div>
	);
}
