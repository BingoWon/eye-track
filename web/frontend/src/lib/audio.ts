let ctx: AudioContext | null = null;

function getContext(): AudioContext {
	if (!ctx || ctx.state === "closed") {
		ctx = new AudioContext();
	}
	return ctx;
}

export function playTone(frequency: number, duration: number, volume = 0.15) {
	const ac = getContext();
	const osc = ac.createOscillator();
	const gain = ac.createGain();
	osc.connect(gain);
	gain.connect(ac.destination);
	osc.frequency.value = frequency;
	gain.gain.value = volume;
	osc.start();
	gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
	osc.stop(ac.currentTime + duration);
}

export function playSuccess() {
	playTone(880, 0.15);
	setTimeout(() => playTone(1100, 0.2), 150);
}
export function playError() {
	playTone(300, 0.25, 0.1);
}
export function playTick() {
	playTone(600, 0.05, 0.08);
}
export function playComplete() {
	playTone(660, 0.1);
	setTimeout(() => playTone(880, 0.1), 100);
	setTimeout(() => playTone(1100, 0.2), 200);
}
export function playCountdownTick(secondsRemaining: number) {
	const freq = 400 + (5 - secondsRemaining) * 80;
	playTone(freq, 0.08, 0.06);
}
