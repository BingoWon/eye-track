export interface PupilData {
	center: [number, number];
	axes: [number, number];
	angle: number;
}

export interface GazeData {
	origin: [number, number, number];
	direction: [number, number, number];
}

export interface TrackingData {
	pupil: PupilData | null;
	eyeCenter: [number, number] | null;
	gaze: GazeData | null;
	fps: number;
	confidence: number;
	timestamp: number;
}

export interface TrackerFrame {
	id: string;
	cameraIndex: number;
	image: string;
	tracking: TrackingData;
}

export interface FrameMessage {
	type: "frame";
	trackers: TrackerFrame[];
}

export interface Settings {
	thresholdStrict: number;
	thresholdMedium: number;
	thresholdRelaxed: number;
	maskSize: number;
	streamFps: number;
	jpegQuality: number;
	minConfidence: number;
	maxAspectRatio: number;
	rangeMargin: number;
}

export interface TrackingHistory {
	timestamps: number[];
	gazePoints: [number, number][];
	gazeDirections: [number, number, number][];
	pupilSizes: number[];
}

export const DEFAULT_SETTINGS: Settings = {
	thresholdStrict: 5,
	thresholdMedium: 15,
	thresholdRelaxed: 25,
	maskSize: 250,
	streamFps: 120,
	jpegQuality: 80,
	minConfidence: 0.3,
	maxAspectRatio: 2.5,
	rangeMargin: 1.1,
};
