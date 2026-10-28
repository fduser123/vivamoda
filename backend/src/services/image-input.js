// =====================================================================
// ENTRADA DE IMÁGENES DE LA IA — un solo tope y un solo formato de error.
//
// Antes cada endpoint tenía su propio criterio:
//   · /api/ai/tryon          rechazaba > 600 000 caracteres
//   · /api/ai/analyze-outfit lo comprobaba dentro de vision-stylist
//   · /api/ai/visual-search  aceptaba hasta 12 MB de binario
// El resultado era incoherente: la misma foto funcionaba en un sitio y en
// otro devolvía 413/400 con mensajes distintos (y a veces HTML de Express).
//
// Aquí se centraliza: máximo configurable con AI_IMAGE_MAX_KB, validación de
// la cabecera real del archivo y errores 413 (demasiado grande) / 422 (no es
// una imagen válida) en JSON, para que el frontend siempre pueda mostrar el
// motivo.
// =====================================================================
import { config } from '../config.js';

const PREFIX_RE = /^data:([a-z0-9.+/-]+);base64,/i;
const MIME_BY_MAGIC = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'image/gif', test: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')) },
  { mime: 'image/avif', test: (b) => b.subarray(4, 12).toString('ascii').includes('ftypavi') },
  { mime: 'image/heic', test: (b) => /^ftyp(heic|heix|hevc|mif1)/.test(b.subarray(4, 12).toString('ascii')) },
];

/** Error con status y código estables para el frontend. */
export class ImageInputError extends Error {
  constructor(message, { status = 422, code = 'IMAGE_INVALID', meta = {} } = {}) {
    super(message);
    this.name = 'ImageInputError';
    this.status = status;
    this.code = code;
    this.meta = meta;
  }
}

/** Tope vigente (bytes reales y caracteres base64 equivalentes). */
export function imageLimits() {
  const kb = Math.max(64, Math.round(Number(config.aiImageMaxKb) || 512));
  const bytes = kb * 1024;
  return { kb, bytes, base64Chars: Math.ceil(bytes / 3) * 4 };
}

function sniffMime(buffer) {
  for (const { mime, test } of MIME_BY_MAGIC) {
    try { if (test(buffer)) return mime; } catch { /* buffer corto */ }
  }
  return null;
}

function checkSize(bytes) {
  const { kb, bytes: max } = imageLimits();
  if (bytes > max) {
    throw new ImageInputError(
      `La imagen pesa ${Math.round(bytes / 1024)} KB y el máximo es ${kb} KB. Redúcela o vuelve a tomarla.`,
      { status: 413, code: 'IMAGE_TOO_LARGE', meta: { maxKb: kb, bytes } },
    );
  }
}

function checkBuffer(buffer) {
  if (!buffer || buffer.length < 64) {
    throw new ImageInputError('La imagen está vacía o es demasiado pequeña.', { status: 422, code: 'IMAGE_INVALID' });
  }
  checkSize(buffer.length);
  const mime = sniffMime(buffer);
  if (!mime) {
    throw new ImageInputError(
      'El archivo no parece una imagen válida (se aceptan JPEG, PNG, WebP, GIF, AVIF o HEIC).',
      { status: 422, code: 'IMAGE_INVALID' },
    );
  }
  return mime;
}

/**
 * Normaliza una imagen recibida como data URL o base64 pelado.
 * @returns {{ base64: string, bytes: number, mime: string, dataUrl: string }}
 * @throws {ImageInputError}
 */
export function normalizeImageInput(input, { field = 'image' } = {}) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new ImageInputError(`Falta la imagen (campo "${field}").`, { status: 422, code: 'IMAGE_MISSING' });
  }
  const raw = input.trim();
  const prefix = raw.match(PREFIX_RE);
  if (prefix && !/^image\//i.test(prefix[1])) {
    throw new ImageInputError('El data URL no contiene una imagen.', { status: 422, code: 'IMAGE_INVALID' });
  }

  let b64 = (prefix ? raw.slice(prefix[0].length) : raw).replace(/\s+/g, '');
  if (!b64) {
    throw new ImageInputError('La imagen llegó vacía.', { status: 422, code: 'IMAGE_INVALID' });
  }
  // Algunos clientes envían base64 URL-safe: se acepta y se convierte.
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  if (b64.length % 4 === 1) {
    throw new ImageInputError('La imagen no está bien codificada en base64.', { status: 422, code: 'IMAGE_INVALID' });
  }
  if (b64.length % 4) b64 += '='.repeat(4 - (b64.length % 4));
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    throw new ImageInputError('La imagen no está bien codificada en base64.', { status: 422, code: 'IMAGE_INVALID' });
  }

  const buffer = Buffer.from(b64, 'base64');
  const mime = checkBuffer(buffer);
  return {
    base64: b64,
    bytes: buffer.length,
    mime,
    dataUrl: `data:${mime};base64,${b64}`,
  };
}

/** Igual que normalizeImageInput pero para el cuerpo binario (image/*). */
export function normalizeImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new ImageInputError('Falta la imagen binaria.', { status: 422, code: 'IMAGE_MISSING' });
  }
  const mime = checkBuffer(buffer);
  const b64 = buffer.toString('base64');
  return { base64: b64, bytes: buffer.length, mime, dataUrl: `data:${mime};base64,${b64}` };
}

/**
 * Responde un ImageInputError; devuelve true si ya respondió.
 * Uso: catch (err) { if (sendImageError(res, err)) return; ... }
 */
export function sendImageError(res, err) {
  if (!(err instanceof ImageInputError)) return false;
  res.status(err.status).json({
    ok: false,
    error: err.message,
    code: err.code,
    ...err.meta,
  });
  return true;
}
