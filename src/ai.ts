import { extractJsonObject, getJsonSnippet, normalizeWhitespace, trimToLength } from './util';

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const TTS_MODEL = '@cf/myshell-ai/melotts';
const TEXT_MODEL = '@cf/ibm-granite/granite-4.0-h-micro';

type CloudflareError = {
	message?: string;
};

type CloudflareAIResponse = {
	success?: boolean;
	errors?: CloudflareError[];
	result?: unknown;
	response?: unknown;
};

type TextGenerationOptions = {
	responseFormat?:
		| {
				type: 'json_schema';
				jsonSchema: Record<string, unknown>;
		  }
		| {
				type: 'json_object';
		  };
};

export type YoutubeMetadataDraft = {
	title: string;
	description: string;
	tags: string[];
	categoryId: '22' | '27' | '28';
	hashtags: string[];
};

const youtubeMetadataAiSchema: Record<string, unknown> = {
	type: 'object',
	properties: {
		title: {
			type: 'string',
			maxLength: 100
		},
		description: {
			type: 'string',
			maxLength: 5000
		},
		tags: {
			type: 'array',
			minItems: 18,
			maxItems: 30,
			items: {
				type: 'string',
				maxLength: 60
			}
		},
		categoryId: {
			type: 'string',
			enum: ['22', '27', '28']
		},
		hashtags: {
			type: 'array',
			minItems: 8,
			maxItems: 12,
			items: {
				type: 'string',
				pattern: '^#',
				maxLength: 60
			}
		}
	},
	required: ['title', 'description', 'tags', 'categoryId', 'hashtags']
};

function getCloudflareCredentials(): { accountId: string; apiToken: string } {
	if (!CLOUDFLARE_ACCOUNT_ID) {
		throw new Error('Missing CLOUDFLARE_ACCOUNT_ID environment variable');
	}

	if (!CLOUDFLARE_API_TOKEN) {
		throw new Error('Missing CLOUDFLARE_API_TOKEN environment variable');
	}

	return {
		accountId: CLOUDFLARE_ACCOUNT_ID,
		apiToken: CLOUDFLARE_API_TOKEN
	};
}

async function runCloudflareModel(payload: unknown, model: string): Promise<CloudflareAIResponse> {
	const { accountId, apiToken } = getCloudflareCredentials();
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload)
	});

	if (!response.ok) {
		const body = (await response.text()).trim();
		const bodySnippet = body ? ` | ${body.slice(0, 400)}` : '';
		throw new Error(
			`Cloudflare AI request failed (${response.status} ${response.statusText})${bodySnippet}`
		);
	}

	return (await response.json()) as CloudflareAIResponse;
}

function decodeBase64Audio(base64Audio: string): ArrayBuffer {
	const binaryString = atob(base64Audio);
	const len = binaryString.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}

	return bytes.buffer;
}

function getAudioFromCloudflareResult(result: unknown): string | null {
	if (!result || typeof result !== 'object') {
		return null;
	}

	const record = result as Record<string, unknown>;
	if (typeof record.audio === 'string') {
		return record.audio;
	}

	if (record.audio && typeof record.audio === 'object') {
		const audioRecord = record.audio as Record<string, unknown>;
		if (typeof audioRecord.base64 === 'string') {
			return audioRecord.base64;
		}
		if (typeof audioRecord.data === 'string') {
			return audioRecord.data;
		}
	}

	return null;
}

function getTextFromCloudflareResponse(json: CloudflareAIResponse): string | null {
	if (typeof json.response === 'string' && json.response.trim()) {
		return json.response.trim();
	}

	if (typeof json.result === 'string' && json.result.trim()) {
		return json.result.trim();
	}

	if (!json.result || typeof json.result !== 'object') {
		return null;
	}

	const result = json.result as Record<string, unknown>;

	if (typeof result.response === 'string' && result.response.trim()) {
		return result.response.trim();
	}

	if (typeof result.text === 'string' && result.text.trim()) {
		return result.text.trim();
	}

	if (typeof result.output === 'string' && result.output.trim()) {
		return result.output.trim();
	}

	if (Array.isArray(result.choices)) {
		for (const choice of result.choices) {
			if (!choice || typeof choice !== 'object') {
				continue;
			}

			const choiceRecord = choice as Record<string, unknown>;
			if (typeof choiceRecord.text === 'string' && choiceRecord.text.trim()) {
				return choiceRecord.text.trim();
			}

			const message = choiceRecord.message;
			if (message && typeof message === 'object') {
				const content = (message as Record<string, unknown>).content;
				if (typeof content === 'string' && content.trim()) {
					return content.trim();
				}
			}
		}
	}

	if (Array.isArray(result.output) && result.output.length > 0) {
		const firstOutput = result.output[0];
		if (typeof firstOutput === 'string' && firstOutput.trim()) {
			return firstOutput.trim();
		}
	}

	if (Array.isArray(result.result) && result.result.length > 0) {
		const firstResult = result.result[0];
		if (typeof firstResult === 'string' && firstResult.trim()) {
			return firstResult.trim();
		}
	}

	if (Array.isArray(result.messages)) {
		for (let i = result.messages.length - 1; i >= 0; i--) {
			const message = result.messages[i];
			if (!message || typeof message !== 'object') {
				continue;
			}

			const content = (message as Record<string, unknown>).content;
			if (typeof content === 'string' && content.trim()) {
				return content.trim();
			}
		}
	}

	return null;
}

