const API_ROOT = process.env.API_ROOT || 'https://api.earth-app.com';
const FRONTEND_ROOT = process.env.FRONTEND_ROOT || 'https://app.earth-app.com';

export async function getRandomActivities(
	count: number = 1
): Promise<{ name: string; description: string; types: string[]; fields: { icon?: string } }[]> {
	const response = await fetch(`${API_ROOT}/v2/activities/random?count=${count}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch activities: ${response.statusText}`);
	}

	return (await response.json()) as any[];
}

export async function getRandomEvents(count: number = 1): Promise<
	{
		id: string;
		name: string;
		description: string;
		host: {
			username: string;
		};
		type: 'IN_PERSON' | 'ONLINE' | 'HYBRID';
	}[]
> {
	const response = await fetch(`${API_ROOT}/v2/events/random?count=${count}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch events: ${response.statusText}`);
	}

	return (await response.json()) as any[];
}

export async function getRandomPrompts(count: number = 1): Promise<
	{
		id: string;
		prompt: string;
		responses_count: number;
		owner: {
			username: string;
		};
	}[]
> {
	const response = await fetch(`${API_ROOT}/v2/prompts/random?count=${count}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch prompts: ${response.statusText}`);
	}

	return (await response.json()) as any[];
}

export async function getRandomArticles(count: number = 1): Promise<
	{
		id: string;
		title: string;
		description: string;
		content: string;
		author: {
			username: string;
		};
	}[]
> {
	const response = await fetch(`${API_ROOT}/v2/articles/random?count=${count}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch articles: ${response.statusText}`);
	}

	return (await response.json()) as any[];
}

export function iconURL(fullName: string, size: number = 64): string {
	const [prefix, name] = fullName.split(':', 2);
	return `https://api.iconify.design/${prefix}/${name}.svg?height=${size}`;
}

export function eventThumbnailURL(eventId: string): string {
	return `${FRONTEND_ROOT}/api/event/thumbnail?id=${eventId}`;
}
