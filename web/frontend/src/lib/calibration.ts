export interface CalibrationPoint {
	/** Screen coordinates as fraction 0-1 */
	screenX: number;
	screenY: number;
	/** Collected pupil center samples during gaze at this point */
	samples: [number, number][];
}

export interface CalibrationResult {
	/** Polynomial coefficients for X mapping: screen_x = a0 + a1*px + a2*py + a3*px² + a4*py² + a5*px*py */
	coeffsX: number[];
	/** Polynomial coefficients for Y mapping */
	coeffsY: number[];
	/** Calibration accuracy — average error in screen-fraction units */
	accuracy: number;
	/** Timestamp of calibration */
	timestamp: number;
}

/**
 * Check if collected samples are stable enough for calibration.
 * Returns true if std deviation of both x and y coordinates is below threshold
 * and we have at least 5 samples.
 */
export function checkStability(samples: [number, number][], threshold = 8): boolean {
	if (samples.length < 5) return false;

	const xs = samples.map((s) => s[0]);
	const ys = samples.map((s) => s[1]);

	const stdX = stdDev(xs);
	const stdY = stdDev(ys);

	return stdX < threshold && stdY < threshold;
}

function mean(values: number[]): number {
	return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
	const m = mean(values);
	const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

/**
 * Build the feature row for a given pupil position.
 * [1, px, py, px², py², px*py]
 */
function featureRow(px: number, py: number): number[] {
	return [1, px, py, px * px, py * py, px * py];
}

/**
 * Solve a linear system Ax = b using Gaussian elimination with partial pivoting.
 * A is n×n, b is n×1. Returns x. Modifies A and b in place.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
	const n = A.length;

	for (let col = 0; col < n; col++) {
		// Partial pivoting
		let maxRow = col;
		let maxVal = Math.abs(A[col][col]);
		for (let row = col + 1; row < n; row++) {
			if (Math.abs(A[row][col]) > maxVal) {
				maxVal = Math.abs(A[row][col]);
				maxRow = row;
			}
		}
		// Swap rows
		[A[col], A[maxRow]] = [A[maxRow], A[col]];
		[b[col], b[maxRow]] = [b[maxRow], b[col]];

		const pivot = A[col][col];
		if (Math.abs(pivot) < 1e-12) {
			// Singular — return zeros
			return new Array(n).fill(0);
		}

		// Eliminate below
		for (let row = col + 1; row < n; row++) {
			const factor = A[row][col] / pivot;
			for (let j = col; j < n; j++) {
				A[row][j] -= factor * A[col][j];
			}
			b[row] -= factor * b[col];
		}
	}

	// Back substitution
	const x = new Array(n).fill(0);
	for (let row = n - 1; row >= 0; row--) {
		let sum = b[row];
		for (let j = row + 1; j < n; j++) {
			sum -= A[row][j] * x[j];
		}
		x[row] = sum / A[row][row];
	}

	return x;
}

/**
 * Compute calibration mapping from collected calibration points.
 * Uses 2nd-order polynomial regression solved via normal equations.
 */
export function computeCalibration(points: CalibrationPoint[]): CalibrationResult {
	const n = points.length;
	const dim = 6; // number of polynomial terms

	// Build data: average pupil center per point
	const avgPupil: [number, number][] = points.map((p) => {
		const mx = mean(p.samples.map((s) => s[0]));
		const my = mean(p.samples.map((s) => s[1]));
		return [mx, my];
	});

	// Build feature matrix X (n×6)
	const X: number[][] = avgPupil.map(([px, py]) => featureRow(px, py));

	// Screen coordinate vectors
	const screenXs = points.map((p) => p.screenX);
	const screenYs = points.map((p) => p.screenY);

	// Normal equations: (XᵀX) coeffs = Xᵀ y
	// Build XᵀX (6×6)
	const XtX: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
	for (let i = 0; i < dim; i++) {
		for (let j = 0; j < dim; j++) {
			let sum = 0;
			for (let k = 0; k < n; k++) {
				sum += X[k][i] * X[k][j];
			}
			XtX[i][j] = sum;
		}
	}

	// Build Xᵀ * screenX and Xᵀ * screenY
	const XtSx = new Array(dim).fill(0);
	const XtSy = new Array(dim).fill(0);
	for (let i = 0; i < dim; i++) {
		for (let k = 0; k < n; k++) {
			XtSx[i] += X[k][i] * screenXs[k];
			XtSy[i] += X[k][i] * screenYs[k];
		}
	}

	// Solve for coefficients (need two separate solves — clone XtX for second)
	const XtX2 = XtX.map((row) => [...row]);
	const XtSx2 = [...XtSx];
	const XtSy2 = [...XtSy];

	const coeffsX = solveLinearSystem(XtX, XtSx2);
	const coeffsY = solveLinearSystem(XtX2, XtSy2);

	// Calculate accuracy as average Euclidean error
	let totalError = 0;
	for (let i = 0; i < n; i++) {
		const [px, py] = avgPupil[i];
		const predicted = applyCalibrationCoeffs(px, py, coeffsX, coeffsY);
		const dx = predicted[0] - screenXs[i];
		const dy = predicted[1] - screenYs[i];
		totalError += Math.sqrt(dx * dx + dy * dy);
	}
	const accuracy = totalError / n;

	return {
		coeffsX,
		coeffsY,
		accuracy,
		timestamp: Date.now(),
	};
}

function applyCalibrationCoeffs(
	px: number,
	py: number,
	coeffsX: number[],
	coeffsY: number[],
): [number, number] {
	const features = featureRow(px, py);
	let sx = 0;
	let sy = 0;
	for (let i = 0; i < features.length; i++) {
		sx += coeffsX[i] * features[i];
		sy += coeffsY[i] * features[i];
	}
	return [sx, sy];
}

/**
 * Apply calibration to map a pupil center to screen coordinates (0-1 range).
 */
export function applyCalibration(
	pupilCenter: [number, number],
	calibration: CalibrationResult,
): [number, number] {
	const [sx, sy] = applyCalibrationCoeffs(
		pupilCenter[0],
		pupilCenter[1],
		calibration.coeffsX,
		calibration.coeffsY,
	);
	// Clamp to [0, 1]
	return [Math.max(0, Math.min(1, sx)), Math.max(0, Math.min(1, sy))];
}

/**
 * Velocity-adaptive smoothing (1-Euro filter inspired).
 *
 * When gaze moves fast (saccade) → high alpha → fast response.
 * When gaze is still (fixation) → low alpha → heavy smoothing, no jitter.
 *
 * @param minAlpha  Smoothing during fixation (lower = smoother, 0.04–0.1)
 * @param maxAlpha  Smoothing during saccade (higher = faster, 0.5–0.8)
 * @param speedThreshold  Speed (in 0-1 screen units/frame) at which alpha reaches max
 */
export function smoothPosition(
	current: [number, number],
	previous: [number, number] | null,
	minAlpha = 0.06,
	maxAlpha = 0.6,
	speedThreshold = 0.05,
): [number, number] {
	if (!previous) return current;

	const dx = current[0] - previous[0];
	const dy = current[1] - previous[1];
	const speed = Math.sqrt(dx * dx + dy * dy);

	// Interpolate alpha based on speed
	const t = Math.min(1, speed / speedThreshold);
	const alpha = minAlpha + t * (maxAlpha - minAlpha);

	return [
		alpha * current[0] + (1 - alpha) * previous[0],
		alpha * current[1] + (1 - alpha) * previous[1],
	];
}
