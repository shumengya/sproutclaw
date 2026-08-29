import { applyExifOrientation } from "./exif-orientation.ts";
import { loadPhoton } from "./photon.ts";

export interface ImageResizeOptions {
	maxWidth?: number; // Default: 2000
	maxHeight?: number; // Default: 2000
	maxBytes?: number; // Default: 4.5MB of base64 payload (below Anthropic's 5MB limit)
	jpegQuality?: number; // Default: 80
}

export interface ResizedImage {
	data: string; // base64
	mimeType: string;
	originalWidth: number;
	originalHeight: number;
	width: number;
	height: number;
	wasResized: boolean;
}

// 4.5MB of base64 payload. Provides headroom below Anthropic's 5MB limit.
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;

const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
	maxWidth: 2000,
	maxHeight: 2000,
	maxBytes: DEFAULT_MAX_BYTES,
	jpegQuality: 80,
};

interface EncodedCandidate {
	data: string;
	encodedSize: number;
	mimeType: string;
}

/** Minimal Bun.Image surface we use (no @types/bun dependency). */
interface BunImagePipeline {
	metadata(): Promise<{ width: number; height: number; format?: string }>;
	resize(
		width: number,
		height?: number,
		options?: { fit?: "fill" | "inside"; withoutEnlargement?: boolean; filter?: string },
	): BunImagePipeline;
	jpeg(options?: { quality?: number }): BunImagePipeline;
	png(options?: { compressionLevel?: number }): BunImagePipeline;
	bytes(): Promise<Uint8Array>;
	toBase64(): Promise<string>;
}

interface BunImageConstructor {
	new (input: Uint8Array | ArrayBuffer, options?: { autoOrient?: boolean }): BunImagePipeline;
}

function getBunImage(): BunImageConstructor | undefined {
	if (typeof process.versions.bun !== "string") {
		return undefined;
	}
	const bun = (globalThis as { Bun?: { Image?: BunImageConstructor } }).Bun;
	return typeof bun?.Image === "function" ? bun.Image : undefined;
}

function encodeCandidate(buffer: Uint8Array, mimeType: string): EncodedCandidate {
	const data = Buffer.from(buffer).toString("base64");
	return {
		data,
		encodedSize: Buffer.byteLength(data, "utf-8"),
		mimeType,
	};
}

function fitInsideDimensions(
	originalWidth: number,
	originalHeight: number,
	maxWidth: number,
	maxHeight: number,
): { width: number; height: number } {
	let targetWidth = originalWidth;
	let targetHeight = originalHeight;

	if (targetWidth > maxWidth) {
		targetHeight = Math.round((targetHeight * maxWidth) / targetWidth);
		targetWidth = maxWidth;
	}
	if (targetHeight > maxHeight) {
		targetWidth = Math.round((targetWidth * maxHeight) / targetHeight);
		targetHeight = maxHeight;
	}

	return { width: targetWidth, height: targetHeight };
}

/**
 * Bun-native resize path (Bun.Image). Returns null on failure so callers can
 * fall back to Photon (Node / older Bun / missing API).
 */
async function resizeImageWithBun(
	inputBytes: Uint8Array,
	mimeType: string,
	opts: Required<ImageResizeOptions>,
): Promise<ResizedImage | null> {
	const Image = getBunImage();
	if (!Image) {
		return null;
	}

	// Bun borrows the buffer off-thread; pass a fixed copy.
	const owned = Uint8Array.from(inputBytes);
	const inputBase64Size = Math.ceil(owned.byteLength / 3) * 4;
	const format = mimeType.split("/")[1] ?? "png";

	const sourceMeta = await new Image(owned, { autoOrient: true }).metadata();
	const originalWidth = sourceMeta.width;
	const originalHeight = sourceMeta.height;

	if (originalWidth <= opts.maxWidth && originalHeight <= opts.maxHeight && inputBase64Size < opts.maxBytes) {
		return {
			data: Buffer.from(owned).toString("base64"),
			mimeType: mimeType || `image/${format}`,
			originalWidth,
			originalHeight,
			width: originalWidth,
			height: originalHeight,
			wasResized: false,
		};
	}

	const initial = fitInsideDimensions(originalWidth, originalHeight, opts.maxWidth, opts.maxHeight);
	const qualitySteps = Array.from(new Set([opts.jpegQuality, 85, 70, 55, 40]));
	let currentWidth = initial.width;
	let currentHeight = initial.height;

	while (true) {
		const candidates: EncodedCandidate[] = [];

		const pngBytes = await new Image(owned, { autoOrient: true })
			.resize(currentWidth, currentHeight, { fit: "inside", filter: "lanczos3" })
			.png()
			.bytes();
		candidates.push(encodeCandidate(pngBytes, "image/png"));

		for (const quality of qualitySteps) {
			const jpegBytes = await new Image(owned, { autoOrient: true })
				.resize(currentWidth, currentHeight, { fit: "inside", filter: "lanczos3" })
				.jpeg({ quality })
				.bytes();
			candidates.push(encodeCandidate(jpegBytes, "image/jpeg"));
		}

		for (const candidate of candidates) {
			if (candidate.encodedSize < opts.maxBytes) {
				const outMeta = await new Image(
					Buffer.from(candidate.data, "base64"),
					{ autoOrient: false },
				).metadata();
				return {
					data: candidate.data,
					mimeType: candidate.mimeType,
					originalWidth,
					originalHeight,
					width: outMeta.width,
					height: outMeta.height,
					wasResized: true,
				};
			}
		}

		if (currentWidth === 1 && currentHeight === 1) {
			break;
		}

		const nextWidth = currentWidth === 1 ? 1 : Math.max(1, Math.floor(currentWidth * 0.75));
		const nextHeight = currentHeight === 1 ? 1 : Math.max(1, Math.floor(currentHeight * 0.75));
		if (nextWidth === currentWidth && nextHeight === currentHeight) {
			break;
		}

		currentWidth = nextWidth;
		currentHeight = nextHeight;
	}

	return null;
}

