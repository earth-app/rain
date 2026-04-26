import { createCanvas, Image } from 'canvas';
import { program } from 'commander';
import { parseFile } from 'music-metadata';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { generateText, systemPromptPrompts, tts } from '../ai';
import { getRandomPrompts } from '../api';
import {
	clamp,
	countWords,
	randomBetween,
	roundToMs,
	sanitizeSpokenText,
	toPosixPath,
	trimTextToWordCount
} from '../util';
import type { CaptionSegment, CloudCue, PromptVideoProps } from './types';

const FPS = 30;
const PAUSE_SEC = 0.9;

const HARD_MIN_SEC = 30;
const TARGET_MIN_SEC = 60;
const TARGET_BAND_MIN_SEC = 80;
const TARGET_BAND_MAX_SEC = 85;
const TARGET_CENTER_SEC = 82.5;
const HARD_MAX_SEC = 90;

const MAX_ANSWER_ATTEMPTS = 4;
const DEFAULT_WORDS_PER_SECOND = 2.45;

const WORKSPACE_ROOT = process.cwd();
const PUBLIC_DIR = resolve(WORKSPACE_ROOT, 'src/assets');
const GENERATED_DIR = resolve(PUBLIC_DIR, 'generated');
const OUT_DIR = resolve(WORKSPACE_ROOT, 'out');
const MINECRAFT_PATH = resolve(PUBLIC_DIR, 'minecraft.mp4');

const RENDER_ENTRY = resolve(WORKSPACE_ROOT, 'src/videos/index.ts');
const RENDER_COMPOSITION_ID = 'PromptShort';
const RENDER_OUTPUT_PATH = resolve(OUT_DIR, 'prompt.mp4');
const RENDER_PROPS_PATH = resolve(OUT_DIR, 'prompt.props.json');
const MANIFEST_OUTPUT_PATH = resolve(OUT_DIR, 'prompt.manifest.json');

const CLOUD_BASE_ASSET = 'cloud.png';
const CLOUD_VARIANT_ASSETS = [
	'cloud_variants/cloud_construction.png',
	'cloud_variants/cloud_crown.png',
	'cloud_variants/cloud_glasses.png',
	'cloud_variants/cloud_hammer.png',
	'cloud_variants/cloud_phone.png',
	'cloud_variants/cloud_saw.png',
	'cloud_variants/cloud_shovel.png',
	'cloud_variants/cloud_sword_shield.png',
	'cloud_variants/cloud_thanksgiving.png',
	'cloud_variants/cloud_witch.png'
];

const ALL_CLOUD_ASSETS = [CLOUD_BASE_ASSET, ...CLOUD_VARIANT_ASSETS];

type Candidate = {
	answer: string;
	words: number;
	audioPath: string;
	answerDurationSec: number;
	totalDurationSec: number;
	score: number;
};

type OpaqueMetrics = {
	width: number;
	opaqueWidth: number;
};

function toPublicRelativePath(filePath: string): string {
	const rel = relative(PUBLIC_DIR, filePath);
	if (rel.startsWith('..')) {
		throw new Error(`File is outside public directory: ${filePath}`);
	}

	return toPosixPath(rel);
}

function decodeBytes(bytes: ArrayBuffer | Uint8Array): string {
	if (bytes instanceof ArrayBuffer) {
		return new TextDecoder().decode(bytes);
	}

	return new TextDecoder().decode(bytes);
}

async function getMediaDurationSeconds(filePath: string): Promise<number> {
	const metadata = await parseFile(filePath, { duration: true });
	const duration = metadata.format.duration;
	if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
		throw new Error(`Could not parse media duration for ${filePath}`);
	}

	return duration;
}

