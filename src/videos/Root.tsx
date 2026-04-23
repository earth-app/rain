import React from 'react';
import { Composition } from 'remotion';
import { PromptShortComposition } from './Composition';
import type { PromptVideoProps } from './types';

const FPS = 30;

const DEFAULT_PROPS: PromptVideoProps = {
	question: 'Why do we look for patterns in nature?',
	answer:
		'Your generated answer will appear here. Run the prompt generator to render the final video with AI narration and captions.',
	promptAudioFile: '',
	answerAudioFile: '',
	promptDurationSec: 4,
	answerDurationSec: 28,
	pauseDurationSec: 0.9,
	totalDurationSec: 32.9,
	backgroundStartSec: 0,
	backgroundSegmentSec: 80,
	captions: [
		{
			startSec: 0,
			endSec: 4,
			text: 'Why do we look for patterns in nature?',
			speaker: 'prompt'
		},
		{
			startSec: 4.9,
			endSec: 12,
			text: 'Run bun run video:prompt to generate AI voice and captions.',
			speaker: 'answer'
		}
	],
	cloudCues: [
		{
			startSec: 0,
			endSec: 32.9,
			asset: 'cloud.png',
			scale: 1
		}
	],
	generationId: 'studio-default'
};

export const RemotionRoot: React.FC = () => {
	return (
		<>
			<Composition
				id="PromptShort"
				component={PromptShortComposition}
				durationInFrames={FPS * 90}
				fps={FPS}
				width={1080}
				height={1920}
				defaultProps={DEFAULT_PROPS}
				calculateMetadata={({ props }) => {
					const durationInFrames = Math.max(1, Math.round(props.totalDurationSec * FPS));
					return { durationInFrames };
				}}
			/>
		</>
	);
};