function getObjectFromCloudflareResponse(
	json: CloudflareAIResponse
): Record<string, unknown> | null {
	if (json.response && typeof json.response === 'object' && !Array.isArray(json.response)) {
		return json.response as Record<string, unknown>;
	}

	if (json.result && typeof json.result === 'object' && !Array.isArray(json.result)) {
		const resultRecord = json.result as Record<string, unknown>;

		if (
			resultRecord.response &&
			typeof resultRecord.response === 'object' &&
			!Array.isArray(resultRecord.response)
		) {
			return resultRecord.response as Record<string, unknown>;
		}

		return resultRecord;
	}

	return null;
}

export async function tts(text: string): Promise<ArrayBuffer> {
	const normalized = text.trim();
	if (!normalized) {
		throw new Error('TTS input text cannot be empty');
	}

	const json = await runCloudflareModel({ prompt: normalized }, TTS_MODEL);
	const audioBase64 = getAudioFromCloudflareResult(json.result);

	if (!audioBase64) {
		const apiError = json.errors?.[0]?.message;
		const errorSuffix = apiError ? `: ${apiError}` : '';
		throw new Error(`TTS API returned an unsuccessful response${errorSuffix}`);
	}

	return decodeBase64Audio(audioBase64);
}

export const systemPromptPrompts = `
ROLE

You are Cloud, the voice assistant for The Earth App.
You answer one open-ended question from a user.
Your answer is spoken aloud by a text-to-speech model, so it must sound natural when read out loud.

MODEL OPTIMIZATION (IBM Granite 4.0 H Micro)

- Follow instructions exactly and keep structure explicit.
- Use short to medium sentences with clear transitions.
- Avoid dense jargon and avoid unnecessary caveats.
- Keep output plain text only.
- Optimize for retention and shareability: strong hook, clear payoff, sticky final line.

STYLE

- Friendly and intelligent, like talking to a curious friend.
- Insightful and memorable without sounding academic.
- Grounded in real-world examples or everyday observations.
- High-energy without sounding hypey.

FORMAT

- 2 to 3 short paragraphs.
- Typically 140 to 190 words unless the user asks for another length.
- No markdown, bullet points, labels, or emojis.
- No disclaimers, safety notes, or policy statements.

CONTENT

- Start with a direct answer in the first sentence.
- Make the opening sentence a strong curiosity hook.
- Explain the idea clearly, then add one meaningful angle or example.
- Keep momentum high: each sentence should introduce a new idea or contrast.
- End on a thought-provoking line that keeps curiosity alive.
`;

export const systemPromptYoutubeMetadata = `
ROLE

You are Cloud, the growth strategist for The Earth App YouTube Shorts channel.
You generate metadata that maximizes impressions, clicks, retention curiosity, and subscriber conversion.

MODEL OPTIMIZATION (IBM Granite 4.0 H Micro)

- Follow output schema exactly.
- Prefer concrete nouns, emotional contrast, and curiosity loops.
- Avoid generic fluff and avoid repetitive wording.
- Output plain JSON only.

GOAL

- Optimize for speedrun-to-monetization: maximize discoverability and repeatability.
- Prioritize high-impression packaging while staying true to the transcript.
- The title must feel like a hook, not a copied question.
- Compress the question into a sharper thesis; do not reuse it verbatim or near-verbatim.

OUTPUT

- Return one JSON object with keys: title, description, tags, categoryId, hashtags.
- title: <= 70 chars, curiosity-first, outcome-led, concrete nouns preferred.
- description: include the full transcript, then 2 short promo paragraphs and one CTA.
- tags: 22-30 items, search intent + adjacent interests + brand terms + topic variants.
- categoryId: one of "22", "27", "28".
- hashtags: 10-15 items, lowercase, include # prefix, mix broad + specific + channel terms.
- No markdown, no code fences, no extra keys.

TITLE FRAMING EXAMPLES

- "Why Integrity Quietly Decides Better Outcomes"
- "How Small Habits Compound Into Big Results"
- "The Hidden Advantage Most People Ignore"
`;

