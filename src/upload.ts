import { program } from 'commander';
import { createReadStream, readFileSync } from 'fs';
import { google } from 'googleapis';
import { resolve } from 'node:path';
import { generateYoutubeMetadataDraft } from './ai';
import { normalizeWhitespace, trimToLength } from './util';

const WORKSPACE_ROOT = process.cwd();

if (
	!process.env.YOUTUBE_CLIENT_ID ||
	!process.env.YOUTUBE_CLIENT_SECRET ||
	!process.env.YOUTUBE_REFRESH_TOKEN
) {
	throw new Error('Missing YouTube API credentials in environment variables');
}

const oauth2Client = new google.auth.OAuth2({
	client_id: process.env.YOUTUBE_CLIENT_ID,
	client_secret: process.env.YOUTUBE_CLIENT_SECRET
});

oauth2Client.setCredentials({
	refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
});

const youtube = google.youtube({
	version: 'v3',
	auth: oauth2Client
});

type PromptManifest = {
	question: string;
	answer: string;
};

type GeneratedMetadata = {
	title: string;
	description: string;
	tags: string[];
	categoryId: string;
	hashtags?: string[];
};

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TAG_COUNT = 30;
const MAX_TAG_CHARS = 460;

const BRAND_TAGS = ['The Earth App', 'Earth App', 'AI', 'Cloud', 'Shorts', 'Curiosity'];

const STOP_WORDS = new Set([
	'a',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'by',
	'for',
	'from',
	'how',
	'i',
	'in',
	'is',
	'it',
	'of',
	'on',
	'or',
	'that',
	'the',
	'this',
	'to',
	'was',
	'we',
	'what',
	'when',
	'where',
	'which',
	'who',
	'why',
	'will',
	'with',
	'you',
	'your'
]);

function toHashtag(value: string): string {
	const compact = value
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, '')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 3)
		.join('');

	if (!compact) {
		return '';
	}

	return `#${compact}`;
}

function extractKeywords(text: string, limit: number): string[] {
	const counts = new Map<string, number>();
	const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

	for (const word of words) {
		if (word.length < 3 || STOP_WORDS.has(word)) {
			continue;
		}

		counts.set(word, (counts.get(word) ?? 0) + 1);
	}

	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([word]) => word)
		.slice(0, limit);
}

function toTitleWord(value: string): string {
	if (!value) {
		return value;
	}

	return value[0]!.toUpperCase() + value.slice(1).toLowerCase();
}

function toPhrase(words: string[]): string {
	return words.map((word) => toTitleWord(word)).join(' ');
}

function buildDynamicTags(question: string, answer: string): string[] {
	const keywords = extractKeywords(`${question} ${answer}`, 18);
	const tags: string[] = [];

	for (const keyword of keywords) {
		tags.push(keyword);
		tags.push(toTitleWord(keyword));
	}

	for (let i = 0; i < keywords.length - 1; i++) {
		const pair = [keywords[i]!, keywords[i + 1]!];
		tags.push(toPhrase(pair));
	}

	const normalizedQuestion = normalizeWhitespace(question).replace(/[?!.]+$/g, '');
	if (normalizedQuestion.length > 8) {
		tags.push(normalizedQuestion);
	}

	return tags;
}

