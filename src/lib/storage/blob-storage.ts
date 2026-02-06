import { put, del, list, BlobAccessError } from '@vercel/blob';
import { sanitizeStorageObjectName } from './sanitize-object-name';

const BLOB_PREFIX = 'papers';

export function generateBlobPath(userId: string, fileName: string): string {
  const timestamp = Date.now();
  const { sanitized } = sanitizeStorageObjectName(fileName);
  return `${BLOB_PREFIX}/${userId}/${timestamp}-${sanitized}`;
}

export async function uploadPdfToBlob(
  blobPath: string,
  fileBuffer: Buffer,
  options?: { contentType?: string }
): Promise<{ url: string; pathname: string }> {
  const blob = await put(blobPath, fileBuffer, {
    access: 'public',
    contentType: options?.contentType || 'application/pdf',
  });
  
  return {
    url: blob.url,
    pathname: blob.pathname,
  };
}

export async function deletePdfFromBlob(blobUrl: string): Promise<void> {
  try {
    await del(blobUrl);
  } catch (error) {
    if (error instanceof BlobAccessError) {
      return;
    }
    throw error;
  }
}

export async function deleteMultiplePdfsFromBlob(blobUrls: string[]): Promise<void> {
  if (blobUrls.length === 0) return;
  
  try {
    await del(blobUrls);
  } catch {
    // Continue even if some files fail to delete
  }
}

export async function listUserPdfs(userId: string) {
  const prefix = `${BLOB_PREFIX}/${userId}/`;
  const { blobs } = await list({ prefix });
  return blobs;
}

export function extractBlobPathname(blobUrl: string): string {
  try {
    const url = new URL(blobUrl);
    return url.pathname.slice(1);
  } catch {
    return blobUrl;
  }
}

export function isVercelBlobUrl(url: string): boolean {
  return url.includes('.blob.vercel-storage.com') || url.includes('vercel-storage.com');
}
