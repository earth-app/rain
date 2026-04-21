import { createCanvas, Image, type CanvasRenderingContext2D } from 'canvas';
import { program } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import {
	eventThumbnailURL,
	getRandomActivities,
	getRandomArticles,
	getRandomEvents,
	getRandomPrompts,
	iconURL
} from './api';
import { addWatermark, fillIn } from './canvas';

function start(): CanvasRenderingContext2D {
	const canvas = createCanvas(1080, 1080);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#136df5';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	return ctx;
}

async function randomActivity(): Promise<CanvasRenderingContext2D> {
	const ctx = start();

	const activities = await getRandomActivities();
	if (activities.length === 0) {
		throw new Error('No activities found');
	}

	const activity = activities[0]!;

	console.log('Fetched random activity:', activity.name);

	const header = 'Activity of the Day';
	ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
	ctx.font = '24px "Noto Sans"';
	ctx.fillText(header, ctx.canvas.width / 2 - ctx.measureText(header).width / 2, 40);

	await fillIn(
		activity.name,
		'',
		activity.description,
		iconURL(activity.fields.icon || 'mdi:earth'),
		130,
		ctx
	);

	return ctx;
}

async function randomPrompt(): Promise<CanvasRenderingContext2D> {
	const ctx = start();

	const prompts = await getRandomPrompts();
	if (prompts.length === 0) {
		throw new Error('No prompts found');
	}

	const prompt = prompts[0]!;

	console.log('Fetched random prompt:', prompt.prompt);

	const header = 'Prompt of the Day';
	ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
	ctx.font = '24px "Noto Sans"';
	ctx.fillText(header, ctx.canvas.width / 2 - ctx.measureText(header).width / 2, 40);

	// remove leading zeroes
	const id = prompt.id.replace(/^0+/, '');
	await fillIn(
		prompt.prompt,
		`By @${prompt.owner.username} | #${id}`,
		'',
		iconURL('mdi:lightbulb-on'),
		330,
		ctx
	);

	return ctx;
}

async function randomEvent(): Promise<CanvasRenderingContext2D> {
	const ctx = start();

	const events = await getRandomEvents();
	if (events.length === 0) {
		throw new Error('No events found');
	}

	const event = events[0]!;
	console.log('Fetched random event:', event.name);

	const header = 'Event of the Day';
	ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
	ctx.font = '24px "Noto Sans"';
	ctx.fillText(header, ctx.canvas.width / 2 - ctx.measureText(header).width / 2, 40);

	const type =
		event.type === 'IN_PERSON' ? 'In-Person' : event.type === 'ONLINE' ? 'Online' : 'Hybrid';

	// remove leading zeroes
	const id = event.id.replace(/^0+/, '');
	await fillIn(
		event.name,
		`Hosted by @${event.host.username} - ${type} | #${id}`,
		'',
		iconURL('mdi:calendar-star'),
		130,
		ctx
	);

	// Event Thumbnail - below fillIn content, centered

	const thumbnailURL = eventThumbnailURL(event.id);
	const thumbnailWidth = 720;
	const thumbnailHeight = thumbnailWidth * (9 / 16);

	try {
		const thumbnailResponse = await fetch(thumbnailURL);
		if (!thumbnailResponse.ok) {
			console.warn(
				`Failed to fetch event thumbnail (${thumbnailResponse.status}), skipping thumbnail`
			);
			return ctx;
		}

		const contentType = thumbnailResponse.headers.get('content-type')?.toLowerCase() ?? '';
		if (!contentType.startsWith('image/')) {
			console.warn(
				`Unexpected thumbnail response type "${contentType || 'unknown'}", skipping thumbnail`
			);
			return ctx;
		}

		const thumbnailImage = new Image();
		const thumbnailBuffer = Buffer.from(await thumbnailResponse.arrayBuffer());

		await new Promise<void>((resolve) => {
			thumbnailImage.onload = () => {
				ctx.drawImage(
					thumbnailImage,
					ctx.canvas.width / 2 - thumbnailWidth / 2,
					450,
					thumbnailWidth,
					thumbnailHeight
				);
				resolve();
			};
			thumbnailImage.onerror = (err) => {
				console.warn('Failed to decode event thumbnail, skipping', err);
				resolve();
			};
			thumbnailImage.src = thumbnailBuffer;
		});
	} catch (error) {
		console.warn('Failed to load event thumbnail, skipping', error);
	}

	return ctx;
}

async function randomArticle(): Promise<CanvasRenderingContext2D> {
	const ctx = start();

	const header = 'Article of the Day';
	ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
	ctx.font = '24px "Noto Sans"';
	ctx.fillText(header, ctx.canvas.width / 2 - ctx.measureText(header).width / 2, 40);

	const articles = await getRandomArticles();
	if (articles.length === 0) {
		throw new Error('No articles found');
	}

	const article = articles[0]!;
	console.log('Fetched random article:', article.title);

	const contentLength = 300;
	const trimmedContent =
		article.content.length > contentLength
			? article.content.substring(0, contentLength - 3) + '...'
			: article.content;

	// remove leading zeroes
	const id = article.id.replace(/^0+/, '');
	await fillIn(
		article.title,
		`By @${article.author.username} | #${id}`,
		trimmedContent,
		iconURL('mdi:file-document-edit'),
		130,
		ctx
	);

	return ctx;
}

// entrypoint

program.option(
	'-t, --type <type>',
	'Type of content to generate (activity, event, prompt, article)'
);

program.parse();
const options = program.opts<{ type: string }>();

let ctx: CanvasRenderingContext2D | null = null;
switch (options.type) {
	case 'activity':
		ctx = await randomActivity();
		break;
	case 'prompt':
		ctx = await randomPrompt();
		break;
	case 'event':
		ctx = await randomEvent();
		break;
	case 'article':
		ctx = await randomArticle();
		break;
}

if (!ctx) {
	console.error('Invalid content type specified. Use "activity", "event", "prompt", or "article".');
	process.exit(1);
}

addWatermark(ctx);
ctx.save();
console.log(`Generated ${options.type} content successfully! Saving...`);

const output = ctx.canvas.toBuffer('image/png');

if (!existsSync('out')) {
	mkdirSync('out');
	console.log('Created output directory');
}

writeFileSync(`out/${options.type}.png`, output);
console.log(`Generated ${options.type}.png successfully!`);
