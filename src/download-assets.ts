import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const R2_BUCKET_BASE_URL = process.env.R2_BUCKET_BASE_URL ?? 'https://cdn.earth-app.com';
const configuredPrefix = process.env.R2_PREFIX ?? 'rain';
const RAIN_PREFIX = configuredPrefix.replace(/^\/+|\/+$/g, '');
const OUTPUT_ROOT = resolve(
	process.cwd(),
	process.env.DOWNLOADED_ASSETS_DIR ?? 'src/assets/downloaded'
);

const KNOWN_ASSET_PATHS = ['minecraft.mp4'];

function encodeS3Key(key: string): string {
	return key
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
}

async function downloadRainAsset(
	relativePath: string,
	index: number,
	total: number
): Promise<void> {
	const normalizedRelativePath = relativePath.replace(/^\/+/, '');
	if (!normalizedRelativePath || normalizedRelativePath.endsWith('/')) {
		return;
	}

	const objectKey = `${RAIN_PREFIX}/${normalizedRelativePath}`;
	const destinationPath = resolve(OUTPUT_ROOT, relativePath);
	const objectUrl = `${R2_BUCKET_BASE_URL.replace(/\/+$/, '')}/${encodeS3Key(objectKey)}`;

	console.log(`[${index + 1}/${total}] found ${objectKey}`);

	await mkdir(dirname(destinationPath), { recursive: true });

	const response = await fetch(objectUrl);
	if (!response.ok || !response.body) {
		const body = await response.text();
		const compactBody = body.replace(/\s+/g, ' ').trim().slice(0, 400);
		throw new Error(
			`Failed to download ${objectKey}: ${response.status} ${response.statusText || 'No body'}. Response: ${compactBody}`
		);
	}

	await Bun.write(destinationPath, response);
	console.log(`[${index + 1}/${total}] downloaded -> ${normalizedRelativePath}`);
}

async function main(): Promise<void> {
	const files = KNOWN_ASSET_PATHS.map((path) => path.trim()).filter(
		(path) => path.length > 0 && !path.endsWith('/')
	);

	if (files.length === 0) {
		console.log('No known assets configured to download.');
		return;
	}

	console.log(
		`Preparing to download ${files.length} known file(s) from ${R2_BUCKET_BASE_URL}/${RAIN_PREFIX}/`
	);
	console.log(`Output directory: ${OUTPUT_ROOT}`);

	for (const [index, filePath] of files.entries()) {
		await downloadRainAsset(filePath, index, files.length);
	}

	console.log(`Download complete: ${files.length}/${files.length} file(s) saved to ${OUTPUT_ROOT}`);
}

main().catch((error) => {
	console.error('Asset download failed.');
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