function detectAudioExtension(audio: ArrayBuffer): string {
	const bytes = new Uint8Array(audio);

	if (bytes.length >= 12) {
		const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
		if (riff === 'RIFF') {
			return 'wav';
		}

		const ogg = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
		if (ogg === 'OggS') {
			return 'ogg';
		}

		const flac = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
		if (flac === 'fLaC') {
			return 'flac';
		}

		const id3 = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!);
		if (id3 === 'ID3') {
			return 'mp3';
		}

		if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) {
			return 'mp3';
		}

		const ftyp = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
		if (ftyp === 'ftyp') {
			return 'm4a';
		}
	}

	return 'mp3';
}

function estimateDurationSeconds(words: number): number {
	return words / DEFAULT_WORDS_PER_SECOND;
}

async function getDurationSecondsOrEstimate(
	filePath: string,
	words: number,
	label: string
): Promise<number> {
	try {
		return await getMediaDurationSeconds(filePath);
	} catch (error) {
		const fallback = estimateDurationSeconds(words);
		console.warn(
			`Could not detect ${label} duration with media metadata, using estimate (${fallback.toFixed(2)}s).`,
			error
		);
		return fallback;
	}
}

function scoreDuration(totalDurationSec: number): number {
	let score = Math.abs(totalDurationSec - TARGET_CENTER_SEC);

	if (totalDurationSec > HARD_MAX_SEC) {
		score += 100 + (totalDurationSec - HARD_MAX_SEC) * 20;
	}

	if (totalDurationSec < TARGET_MIN_SEC) {
		score += 40 + (TARGET_MIN_SEC - totalDurationSec) * 2;
	}

	if (totalDurationSec < HARD_MIN_SEC) {
		score += 200;
	}

	return score;
}

function getFileExtension(filePath: string): string {
	const match = /\.([^.]+)$/.exec(filePath);
	if (!match) {
		return 'mp3';
	}

	return match[1] ?? 'mp3';
}

function buildAnswerPrompt(
	question: string,
	wordMin: number,
	wordMax: number,
	attempt: number
): string {
	const optimizationHint =
		attempt === 1
			? 'Aim for vivid language and a strong opening sentence.'
			: attempt === 2
				? 'Be slightly more concise while keeping depth and warmth.'
				: attempt === 3
					? 'Favor short, punchy sentences over long complex ones.'
					: 'Keep the explanation clear and compact without losing meaning.';

	return [
		`Question: ${question}`,
		'',
		'Write the spoken answer only.',
		'Constraints:',
		`- ${wordMin}-${wordMax} words`,
		'- 2 to 3 short paragraphs',
		'- conversational, curious, and friendly',
		'- no markdown, no lists, no emojis, no labels',
		'- no disclaimers or safety caveats',
		`- ${optimizationHint}`
	].join('\n');
}

function splitCaptionPhrases(text: string): string[] {
	const normalized = text.replace(/\s+/g, ' ').trim();
	if (!normalized) {
		return [];
	}

	const sentences = normalized
		.split(/(?<=[.!?])\s+/)
		.map((sentence) => sentence.trim())
		.filter(Boolean);

	const phrases: string[] = [];
	for (const sentence of sentences) {
		const words = sentence.split(' ').filter(Boolean);
		if (words.length <= 9) {
			phrases.push(sentence);
			continue;
		}

		for (let i = 0; i < words.length; i += 7) {
			const chunk = words
				.slice(i, i + 7)
				.join(' ')
				.trim();
			if (chunk) {
				phrases.push(chunk);
			}
		}
	}

	return phrases;
}