async function resizeImageWithPhoton(
	inputBytes: Uint8Array,
	mimeType: string,
	opts: Required<ImageResizeOptions>,
): Promise<ResizedImage | null> {
	const inputBase64Size = Math.ceil(inputBytes.byteLength / 3) * 4;

	const photon = await loadPhoton();
	if (!photon) {
		return null;
	}

	let image: ReturnType<typeof photon.PhotonImage.new_from_byteslice> | undefined;
	try {
		const rawImage = photon.PhotonImage.new_from_byteslice(inputBytes);
		image = applyExifOrientation(photon, rawImage, inputBytes);
		if (image !== rawImage) rawImage.free();

		const originalWidth = image.get_width();
		const originalHeight = image.get_height();
		const format = mimeType.split("/")[1] ?? "png";

		// Check if already within all limits (dimensions AND encoded size)
		if (originalWidth <= opts.maxWidth && originalHeight <= opts.maxHeight && inputBase64Size < opts.maxBytes) {
			return {
				data: Buffer.from(inputBytes).toString("base64"),
				mimeType: mimeType || `image/${format}`,
				originalWidth,
				originalHeight,
				width: originalWidth,
				height: originalHeight,
				wasResized: false,
			};
		}

		const initial = fitInsideDimensions(originalWidth, originalHeight, opts.maxWidth, opts.maxHeight);

		function tryEncodings(width: number, height: number, jpegQualities: number[]): EncodedCandidate[] {
			const resized = photon!.resize(image!, width, height, photon!.SamplingFilter.Lanczos3);

			try {
				const candidates: EncodedCandidate[] = [encodeCandidate(resized.get_bytes(), "image/png")];
				for (const quality of jpegQualities) {
					candidates.push(encodeCandidate(resized.get_bytes_jpeg(quality), "image/jpeg"));
				}
				return candidates;
			} finally {
				resized.free();
			}
		}

		const qualitySteps = Array.from(new Set([opts.jpegQuality, 85, 70, 55, 40]));
		let currentWidth = initial.width;
		let currentHeight = initial.height;

		while (true) {
			const candidates = tryEncodings(currentWidth, currentHeight, qualitySteps);
			for (const candidate of candidates) {
				if (candidate.encodedSize < opts.maxBytes) {
					return {
						data: candidate.data,
						mimeType: candidate.mimeType,
						originalWidth,
						originalHeight,
						width: currentWidth,
						height: currentHeight,
						wasResized: true,
					};
				}
			}

			if (currentWidth === 1 && currentHeight === 1) {
				break;
			}

			const nextWidth = currentWidth === 1 ? 1 : Math.max(1, Math.floor(currentWidth * 0.75));
			const nextHeight = currentHeight === 1 ? 1 : Math.max(1, Math.floor(currentHeight * 0.75));
			if (nextWidth === currentWidth && nextHeight === currentHeight) {
				break;
			}

			currentWidth = nextWidth;
			currentHeight = nextHeight;
		}

		return null;
	} catch {
		return null;
	} finally {
		if (image) {
			image.free();
		}
	}
}

/**
 * Resize an image to fit within the specified max dimensions and encoded file size.
 * Returns null if the image cannot be resized below maxBytes.
 *
 * Prefer Bun.Image when running under Bun (compiled binary / bun runtime).
 * Falls back to Photon (Rust/WASM) for Node and when Bun.Image fails.
 *
 * Strategy for staying under maxBytes:
 * 1. First resize to maxWidth/maxHeight
 * 2. Try both PNG and JPEG formats, pick the smaller one
 * 3. If still too large, try JPEG with decreasing quality
 * 4. If still too large, progressively reduce dimensions until 1x1
 */
export async function resizeImageInProcess(
	inputBytes: Uint8Array,
	mimeType: string,
	options?: ImageResizeOptions,
): Promise<ResizedImage | null> {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	if (getBunImage()) {
		try {
			const bunResult = await resizeImageWithBun(inputBytes, mimeType, opts);
			if (bunResult) {
				return bunResult;
			}
		} catch {
			// Fall through to Photon.
		}
	}

	return resizeImageWithPhoton(inputBytes, mimeType, opts);
}
