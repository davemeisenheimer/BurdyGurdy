import {
  imageTypeError,
  imageSizeError,
  shouldScaleImage,
  scaledImageSize,
  MAILOUT_IMAGE_UPLOAD_WIDTH,
} from '../../../lib/mailout';

/**
 * Checks an image file and scales it down in the browser if it's wider than the upload limit,
 * so recipients don't download multi-MB screenshots. Throws a user-facing message on failure.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; width: number }> {
  const typeError = imageTypeError(file.type);
  if (typeError) throw new Error(typeError);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Could not read that image.');
  }
  try {
    let blob: Blob = file;
    let width = bitmap.width;
    if (shouldScaleImage(file.type, bitmap.width)) {
      const size = scaledImageSize(bitmap.width, bitmap.height, MAILOUT_IMAGE_UPLOAD_WIDTH);
      const canvas = document.createElement('canvas');
      canvas.width  = size.width;
      canvas.height = size.height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height);
      const scaled = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, file.type, 0.85));
      if (!scaled) throw new Error('Could not resize that image.');
      blob  = scaled;
      width = size.width;
    }
    const sizeError = imageSizeError(blob.size);
    if (sizeError) throw new Error(sizeError);
    return { blob, width };
  } finally {
    bitmap.close();
  }
}