function normalizeCaptionText(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function chooseCloudAssetForText(text: string, speaker: 'prompt' | 'answer'): string {
	const normalized = normalizeCaptionText(text);
	if (!normalized) {
		return CLOUD_BASE_ASSET;
	}

	const keywordRules: Array<{ asset: string; keywords: string[] }> = [
		{
			asset: 'cloud_variants/cloud_construction.png',
			keywords: ['build', 'building', 'create', 'creation', 'construct', 'structure', 'make']
		},
		{
			asset: 'cloud_variants/cloud_crown.png',
			keywords: ['success', 'winner', 'winning', 'leadership', 'leader', 'crown', 'achievement']
		},
		{
			asset: 'cloud_variants/cloud_glasses.png',
			keywords: ['see', 'vision', 'perspective', 'look', 'understand', 'clarity', 'view']
		},
		{
			asset: 'cloud_variants/cloud_hammer.png',
			keywords: ['fix', 'repair', 'solve', 'hammer', 'tool', 'work', 'shape']
		},
		{
			asset: 'cloud_variants/cloud_phone.png',
			keywords: ['talk', 'speak', 'conversation', 'communicate', 'connect', 'phone', 'message']
		},
		{
			asset: 'cloud_variants/cloud_saw.png',
			keywords: ['cut', 'divide', 'split', 'separate', 'saw', 'edge']
		},
		{
			asset: 'cloud_variants/cloud_shovel.png',
			keywords: ['dig', 'discover', 'explore', 'ground', 'layer', 'depth', 'research']
		},
		{
			asset: 'cloud_variants/cloud_sword_shield.png',
			keywords: ['challenge', 'conflict', 'protect', 'defend', 'risk', 'battle', 'shield']
		},
		{
			asset: 'cloud_variants/cloud_thanksgiving.png',
			keywords: ['thanks', 'thank', 'gratitude', 'appreciate', 'appreciation', 'grateful']
		},
		{
			asset: 'cloud_variants/cloud_witch.png',
			keywords: ['magic', 'mystery', 'mysterious', 'uncertain', 'wonder', 'strange', 'weird']
		}
	];

	if (speaker === 'prompt' && normalized.includes('?')) {
		return 'cloud_variants/cloud_glasses.png';
	}

	for (const rule of keywordRules) {
		if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
			return rule.asset;
		}
	}

	if (speaker === 'prompt') {
		return 'cloud_variants/cloud_phone.png';
	}

	return CLOUD_BASE_ASSET;
}

function buildCaptionSegments(
	text: string,
	startSec: number,
	durationSec: number,
	speaker: 'prompt' | 'answer'
): CaptionSegment[] {
	if (durationSec <= 0) {
		return [];
	}

	const phrases = splitCaptionPhrases(text);
	if (phrases.length === 0) {
		return [];
	}

	const weights = phrases.map((phrase) => Math.max(1, phrase.split(' ').length));
	const totalWeight = weights.reduce((acc, weight) => acc + weight, 0);

	let cursor = startSec;
	const end = startSec + durationSec;

	return phrases.map((phrase, index) => {
		const weight = weights[index] ?? 1;
		const isLast = index === phrases.length - 1;
		const segmentDuration = isLast ? end - cursor : durationSec * (weight / totalWeight);
		const segmentEnd = isLast ? end : cursor + segmentDuration;

		const segment: CaptionSegment = {
			startSec: roundToMs(cursor),
			endSec: roundToMs(segmentEnd),
			text: phrase,
			speaker
		};

		cursor = segmentEnd;
		return segment;
	});
}

async function loadImageFromFile(filePath: string): Promise<Image> {
	const image = new Image();
	await new Promise<void>((resolveImage, rejectImage) => {
		image.onload = () => resolveImage();
		image.onerror = () => rejectImage(new Error(`Could not decode image: ${filePath}`));
		image.src = filePath;
	});

	return image;
}

async function getOpaqueMetrics(assetRelativePath: string): Promise<OpaqueMetrics> {
	const absolutePath = resolve(PUBLIC_DIR, assetRelativePath);
	const image = await loadImageFromFile(absolutePath);

	const canvas = createCanvas(image.width, image.height);
	const ctx = canvas.getContext('2d');
	ctx.drawImage(image, 0, 0);

	const data = ctx.getImageData(0, 0, image.width, image.height).data;

	let minX = image.width;
	let maxX = -1;

	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			const alphaIndex = (y * image.width + x) * 4 + 3;
			const alpha = data[alphaIndex] ?? 0;
			if (alpha > 8) {
				if (x < minX) {
					minX = x;
				}
				if (x > maxX) {
					maxX = x;
				}
			}
		}
	}

	const opaqueWidth = maxX >= minX ? maxX - minX + 1 : image.width;

	return {
		width: image.width,
		opaqueWidth
	};
}

