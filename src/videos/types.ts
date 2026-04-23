export type CaptionSpeaker = 'prompt' | 'answer';

export type CaptionSegment = {
	startSec: number;
	endSec: number;
	text: string;
	speaker: CaptionSpeaker;
};

export type CloudCue = {
	startSec: number;
	endSec: number;
	asset: string;
	scale: number;
};

export type PromptVideoProps = {
	question: string;
	answer: string;
	promptAudioFile: string;
	answerAudioFile: string;
	promptDurationSec: number;
	answerDurationSec: number;
	pauseDurationSec: number;
	totalDurationSec: number;
	backgroundStartSec: number;
	backgroundSegmentSec: number;
	captions: CaptionSegment[];
	cloudCues: CloudCue[];
	generationId: string;
};
