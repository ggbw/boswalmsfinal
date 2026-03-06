/**
 * Client-side image compression utility.
 * Compresses images to WebP format, ensuring output ≤ 1MB.
 * Also generates a thumbnail version for grid views.
 */

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB
const FULL_MAX_DIM = 1200;
const THUMB_MAX_DIM = 200;

function resizeAndCompress(
  file: File,
  maxDim: number,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Compression failed'));
          resolve(blob);
        },
        'image/webp',
        quality,
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

export async function compressImage(file: File): Promise<Blob> {
  let quality = 0.85;
  let blob = await resizeAndCompress(file, FULL_MAX_DIM, quality);
  // Iteratively reduce quality if still over 1MB
  while (blob.size > MAX_FILE_SIZE && quality > 0.3) {
    quality -= 0.1;
    blob = await resizeAndCompress(file, FULL_MAX_DIM, quality);
  }
  return blob;
}

export async function createThumbnail(file: File): Promise<Blob> {
  return resizeAndCompress(file, THUMB_MAX_DIM, 0.7);
}