async function buildCloudScaleMap(): Promise<Record<string, number>> {
	const baseMetrics = await getOpaqueMetrics(CLOUD_BASE_ASSET);
	const baseRatio = baseMetrics.opaqueWidth / Math.max(1, baseMetrics.width);

	const scaleEntries = await Promise.all(
		ALL_CLOUD_ASSETS.map(async (asset) => {
			const metrics = await getOpaqueMetrics(asset);
			const ratio = metrics.opaqueWidth / Math.max(1, metrics.width);
			const normalizedScale = clamp(baseRatio / Math.max(0.1, ratio), 0.95, 2.3);
			return [asset, Number(normalizedScale.toFixed(3))] as const;
		})
	);

	const map = Object.fromEntries(scaleEntries);
	map[CLOUD_BASE_ASSET] = 1;

	return map;
}

function buildCloudCues(
	captions: CaptionSegment[],
	totalDurationSec: number,
	promptDurationSec: number,
	pauseDurationSec: number,
	scaleByAsset: Record<string, number>
): CloudCue[] {
	const cues: CloudCue[] = [];
	if (captions.length > 0) {
		let currentStart = captions[0]!.startSec;
		let currentEnd = captions[0]!.endSec;
		let currentText = captions[0]!.text;
		let currentSpeaker = captions[0]!.speaker;
		let currentAsset = chooseCloudAssetForText(currentText, currentSpeaker);

		const flushCurrent = () => {
			if (currentEnd <= currentStart) {
				return;
			}

			cues.push({
				startSec: currentStart,
				endSec: currentEnd,
				asset: currentAsset,
				scale: scaleByAsset[currentAsset] ?? 1
			});
		};

		for (let i = 1; i < captions.length; i++) {
			const caption = captions[i]!;
			const gapSec = caption.startSec - currentEnd;
			const nextAsset = chooseCloudAssetForText(caption.text, caption.speaker);
			const mergedText = `${currentText} ${caption.text}`.trim();
			const mergedAsset = chooseCloudAssetForText(mergedText, currentSpeaker);
			const sameSpeaker = caption.speaker === currentSpeaker;
			const canExtend =
				sameSpeaker &&
				gapSec <= 0.85 &&
				(cues.length === 0 ||
					currentEnd - currentStart < 4.6 ||
					nextAsset === currentAsset ||
					mergedAsset === currentAsset);

			if (canExtend) {
				currentEnd = caption.endSec;
				currentText = mergedText;
				currentAsset = mergedAsset;
				continue;
			}

			flushCurrent();
			currentStart = caption.startSec;
			currentEnd = caption.endSec;
			currentText = caption.text;
			currentSpeaker = caption.speaker;
			currentAsset = nextAsset;
		}

		flushCurrent();
	}

	if (cues.length === 0) {
		cues.push({
			startSec: 0,
			endSec: totalDurationSec,
			asset: CLOUD_BASE_ASSET,
			scale: 1
		});
	}

	for (let i = 1; i < cues.length; i++) {
		const previousCue = cues[i - 1]!;
		const cue = cues[i]!;
		if (cue.startSec - previousCue.endSec < 0.4) {
			previousCue.endSec = Math.max(previousCue.endSec, cue.endSec);
			cues.splice(i, 1);
			i -= 1;
		}
	}

	const pauseStartSec = promptDurationSec;
	const pauseEndSec = Math.min(totalDurationSec, promptDurationSec + pauseDurationSec);
	if (pauseEndSec > pauseStartSec) {
		cues.push({
			startSec: pauseStartSec,
			endSec: pauseEndSec,
			asset: CLOUD_BASE_ASSET,
			scale: 1
		});
	}

	return cues
		.sort((a, b) => a.startSec - b.startSec)
		.map((cue) => ({
			...cue,
			startSec: roundToMs(cue.startSec),
			endSec: roundToMs(cue.endSec)
		}));
}

