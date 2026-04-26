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
