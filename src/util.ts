export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function randomBetween(min: number, max: number): number {
	if (max <= min) {
		return min;
	}

	return min + Math.random() * (max - min);
}

export function roundToMs(seconds: number): number {
	return Math.round(seconds * 1000) / 1000;
}

export function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

export function trimToLength(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}

	return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

export function countWords(text: string): number {
	const normalized = normalizeWhitespace(text);
	if (!normalized) {
		return 0;
	}

	return normalized.split(' ').length;
}

export function sanitizeSpokenText(text: string): string {
	return normalizeWhitespace(
		text
			.replace(/\r/g, '')
			.replace(/(^|\n)\s*[-*]\s+/g, '$1')
			.replace(/\n{2,}/g, '\n')
	);
}

export function trimTextToWordCount(text: string, maxWords: number): string {
	const normalized = normalizeWhitespace(text);
	const words = normalized.split(/\s+/);
	if (words.length <= maxWords) {
		return normalized;
	}

	const sentences = normalized.match(/[^.!?]+[.!?]?/g) ?? [normalized];
	const kept: string[] = [];
	let usedWords = 0;

	for (const sentence of sentences) {
		const sentenceWords = sentence.trim().split(/\s+/).filter(Boolean);
		if (sentenceWords.length === 0) {
			continue;
		}

		if (usedWords + sentenceWords.length > maxWords) {
			break;
		}

		kept.push(sentence.trim());
		usedWords += sentenceWords.length;
	}

	if (kept.length === 0) {
		return words.slice(0, maxWords).join(' ').trim();
	}

	return kept.join(' ').trim();
}

export function toPosixPath(path: string): string {
	return path.split('\\').join('/');
}

export function stripLeadingZeroes(value: string): string {
	return value.replace(/^0+/, '');
}

export function getJsonSnippet(value: unknown, maxLength = 500): string {
	try {
		const serialized = JSON.stringify(value);
		if (!serialized) {
			return '';
		}

		return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}...` : serialized;
	} catch {
		return '';
	}
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) {
		return null;
	}

	const jsonSlice = text.slice(start, end + 1);
	try {
		const parsed = JSON.parse(jsonSlice);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null;
		}

		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

export async function fetchJson<T>(url: string, errorLabel: string): Promise<T> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch ${errorLabel}: ${response.statusText}`);
	}

	return (await response.json()) as T;
}

