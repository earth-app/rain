import { existsSync, statSync } from 'node:fs';
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
	const destDir = dirname(destinationPath);
	const objectUrl = `${R2_BUCKET_BASE_URL.replace(/\/+$/, '')}/${encodeS3Key(objectKey)}`;

	console.log(`\n[${index + 1}/${total}] Asset: ${relativePath}`);
	console.log(`  Source URL: ${objectUrl}`);
	console.log(`  Destination: ${destinationPath}`);
	console.log(`  Output directory: ${OUTPUT_ROOT}`);

	console.log(`  Creating directory: ${destDir}`);
	await mkdir(destDir, { recursive: true });
	console.log(`  ✓ Directory created/ready`);

	console.log(`  Fetching from ${objectUrl}...`);
	const response = await fetch(objectUrl);
	if (!response.ok || !response.body) {
		const body = await response.text();
		const compactBody = body.replace(/\s+/g, ' ').trim().slice(0, 400);
		throw new Error(
			`Failed to download ${objectKey}: ${response.status} ${response.statusText || 'No body'}. Response: ${compactBody}`
		);
	}

	console.log(`  Response status: ${response.status} ${response.statusText}`);
	console.log(`  Writing to: ${destinationPath}`);

	try {
		await Bun.write(destinationPath, response);
	} catch (writeError) {
		throw new Error(
			`Failed to write file to ${destinationPath}: ${writeError instanceof Error ? writeError.message : String(writeError)}`
		);
	}

	// Verify file was actually written
	if (!existsSync(destinationPath)) {
		throw new Error(`File write reported success but file does not exist at: ${destinationPath}`);
	}

	const stats = statSync(destinationPath);
	console.log(`  ✓ File written: ${stats.size} bytes`);
	console.log(`  ✓ File exists at: ${destinationPath}`);
	console.log(`[${index + 1}/${total}] ✓ Complete: ${relativePath}`);
}

async function main(): Promise<void> {
	const files = KNOWN_ASSET_PATHS.map((path) => path.trim()).filter(
		(path) => path.length > 0 && !path.endsWith('/')
	);

	if (files.length === 0) {
		console.log('No known assets configured to download.');
		return;
	}

	console.log(`\n════════════════════════════════════════════`);
	console.log(`Asset Download Configuration:`);
	console.log(`  Base URL: ${R2_BUCKET_BASE_URL}`);
	console.log(`  Prefix: ${RAIN_PREFIX}`);
	console.log(`  Output Root: ${OUTPUT_ROOT}`);
	console.log(`  Known Assets: ${KNOWN_ASSET_PATHS.join(', ')}`);
	console.log(`════════════════════════════════════════════\n`);

	console.log(`Preparing to download ${files.length} known file(s):\n`);

	for (const [index, filePath] of files.entries()) {
		await downloadRainAsset(filePath, index, files.length);
	}

	console.log(`\n════════════════════════════════════════════`);
	console.log(`✓ Download Complete: ${files.length}/${files.length} file(s) saved`);
	console.log(`  Output directory: ${OUTPUT_ROOT}`);

	// Verify all files exist
	console.log(`\nVerifying downloaded files:`);
	for (const filePath of files) {
		const destinationPath = resolve(OUTPUT_ROOT, filePath);
		if (existsSync(destinationPath)) {
			const stats = statSync(destinationPath);
			console.log(`  ✓ ${filePath} (${stats.size} bytes)`);
		} else {
			console.log(`  ✗ MISSING: ${filePath}`);
			console.log(`    Expected at: ${destinationPath}`);
			throw new Error(`Downloaded file not found: ${destinationPath}`);
		}
	}

	console.log(`════════════════════════════════════════════\n`);
}

main().catch((error) => {
	console.error('Asset download failed.');
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