function dedupeTags(tags: string[]): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	let totalChars = 0;

	for (const rawTag of tags) {
		const normalized = normalizeWhitespace(rawTag).replace(/["'`]/g, '');
		if (!normalized) {
			continue;
		}

		const key = normalized.toLowerCase();
		if (seen.has(key)) {
			continue;
		}

		if (deduped.length >= MAX_TAG_COUNT) {
			break;
		}

		const prospectiveChars = totalChars + normalized.length;
		if (prospectiveChars > MAX_TAG_CHARS) {
			break;
		}

		seen.add(key);
		deduped.push(normalized);
		totalChars = prospectiveChars;
	}

	return deduped;
}

function chooseCategoryIdFromText(text: string): string {
	const normalized = text.toLowerCase();

	const scienceKeywords = [
		'science',
		'brain',
		'psychology',
		'biology',
		'neuroscience',
		'physics',
		'data',
		'research',
		'algorithm'
	];
	const educationKeywords = [
		'learn',
		'lesson',
		'explain',
		'guide',
		'how to',
		'tips',
		'habit',
		'growth',
		'mindset'
	];

	const scienceScore = scienceKeywords.filter((keyword) => normalized.includes(keyword)).length;
	const educationScore = educationKeywords.filter((keyword) => normalized.includes(keyword)).length;

	if (scienceScore >= 2 && scienceScore >= educationScore) {
		return '28'; // Science & Technology
	}

	if (educationScore >= 2) {
		return '27'; // Education
	}

	return '22'; // People & Blogs
}

function buildFallbackTitle(question: string): string {
	const normalizedQuestion = normalizeWhitespace(question).replace(/[?!.]+$/g, '');
	if (!normalizedQuestion) {
		return 'Curiosity Prompt: Think Deeper Today';
	}

	const withQuestionMark = `${normalizedQuestion}?`;
	return trimToLength(withQuestionMark, MAX_TITLE_LENGTH);
}

function pickBestTitle(aiTitle: string | undefined, fallbackTitle: string): string {
	const normalizedAiTitle = typeof aiTitle === 'string' ? normalizeWhitespace(aiTitle) : '';
	if (normalizedAiTitle.length >= 8) {
		return trimToLength(normalizedAiTitle, MAX_TITLE_LENGTH);
	}

	return fallbackTitle;
}

function buildFallbackMetadata(question: string, answer: string): GeneratedMetadata {
	const normalizedQuestion = normalizeWhitespace(question).replace(/[?!.]+$/g, '');
	const dynamicTags = buildDynamicTags(question, answer);
	const mergedTags = dedupeTags([...BRAND_TAGS, ...dynamicTags]);
	const hashtags = dedupeTags(
		['theearthapp', 'shorts', 'ai', 'curiosity', ...mergedTags.slice(0, 10)].map((tag) =>
			toHashtag(tag)
		)
	).slice(0, 12);

	const title = buildFallbackTitle(question);

	const answerSnippet = trimToLength(normalizeWhitespace(answer), 850);
	const description = trimToLength(
		normalizeWhitespace(
			[
				answerSnippet,
				`Question explored: ${normalizedQuestion}?`,
				'Comment your take and subscribe for daily mind-expanding prompts.',
				hashtags.join(' '),
				'Generated by The Earth App.'
			]
				.filter(Boolean)
				.join('\n\n')
		),
		MAX_DESCRIPTION_LENGTH
	);

	return {
		title,
		description,
		tags: mergedTags,
		categoryId: chooseCategoryIdFromText(`${question} ${answer}`),
		hashtags
	};
}

async function buildOptimizedMetadata(
	question: string,
	answer: string
): Promise<GeneratedMetadata> {
	const fallback = buildFallbackMetadata(question, answer);

	try {
		const ai = await generateYoutubeMetadataDraft(question, answer);
		const mergedTags = dedupeTags([
			...(ai.tags ?? []),
			...buildDynamicTags(question, answer),
			...BRAND_TAGS
		]);

		const hashtagsFromAi = (ai.hashtags ?? [])
			.map((tag) => (tag.startsWith('#') ? tag : toHashtag(tag)))
			.filter(Boolean);
		const hashtags = dedupeTags(
			[
				...hashtagsFromAi,
				...(fallback.hashtags ?? []),
				...mergedTags.slice(0, 8).map((tag) => toHashtag(tag))
			].filter(Boolean)
		).slice(0, 12);

		const normalizedQuestion = normalizeWhitespace(question).replace(/[?!.]+$/g, '');
		const questionLine = `Question explored: ${normalizedQuestion}?`;

		const descriptionCore = ai.description
			? trimToLength(normalizeWhitespace(ai.description), 4300)
			: trimToLength(normalizeWhitespace(answer), 850);

		const description = trimToLength(
			[descriptionCore, questionLine, hashtags.join(' '), 'Generated by The Earth App.']
				.filter(Boolean)
				.join('\n\n'),
			MAX_DESCRIPTION_LENGTH
		);

		return {
			title: pickBestTitle(ai.title, fallback.title),
			description,
			tags: mergedTags.length > 0 ? mergedTags : fallback.tags,
			categoryId: ai.categoryId ?? chooseCategoryIdFromText(`${question} ${answer} ${description}`),
			hashtags
		};
	} catch (error) {
		console.warn('AI metadata generation failed, using fallback metadata.', error);
		return fallback;
	}
}

async function uploadPrompt() {
	try {
		const props = readFileSync(resolve(WORKSPACE_ROOT, 'out/prompt.manifest.json'), 'utf-8');
		const { question, answer } = JSON.parse(props) as PromptManifest;

		if (!question || !answer) {
			throw new Error('Missing question or answer in prompt manifest');
		}

		console.log('Uploading video to YouTube:', question);

		const metadata = await buildOptimizedMetadata(question, answer);

		console.log('Optimized title:', metadata.title);
		console.log('Category:', metadata.categoryId);
		const res = await youtube.videos.insert({
			part: ['snippet', 'status'],
			requestBody: {
				snippet: {
					title: metadata.title,
					description: metadata.description,
					tags: metadata.tags,
					categoryId: metadata.categoryId
				},
				status: {
					privacyStatus: 'public',
					selfDeclaredMadeForKids: false
				}
			},
			media: {
				body: createReadStream(resolve(WORKSPACE_ROOT, 'out/prompt.mp4'))
			}
		});

		console.log('Video uploaded successfully:', res.data.id);
	} catch (error) {
		console.error('Error uploading video:', error);
		process.exit(1);
	}
}

// entrypoint

program.option('-t, --type <type>', 'Type of video to upload (prompt)');

program.parse();
const options = program.opts<{ type: string }>();

switch (options.type) {
	case 'prompt':
		await uploadPrompt();
		break;
	default:
		console.error('Invalid video type specified');
		process.exit(1);
}