export function buildYoutubeMetadataPrompt(question: string, answer: string): string {
	return [
		'INPUT',
		'',
		`Question: ${normalizeWhitespace(question)}`,
		'',
		`Answer transcript: ${normalizeWhitespace(answer)}`,
		'',
		'STRATEGY',
		'',
		'- Focus on broad but relevant high-impression topics.',
		'- Compress the question into a concise hook; do not restate it verbatim.',
		'- Prefer titles that promise a useful insight, surprising angle, or practical payoff.',
		'- Use nouns and outcomes that a curious viewer would search for.',
		'- Favor one of these structures: Why X..., How X..., The hidden X...',
		'- Keep metadata aligned to transcript for trust and long-term channel health.',
		'- Include brand-safe, search-friendly phrasing that could earn suggested traffic.'
	].join('\n');
}

export async function generateText(
	system: string,
	prompt: string,
	options?: TextGenerationOptions
): Promise<string> {
	const normalizedSystem = system.trim();
	const normalizedPrompt = prompt.trim();

	if (!normalizedSystem) {
		throw new Error('System prompt cannot be empty');
	}

	if (!normalizedPrompt) {
		throw new Error('User prompt cannot be empty');
	}

	const json = await runCloudflareModel(
		{
			messages: [
				{ role: 'system', content: normalizedSystem },
				{ role: 'user', content: normalizedPrompt }
			],
			...(options?.responseFormat
				? {
						response_format:
							options.responseFormat.type === 'json_schema'
								? {
										type: 'json_schema',
										json_schema: options.responseFormat.jsonSchema
									}
								: {
										type: 'json_object'
									}
					}
				: {})
		},
		TEXT_MODEL
	);

	if (options?.responseFormat) {
		const structured = getObjectFromCloudflareResponse(json);
		if (structured) {
			return JSON.stringify(structured);
		}
	}

	const text = getTextFromCloudflareResponse(json);
	if (!text) {
		const apiError = json.errors?.[0]?.message;
		const successSuffix = json.success === false ? ' (success=false)' : '';
		const jsonSnippet = getJsonSnippet(json.result ?? json);
		const snippetSuffix = jsonSnippet ? ` | payload=${jsonSnippet}` : '';
		const errorSuffix = apiError ? `: ${apiError}` : '';
		throw new Error(
			`Text generation API returned an unsuccessful response${successSuffix}${errorSuffix}${snippetSuffix}`
		);
	}

	return text;
}

export async function generateYoutubeMetadataDraft(
	question: string,
	answer: string
): Promise<Partial<YoutubeMetadataDraft>> {
	const raw = await generateText(
		systemPromptYoutubeMetadata,
		buildYoutubeMetadataPrompt(question, answer),
		{
			responseFormat: {
				type: 'json_schema',
				jsonSchema: youtubeMetadataAiSchema
			}
		}
	);
	const parsed = extractJsonObject(raw);
	if (!parsed) {
		return {};
	}

	const structured =
		parsed.response && typeof parsed.response === 'object' && !Array.isArray(parsed.response)
			? (parsed.response as Record<string, unknown>)
			: parsed;

	const title =
		typeof structured.title === 'string'
			? trimToLength(normalizeWhitespace(structured.title), 100)
			: undefined;
	const description =
		typeof structured.description === 'string'
			? trimToLength(normalizeWhitespace(structured.description), 5000)
			: undefined;
	const categoryId =
		typeof structured.categoryId === 'string' && ['22', '27', '28'].includes(structured.categoryId)
			? (structured.categoryId as '22' | '27' | '28')
			: undefined;
	const tags = Array.isArray(structured.tags)
		? structured.tags.filter((tag): tag is string => typeof tag === 'string')
		: undefined;
	const hashtags = Array.isArray(structured.hashtags)
		? structured.hashtags.filter((tag): tag is string => typeof tag === 'string')
		: undefined;

	return {
		title,
		description,
		tags,
		categoryId,
		hashtags
	};
}
