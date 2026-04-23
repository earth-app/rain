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

function getJsonSnippet(value: unknown): string {
	try {
		const serialized = JSON.stringify(value);
		if (!serialized) {
			return '';
		}

		return serialized.length > 500 ? `${serialized.slice(0, 500)}...` : serialized;
	} catch {
		return '';
	}
}

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

STYLE

- Friendly and intelligent, like talking to a curious friend.
- Insightful and memorable without sounding academic.
- Grounded in real-world examples or everyday observations.

FORMAT

- 2 to 3 short paragraphs.
- Typically 140 to 190 words unless the user asks for another length.
- No markdown, bullet points, labels, or emojis.
- No disclaimers, safety notes, or policy statements.

CONTENT

- Start with a direct answer in the first sentence.
- Explain the idea clearly, then add one meaningful angle or example.
- End on a thought-provoking line that keeps curiosity alive.
`;

export async function generateText(system: string, prompt: string): Promise<string> {
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
			]
		},
		TEXT_MODEL
	);

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