async function selectBackgroundWindow(
	totalDurationSec: number
): Promise<{ startSec: number; segmentSec: number }> {
	let minecraftDurationSec = 600;
	try {
		minecraftDurationSec = await getMediaDurationSeconds(MINECRAFT_PATH);
	} catch (error) {
		console.warn(
			`Could not detect minecraft.mp4 duration with media metadata, falling back to ${minecraftDurationSec}s.`,
			error
		);
	}

	const segmentSec = randomBetween(75, 90);
	const requiredSec = Math.max(segmentSec, totalDurationSec + 0.5);
	const maxStartSec = Math.max(0, minecraftDurationSec - requiredSec);
	const startSec = randomBetween(0, maxStartSec);

	return {
		startSec: roundToMs(startSec),
		segmentSec: roundToMs(segmentSec)
	};
}

async function cleanupGeneratedRuns(keepNewest = 8): Promise<void> {
	if (!existsSync(GENERATED_DIR)) {
		return;
	}

	const entries = await readdir(GENERATED_DIR, { withFileTypes: true });
	const runDirs = entries
		.filter((entry) => entry.isDirectory() && entry.name.startsWith('prompt-'))
		.map((entry) => entry.name)
		.sort()
		.reverse();

	for (const staleDirName of runDirs.slice(keepNewest)) {
		await rm(resolve(GENERATED_DIR, staleDirName), { recursive: true, force: true });
	}
}

async function runRender(propsPath: string): Promise<void> {
	const renderProcess = Bun.spawn({
		cmd: [
			'bunx',
			'remotion',
			'render',
			RENDER_ENTRY,
			RENDER_COMPOSITION_ID,
			RENDER_OUTPUT_PATH,
			'--public-dir',
			PUBLIC_DIR,
			'--props',
			propsPath
		],
		stdout: 'inherit',
		stderr: 'inherit'
	});

	const exitCode = await renderProcess.exited;
	if (exitCode !== 0) {
		throw new Error(`Remotion render failed with exit code ${exitCode}`);
	}
}

