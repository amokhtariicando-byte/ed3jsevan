import React, { useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { FileUpload } from '../../components/ui/file-upload';
import { getApiBaseUrl, isRealApiMode } from '../api';
import { uploadAdminPhoto, type AdminPhotoSlot } from '../realApi';

/**
 * One photo slot in the item editor: resizes the image in the browser
 * (max 960px on the long edge) and encodes as compact WebP (which supports
 * both transparency and small file sizes), falling back to PNG/JPEG only on
 * legacy browsers that cannot encode WebP on canvas.
 *
 * - Mock mode: the resized image is passed up as a data URL (unchanged).
 * - Real mode: the resized image is uploaded to POST /api/admin/upload and
 *   the returned public URL (`/uploads/...`) is passed up instead, so it
 *   lands in the item field and ships in the published menu JSON.
 */

const MAX_EDGE = 960;

function encodeCanvasOptimal(
  canvas: HTMLCanvasElement,
  preserveTransparency: boolean,
): string {
  const webp = canvas.toDataURL('image/webp', 0.84);
  if (webp.startsWith('data:image/webp')) {
    return webp;
  }
  return preserveTransparency
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', 0.84);
}

/** Resizes the file in the browser (max 960px on the long edge). */
function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('خواندن فایل ناموفق بود.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('فایل یک عکس معتبر نیست.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('پردازش عکس ناموفق بود.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function fileToDataUrl(
  file: File,
  preserveTransparency: boolean,
): Promise<string> {
  const canvas = await fileToCanvas(file);
  return encodeCanvasOptimal(canvas, preserveTransparency);
}

/**
 * Encodes the resized canvas as a WebP Blob for upload. Per the canvas
 * spec a browser that cannot encode WebP falls back to PNG here, which
 * keeps cutout transparency and is still accepted by the backend.
 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('تبدیل عکس ناموفق بود.'));
      },
      'image/webp',
      0.84,
    );
  });
}

export function PhotoSlot({
  label,
  hint,
  imageSrc,
  onFile,
  onRemove,
  slot,
  preserveTransparency = false,
  tall = false,
}: {
  label: string;
  hint?: string;
  imageSrc: string | undefined;
  /**
   * Receives the resized image: a data URL in mock mode, the uploaded
   * public URL (`/uploads/...`) in real mode.
   */
  onFile: (src: string) => void;
  onRemove?: () => void;
  /** Backend upload slot (real mode only). */
  slot: AdminPhotoSlot;
  preserveTransparency?: boolean;
  tall?: boolean;
}) {
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleFiles = (files: File[]) => {
    const file = files[0];
    if (!file || uploading) return;
    setError('');
    if (!isRealApiMode()) {
      void fileToDataUrl(file, preserveTransparency)
        .then(onFile)
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'خطایی رخ داد.');
        });
      return;
    }
    setUploading(true);
    void (async () => {
      try {
        const canvas = await fileToCanvas(file);
        const blob = await canvasToBlob(canvas);
        // The server ignores the client filename (it generates a unique
        // one from the MIME type), but FormData still needs a name.
        const ext = blob.type === 'image/png' ? 'png' : 'webp';
        const uploadFile = new File([blob], `photo.${ext}`, {
          type: blob.type,
        });
        const url = await uploadAdminPhoto(
          uploadFile,
          slot,
          getApiBaseUrl() ?? '/api',
        );
        onFile(url);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'خطایی رخ داد.');
      } finally {
        setUploading(false);
      }
    })();
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground/90">{label}</p>
      <div
        className={`flex items-center justify-center overflow-hidden rounded-lg border border-border bg-muted ${
          tall ? 'aspect-[3/4]' : 'aspect-square'
        }`}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={label}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex flex-col items-center gap-2 p-4 text-center text-xs text-muted-foreground">
            <ImageOff className="size-6" />
            عکسی انتخاب نشده است
          </span>
        )}
      </div>
      <div className={uploading ? 'pointer-events-none opacity-60' : undefined}>
        <FileUpload
          accept="image/*"
          multiple={false}
          maxSize={8 * 1024 * 1024}
          hint={hint ?? 'JPG ،PNG یا WebP — تبدیل خودکار به WebP کم‌حجم'}
          onFiles={handleFiles}
        />
      </div>
      {uploading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          در حال آپلود…
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {imageSrc && onRemove && (
        <Button variant="ghost" size="sm" onClick={onRemove}>
          حذف عکس
        </Button>
      )}
    </div>
  );
}
