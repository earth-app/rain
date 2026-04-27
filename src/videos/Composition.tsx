import React from 'react';
import {
	AbsoluteFill,
	Audio,
	Img,
	OffthreadVideo,
	Sequence,
	interpolate,
	staticFile,
	useCurrentFrame,
	useVideoConfig
} from 'remotion';
import type { CaptionSegment, CloudCue, PromptVideoProps } from './types';

const FONT_FAMILY = 'RainNotoSans, "Noto Sans", sans-serif';

const FONT_FACE_CSS = `
@font-face {
	font-family: "RainNotoSans";
	src: url("${staticFile('NotoSans.ttf')}") format("truetype");
	font-weight: 400;
	font-style: normal;
	font-display: swap;
}
`;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const findActiveCaption = (
	captions: CaptionSegment[],
	currentSec: number
): CaptionSegment | null => {
	for (const caption of captions) {
		if (currentSec >= caption.startSec && currentSec < caption.endSec) {
			return caption;
		}
	}

	return null;
};

const findActiveCloudCue = (cloudCues: CloudCue[], currentSec: number): CloudCue | null => {
	for (const cue of cloudCues) {
		if (currentSec >= cue.startSec && currentSec < cue.endSec) {
			return cue;
		}
	}

	if (cloudCues.length > 0 && currentSec >= (cloudCues[cloudCues.length - 1]?.endSec ?? 0)) {
		return cloudCues[cloudCues.length - 1] ?? null;
	}

	return null;
};

export const PromptShortComposition: React.FC<PromptVideoProps> = (props) => {
	const frame = useCurrentFrame();
	const { fps, durationInFrames } = useVideoConfig();
	const currentSec = frame / fps;

	const caption = findActiveCaption(props.captions, currentSec);
	const cloudCue = findActiveCloudCue(props.cloudCues, currentSec);

	const speakingNow =
		currentSec <= props.promptDurationSec ||
		(currentSec >= props.promptDurationSec + props.pauseDurationSec &&
			currentSec <= props.totalDurationSec + 0.001);

	const timelineProgress = frame / Math.max(1, durationInFrames - 1);
	const panX = interpolate(timelineProgress, [0, 1], [-70, 70], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp'
	});

	const cloudFloatY = speakingNow ? Math.sin(frame / 5) * 10 : Math.sin(frame / 9) * 4;
	const cloudPulse = speakingNow ? 1 + Math.sin(frame / 3) * 0.02 : 1;

	const cloudAsset = cloudCue?.asset ?? 'cloud.png';
	const cloudScale = clamp(cloudCue?.scale ?? 1, 0.9, 2.3);
	const cloudWidth = Math.round(clamp(470 * cloudScale, 360, 900));

	const trimBefore = Math.max(0, Math.floor(props.backgroundStartSec * fps));
	const trimAfter = Math.max(
		trimBefore + 1,
		Math.floor((props.backgroundStartSec + props.backgroundSegmentSec) * fps)
	);

	const answerStartFrame = Math.round((props.promptDurationSec + props.pauseDurationSec) * fps);
	const hasPromptAudio = props.promptAudioFile.length > 0;
	const hasAnswerAudio = props.answerAudioFile.length > 0;

	return (
		<AbsoluteFill
			style={{ backgroundColor: '#070D1C', overflow: 'hidden', fontFamily: FONT_FAMILY }}
		>
			<style>{FONT_FACE_CSS}</style>

			<AbsoluteFill style={{ overflow: 'hidden' }}>
				<OffthreadVideo
					src={staticFile('downloaded/minecraft.mp4')}
					trimBefore={trimBefore}
					trimAfter={trimAfter}
					muted
					style={{
						width: '126%',
						height: '100%',
						objectFit: 'cover',
						transform: `translateX(${panX}px) scale(1.08)`,
						transformOrigin: 'center center'
					}}
				/>
			</AbsoluteFill>

			<AbsoluteFill
				style={{
					background:
						'linear-gradient(180deg, rgba(7, 13, 28, 0.55) 0%, rgba(7, 13, 28, 0.28) 35%, rgba(7, 13, 28, 0.62) 100%)'
				}}
			/>

			{hasPromptAudio ? <Audio src={staticFile(props.promptAudioFile)} /> : null}
			{hasAnswerAudio ? (
				<Sequence from={answerStartFrame}>
					<Audio src={staticFile(props.answerAudioFile)} />
				</Sequence>
			) : null}

			{caption ? (
				<div
					style={{
						position: 'absolute',
						top: 120,
						left: 64,
						right: 64,
						display: 'flex',
						justifyContent: 'center',
						pointerEvents: 'none'
					}}
				>
					<div
						style={{
							maxWidth: 860,
							textAlign: 'center',
							fontSize: 62,
							lineHeight: 1.16,
							fontWeight: 700,
							padding: '22px 28px',
							borderRadius: 24,
							backgroundColor: 'rgba(9, 15, 30, 0.62)',
							backdropFilter: 'blur(8px)',
							color: caption.speaker === 'prompt' ? '#9ED8FF' : '#F6FDFF',
							textShadow: '0 4px 10px rgba(0, 0, 0, 0.45)'
						}}
					>
						{caption.text}
					</div>
				</div>
			) : null}

			<div
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					bottom: 148,
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
					pointerEvents: 'none',
					transform: `translateY(${cloudFloatY}px) scale(${cloudPulse})`
				}}
			>
				<Img
					src={staticFile(cloudAsset)}
					style={{
						width: cloudWidth,
						height: 'auto',
						filter: 'drop-shadow(0 24px 50px rgba(3, 8, 18, 0.55))'
					}}
				/>
			</div>

			<Img
				src={staticFile('earth-app.png')}
				style={{
					position: 'absolute',
					right: 28,
					bottom: 28,
					width: 120,
					height: 120,
					opacity: 0.88,
					filter: 'drop-shadow(0 6px 16px rgba(0, 0, 0, 0.45))'
				}}
			/>
		</AbsoluteFill>
	);
};