async function main(): Promise<void> {
	program.option('--skip-render', 'Generate audio and props without rendering video', false);
	program.parse();

	const options = program.opts<{ skipRender: boolean }>();

	await mkdir(OUT_DIR, { recursive: true });
	await mkdir(GENERATED_DIR, { recursive: true });
	await cleanupGeneratedRuns(8);

	const prompts = await getRandomPrompts(1);
	const selectedPrompt = prompts[0];
	if (!selectedPrompt || !selectedPrompt.prompt) {
		throw new Error('Random prompt endpoint returned no prompt');
	}

	const question = sanitizeSpokenText(selectedPrompt.prompt);
	if (!question) {
		throw new Error('Prompt text is empty after normalization');
	}

	const generationId = `prompt-${Date.now()}`;
	const runDir = resolve(GENERATED_DIR, generationId);
	await mkdir(runDir, { recursive: true });

	console.log(`Selected prompt: ${question}`);

	const promptAudioBuffer = await tts(question);
	const promptAudioExt = detectAudioExtension(promptAudioBuffer);
	const promptAudioPath = resolve(runDir, `prompt.${promptAudioExt}`);
	await Bun.write(promptAudioPath, new Uint8Array(promptAudioBuffer));

	const promptDurationSec = await getDurationSecondsOrEstimate(
		promptAudioPath,
		countWords(question),
		'prompt'
	);

	let expectedWordsPerSecond = DEFAULT_WORDS_PER_SECOND;
	let bestCandidate: Candidate | null = null;
	const attemptAudioPaths: string[] = [];

	for (let attempt = 1; attempt <= MAX_ANSWER_ATTEMPTS; attempt++) {
		const desiredAnswerSec = clamp(TARGET_CENTER_SEC - promptDurationSec - PAUSE_SEC, 38, 82);
		const targetWords = Math.round(desiredAnswerSec * expectedWordsPerSecond);
		const wordMin = Math.round(clamp(targetWords - 22, 90, 220));
		const wordMax = Math.round(clamp(targetWords + 22, wordMin + 10, 250));

		const answerPrompt = buildAnswerPrompt(question, wordMin, wordMax, attempt);
		const rawAnswer = await generateText(systemPromptPrompts, answerPrompt);
		const answer = sanitizeSpokenText(rawAnswer);
		const words = countWords(answer);

		const answerAudioBuffer = await tts(answer);
		const answerAudioExt = detectAudioExtension(answerAudioBuffer);
		const attemptAudioPath = resolve(runDir, `answer-attempt-${attempt}.${answerAudioExt}`);
		attemptAudioPaths.push(attemptAudioPath);

		await Bun.write(attemptAudioPath, new Uint8Array(answerAudioBuffer));

		const answerDurationSec = await getDurationSecondsOrEstimate(
			attemptAudioPath,
			words,
			`answer attempt ${attempt}`
		);
		const totalDurationSec = promptDurationSec + PAUSE_SEC + answerDurationSec;

		const candidate: Candidate = {
			answer,
			words,
			audioPath: attemptAudioPath,
			answerDurationSec,
			totalDurationSec,
			score: scoreDuration(totalDurationSec)
		};

		if (!bestCandidate || candidate.score < bestCandidate.score) {
			bestCandidate = candidate;
		}

		expectedWordsPerSecond = clamp(words / Math.max(answerDurationSec, 1), 2.0, 3.4);

		console.log(
			`Attempt ${attempt}: ${words} words, ${totalDurationSec.toFixed(2)}s total (${wordMin}-${wordMax} target words)`
		);

		if (totalDurationSec >= TARGET_BAND_MIN_SEC && totalDurationSec <= TARGET_BAND_MAX_SEC) {
			break;
		}
	}

	if (!bestCandidate) {
		throw new Error('Could not generate an answer candidate');
	}

	if (bestCandidate.totalDurationSec > HARD_MAX_SEC) {
		const allowedAnswerSec = Math.max(20, HARD_MAX_SEC - promptDurationSec - PAUSE_SEC - 0.2);
		const estimatedTrimmedWords = Math.max(
			90,
			Math.floor(bestCandidate.words * (allowedAnswerSec / bestCandidate.answerDurationSec))
		);
		const trimmedAnswer = trimTextToWordCount(bestCandidate.answer, estimatedTrimmedWords);

		if (trimmedAnswer && trimmedAnswer !== bestCandidate.answer) {
			const trimmedAudioBuffer = await tts(trimmedAnswer);
			const trimmedExt = detectAudioExtension(trimmedAudioBuffer);
			const trimmedPath = resolve(runDir, `answer-trimmed.${trimmedExt}`);
			await Bun.write(trimmedPath, new Uint8Array(trimmedAudioBuffer));

			const trimmedDurationSec = await getDurationSecondsOrEstimate(
				trimmedPath,
				countWords(trimmedAnswer),
				'trimmed answer'
			);
			const trimmedTotalSec = promptDurationSec + PAUSE_SEC + trimmedDurationSec;

			if (trimmedTotalSec < bestCandidate.totalDurationSec) {
				bestCandidate = {
					answer: trimmedAnswer,
					words: countWords(trimmedAnswer),
					audioPath: trimmedPath,
					answerDurationSec: trimmedDurationSec,
					totalDurationSec: trimmedTotalSec,
					score: scoreDuration(trimmedTotalSec)
				};
			}
		}
	}

	const answerAudioExt = getFileExtension(bestCandidate.audioPath);
	const finalAnswerAudioPath = resolve(runDir, `answer.${answerAudioExt}`);
	if (bestCandidate.audioPath !== finalAnswerAudioPath) {
		await Bun.write(finalAnswerAudioPath, await Bun.file(bestCandidate.audioPath).arrayBuffer());
	}

	for (const attemptPath of attemptAudioPaths) {
		if (attemptPath !== finalAnswerAudioPath && existsSync(attemptPath)) {
			await rm(attemptPath, { force: true });
		}
	}

	const totalDurationSec = promptDurationSec + PAUSE_SEC + bestCandidate.answerDurationSec;

	const captions = [
		...buildCaptionSegments(question, 0, promptDurationSec, 'prompt'),
		...buildCaptionSegments(
			bestCandidate.answer,
			promptDurationSec + PAUSE_SEC,
			bestCandidate.answerDurationSec,
			'answer'
		)
	];

	const cloudScaleByAsset = await buildCloudScaleMap();
	const cloudCues = buildCloudCues(
		captions,
		totalDurationSec,
		promptDurationSec,
		PAUSE_SEC,
		cloudScaleByAsset
	);

	const background = await selectBackgroundWindow(totalDurationSec);

	const props: PromptVideoProps = {
		question,
		answer: bestCandidate.answer,
		promptAudioFile: toPublicRelativePath(promptAudioPath),
		answerAudioFile: toPublicRelativePath(finalAnswerAudioPath),
		promptDurationSec: roundToMs(promptDurationSec),
		answerDurationSec: roundToMs(bestCandidate.answerDurationSec),
		pauseDurationSec: PAUSE_SEC,
		totalDurationSec: roundToMs(totalDurationSec),
		backgroundStartSec: background.startSec,
		backgroundSegmentSec: background.segmentSec,
		captions,
		cloudCues,
		generationId
	};

	await Bun.write(RENDER_PROPS_PATH, JSON.stringify(props, null, 2));

	await Bun.write(
		MANIFEST_OUTPUT_PATH,
		JSON.stringify(
			{
				generationId,
				renderedAt: new Date().toISOString(),
				question,
				answer: bestCandidate.answer,
				totalDurationSec: roundToMs(totalDurationSec),
				promptDurationSec: roundToMs(promptDurationSec),
				answerDurationSec: roundToMs(bestCandidate.answerDurationSec),
				pauseDurationSec: PAUSE_SEC,
				promptAudioFile: basename(promptAudioPath),
				answerAudioFile: basename(finalAnswerAudioPath),
				backgroundStartSec: background.startSec,
				backgroundSegmentSec: background.segmentSec
			},
			null,
			2
		)
	);

	console.log(`Final duration: ${totalDurationSec.toFixed(2)}s`);
	if (totalDurationSec > HARD_MAX_SEC) {
		console.warn(`Duration is above ${HARD_MAX_SEC}s. Consider another run for a tighter cut.`);
	}
	if (totalDurationSec < HARD_MIN_SEC) {
		console.warn(`Duration is below ${HARD_MIN_SEC}s. Consider another run for longer narration.`);
	}

	if (options.skipRender) {
		console.log('Skipping render because --skip-render was set.');
		console.log(`Props file: ${RENDER_PROPS_PATH}`);
		return;
	}

	console.log('Rendering prompt.mp4 with Remotion...');
	await runRender(RENDER_PROPS_PATH);
	console.log(`Rendered video: ${RENDER_OUTPUT_PATH}`);
}

main().catch((error: unknown) => {
	console.error('Prompt video generation failed.');
	if (error instanceof Error) {
		console.error(error.message);
	} else {
		console.error(error);
	}
	process.exit(1);
});
