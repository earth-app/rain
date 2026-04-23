import { fileURLToPath } from 'bun';
import { CanvasRenderingContext2D, createCanvas, Image, registerFont } from 'canvas';

export const NOTO_SANS = registerFont(
	fileURLToPath(new URL('../assets/NotoSans.ttf', import.meta.url)),
	{
		family: 'Noto Sans',
		weight: '400'
	}
);

export function addWatermark(ctx: CanvasRenderingContext2D) {
	// Green diagonal corner in top left (diagonal fill)
	const size = 350;
	ctx.fillStyle = 'rgb(20, 112, 0)';
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.lineTo(0, size);
	ctx.lineTo(size, 0);
	ctx.closePath();
	ctx.fill();

	// Dark blue bar footer in bottom
	const height = 120;
	ctx.fillStyle = 'rgba(19, 45, 245, 0.5)';
	ctx.fillRect(0, ctx.canvas.height - height, ctx.canvas.width, height);

	ctx.font = '28px "Noto Sans"';

	// The Earth App icon - bottom left corner, 20px from the edges
	const logo = new Image();
	const logoSize = 64;
	logo.onload = () => {
		ctx.drawImage(logo, 20, ctx.canvas.height - logoSize - 20, logoSize, logoSize);
	};
	logo.src = fileURLToPath(new URL('./assets/earth-app.png', import.meta.url));

	// Cloud icon - bottom right corner, 20px from the edges
	const cloud = new Image();
	const cloudSize = 64;
	cloud.onload = () => {
		ctx.drawImage(
			cloud,
			ctx.canvas.width - cloudSize - 20,
			ctx.canvas.height - cloudSize - 20,
			cloudSize,
			cloudSize
		);
	};
	cloud.src = fileURLToPath(new URL('./assets/cloud.png', import.meta.url));

	// Text - bottom left corner, center vertically with the logo
	ctx.fillStyle = 'rgb(0, 0, 0)';
	ctx.fillText('@theearthapp', 100, ctx.canvas.height - logoSize / 2 - 13);
}

export function fillIn(
	title: string,
	subtitle: string,
	description: string,
	icon: string,
	baseY: number = 130,
	ctx: CanvasRenderingContext2D
) {
	ctx.font = 'bold 48px "Noto Sans"';

	// Icon URL - top center, below the cloud
	const iconImage = new Image();
	const iconSize = 128;
	return new Promise<void>((resolve) => {
		iconImage.onload = () => {
			// tint white
			const tempCanvas = createCanvas(iconSize, iconSize);
			const tempCtx = tempCanvas.getContext('2d')!;
			tempCtx.drawImage(iconImage, 0, 0, iconSize, iconSize);
			tempCtx.globalCompositeOperation = 'source-in';
			tempCtx.fillStyle = 'white';
			tempCtx.fillRect(0, 0, iconSize, iconSize);
			ctx.drawImage(tempCanvas, ctx.canvas.width / 2 - iconSize / 2, baseY, iconSize, iconSize);

			// Title - top center, below the icon; enable word wrap if too long, text align center
			let titleY = baseY + iconSize + 60;
			{
				ctx.fillStyle = 'rgb(255, 255, 255)';
				const size = Math.max(24, 52 - Math.floor(title.length / 20));
				ctx.font = `bold ${size}px "Noto Sans"`;
				const maxWidth = ctx.canvas.width - 150;
				const words = title.split(' ');
				let line = '';
				for (const word of words) {
					const testLine = line + word + ' ';
					const testMetrics = ctx.measureText(testLine);
					if (testMetrics.width > maxWidth && line) {
						ctx.fillText(line, ctx.canvas.width / 2 - ctx.measureText(line).width / 2, titleY);
						line = word + ' ';
						titleY += size * 1.2; // line height
					} else {
						line = testLine;
					}
				}
				if (line) {
					ctx.fillText(line, ctx.canvas.width / 2 - ctx.measureText(line).width / 2, titleY);
				}
			}

			// Subtitle - below title
			ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
			ctx.font = 'italic 32px "Noto Sans"';
			const subtitleMetrics = ctx.measureText(subtitle);
			ctx.fillText(subtitle, ctx.canvas.width / 2 - subtitleMetrics.width / 2, titleY + 50);

			// Description - below subtitle; enable word wrap if too long
			ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
			{
				const size = Math.max(16, 36 - Math.floor(description.length / 100));
				const lineHeight = size * 1.2;

				ctx.font = `${size}px "Noto Sans"`;
				const maxWidth = ctx.canvas.width - 100; // 50px padding on each side
				const words = description.split(' ');
				let line = '';
				let y = titleY + 100;
				for (const word of words) {
					const testLine = line + word + ' ';
					const testMetrics = ctx.measureText(testLine);
					if (testMetrics.width > maxWidth && line) {
						ctx.fillText(line, 50, y);
						line = word + ' ';
						y += lineHeight; // line height
					} else {
						line = testLine;
					}
				}
				if (line) {
					ctx.fillText(line, 50, y);
				}
			}

			resolve();
		};
		iconImage.src = icon;
	});
}