const DEFAULT_STOP_WORDS = new Set([
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

export function toHashtag(value: string): string {
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

export function extractKeywords(
	text: string,
	limit: number,
	stopWords = DEFAULT_STOP_WORDS
): string[] {
	const counts = new Map<string, number>();
	const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

	for (const word of words) {
		if (word.length < 3 || stopWords.has(word)) {
			continue;
		}

		counts.set(word, (counts.get(word) ?? 0) + 1);
	}

	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([word]) => word)
		.slice(0, limit);
}

export function toTitleWord(value: string): string {
	if (!value) {
		return value;
	}

	return value[0]!.toUpperCase() + value.slice(1).toLowerCase();
}

export function toSentenceCase(text: string): string {
	const normalized = normalizeWhitespace(text);
	if (!normalized) {
		return '';
	}

	return normalized[0]!.toUpperCase() + normalized.slice(1);
}

export function choosePrimaryKeyword(
	question: string,
	answer: string,
	stopWords = DEFAULT_STOP_WORDS
): string {
	const questionWords = extractKeywords(question, 8, stopWords);
	const answerWords = extractKeywords(answer, 12, stopWords);
	const priorityWords = [...questionWords, ...answerWords];

	for (const word of priorityWords) {
		if (!stopWords.has(word) && word.length >= 4) {
			return word;
		}
	}

	return 'integrity';
}

export function toPhrase(words: string[]): string {
	return words.map((word) => toTitleWord(word)).join(' ');
}

export function dedupeTags(tags: string[], maxTags = 30, maxChars = 460): string[] {
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

		if (deduped.length >= maxTags) {
			break;
		}

		const prospectiveChars = totalChars + normalized.length;
		if (prospectiveChars > maxChars) {
			break;
		}

		seen.add(key);
		deduped.push(normalized);
		totalChars = prospectiveChars;
	}

	return deduped;
}

export function buildDynamicTags(question: string, answer: string): string[] {
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

export function chooseCategoryIdFromText(text: string): string {
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
		return '28';
	}

	if (educationScore >= 2) {
		return '27';
	}

	return '22';
}

export function buildTranscriptBlock(question: string, answer: string): string {
	return [
		'Full transcript',
		'',
		`Prompt: ${normalizeWhitespace(question)}`,
		'',
		`Response: ${normalizeWhitespace(answer)}`
	].join('\n');
}

export function buildFallbackTitle(question: string): string {
	const normalizedQuestion = normalizeWhitespace(question).replace(/[?!.]+$/g, '');
	if (!normalizedQuestion) {
		return 'Curiosity Prompt: Think Deeper Today';
	}

	const primaryKeyword = choosePrimaryKeyword(question, normalizedQuestion);
	const lowered = normalizedQuestion.toLowerCase();
	const keywordTitle = toTitleWord(primaryKeyword);

	const pickByKeyword = (options: string[]): string => {
		const score = [...primaryKeyword].reduce((acc, char) => acc + char.charCodeAt(0), 0);
		const idx = score % options.length;
		return options[idx] ?? options[0] ?? normalizedQuestion;
	};

	if (lowered.startsWith('why ')) {
		return trimToLength(
			pickByKeyword([
				`Why ${keywordTitle} Matters More Than It Seems`,
				`Why ${keywordTitle} Quietly Decides Better Outcomes`,
				`${keywordTitle}: The Hidden Advantage Most People Miss`
			]),
			100
		);
	}

	if (lowered.startsWith('how ')) {
		return trimToLength(
			pickByKeyword([
				`How ${keywordTitle} Changes Outcomes Fast`,
				`How ${keywordTitle} Turns Good Effort Into Better Results`,
				`${keywordTitle}: A Practical Edge You Can Use Today`
			]),
			100
		);
	}

	if (lowered.startsWith('when ')) {
		return trimToLength(
			pickByKeyword([
				`When ${keywordTitle} Starts Changing Everything`,
				`When ${keywordTitle} Becomes Your Competitive Advantage`,
				`${keywordTitle}: The Moment It Starts Driving Better Results`
			]),
			100
		);
	}

	if (lowered.startsWith('can ')) {
		return trimToLength(
			pickByKeyword([
				`Can ${keywordTitle} Really Change Results?`,
				`Can ${keywordTitle} Be the Difference Between Good and Great?`,
				`${keywordTitle}: Small Shift, Big Outcome`
			]),
			100
		);
	}

	if (lowered.startsWith('what ')) {
		return trimToLength(
			pickByKeyword([
				`What ${keywordTitle} Reveals About Better Outcomes`,
				`What ${keywordTitle} Changes in Real Life`,
				`${keywordTitle}: What Most People Get Wrong`
			]),
			100
		);
	}

	return trimToLength(
		pickByKeyword([
			`${keywordTitle} Can Quietly Change Everything`,
			`${keywordTitle}: The Overlooked Lever for Better Results`,
			`Why ${keywordTitle} Is More Powerful Than It Looks`
		]),
		100
	);
}

export function buildFallbackHashtags(question: string, answer: string, tags: string[]): string[] {
	const baseTags = [
		'theearthapp',
		'earthapp',
		'shorts',
		'ai',
		'curiosity',
		'insights',
		'growth',
		'learning',
		'question',
		'answer',
		...extractKeywords(`${question} ${answer}`, 8),
		...tags.slice(0, 6)
	];

	return dedupeTags(
		baseTags.map((tag) => toHashtag(tag)),
		15,
		200
	).slice(0, 15);
}
