/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How big the things a phone uploads are allowed to be.
 *
 * The proof-of-service photographs and signature PNGs are base64 `data:` URIs
 * carried inside the job record, and nothing checked them. The JSON body limit
 * is 12 MB — set that high precisely to let them through — and below it there
 * was no size cap, no type check and no test that the bytes were an image at
 * all. One authenticated courier or customer could push megabytes per request
 * into `jobs.dispatch` indefinitely, which on a free-tier Postgres is a storage
 * exhaustion reachable from a single handset.
 *
 * That the rest of the codebase caps its text inputs carefully — claim
 * descriptions at 1000, rating comments at 500, invoice lines at 300 — is what
 * makes this an omission rather than a policy.
 *
 * Here rather than in the server so the apps can refuse an oversized capture
 * *before* spending a doorstep's worth of mobile signal uploading it, and be
 * refused by the same numbers if they do not.
 */

/**
 * A doorstep photograph, decoded.
 *
 * The rider app captures at `quality: 0.4`, which puts a phone camera JPEG
 * comfortably under half a megabyte. Two is roomy enough that a better camera
 * or a future quality bump does not start rejecting real hand-offs, and small
 * enough that the field cannot be used as a filesystem.
 */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/**
 * A signature, decoded.
 *
 * A finger-drawn line on a white canvas, exported as PNG. These run to tens of
 * kilobytes; half a megabyte is a wide margin around that rather than an
 * estimate of one.
 */
export const MAX_SIGNATURE_BYTES = 512 * 1024;

/**
 * A dispatch message.
 *
 * The one text field in the product that had no bound. Two thousand characters
 * is several paragraphs — far more than the two lines anybody types at a
 * doorstep, and not a place to store a novel.
 */
export const MAX_MESSAGE_CHARS = 2000;

/** What an image field is being used for, which decides the ceiling. */
export type ImageKind = 'photo' | 'signature';

const LIMITS: Record<ImageKind, number> = {
  photo: MAX_PHOTO_BYTES,
  signature: MAX_SIGNATURE_BYTES,
};

const LABELS: Record<ImageKind, string> = {
  photo: 'photograph',
  signature: 'signature',
};

/** `data:image/<type>;base64,<payload>` and nothing else. */
const DATA_URL = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Standard base64 alphabet, for decoding the handful of bytes we look at. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decoded length, without decoding.
 *
 * Every four base64 characters carry three bytes, less whatever the padding
 * says was not there. Worth computing rather than decoding: the point is to
 * refuse something oversized, and decoding it first to find out how big it is
 * would be doing the work the limit exists to avoid.
 */
export function decodedByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * The first three bytes, decoded by hand.
 *
 * Three bytes is one base64 quartet, and it is enough to tell the image formats
 * apart. Done arithmetically rather than through `atob` or `Buffer` because
 * this module runs under Vite, Metro and Node alike, and neither of those is
 * available in all three.
 */
function leadingBytes(base64: string): number[] {
  const quartet = base64.slice(0, 4);
  if (quartet.length < 4) return [];

  let bits = 0;
  for (const character of quartet) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) return [];
    bits = (bits << 6) | index;
  }

  return [(bits >> 16) & 0xff, (bits >> 8) & 0xff, bits & 0xff];
}

/**
 * Whether those bytes are the start of the format the URI claims.
 *
 * A `data:image/jpeg;base64,` prefix is the caller's word for it, and the
 * prefix is the only thing a charset check looks at — so without this the field
 * still takes arbitrary bytes under an image label. Checking the magic number
 * is what makes it an image field rather than a blob store with a naming
 * convention.
 */
function looksLikeImage(bytes: number[]): boolean {
  if (bytes.length < 3) return false;

  const [a, b, c] = bytes;
  const jpeg = a === 0xff && b === 0xd8 && c === 0xff;
  const png = a === 0x89 && b === 0x50 && c === 0x4e; // \x89 P N
  const riff = a === 0x52 && b === 0x49 && c === 0x46; // R I F — WebP's container

  return jpeg || png || riff;
}

function describeBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Why this image cannot be accepted, or null if it can.
 *
 * `undefined` and the empty string are *not* problems — every one of these
 * fields is optional, and "no photograph" is the normal case for most hand-offs.
 * Only a value that is present and wrong is refused.
 */
export function imageProblem(value: unknown, kind: ImageKind): string | null {
  if (value === undefined || value === null || value === '') return null;

  const label = LABELS[kind];

  if (typeof value !== 'string') return `That ${label} is not in a format we can read.`;

  const match = DATA_URL.exec(value);
  if (!match) {
    return `That ${label} must be a JPEG, PNG or WebP image.`;
  }

  const payload = match[2];

  const size = decodedByteLength(payload);
  if (size > LIMITS[kind]) {
    return `That ${label} is ${describeBytes(size)}. The limit is ${describeBytes(LIMITS[kind])}.`;
  }

  if (!looksLikeImage(leadingBytes(payload))) {
    return `That ${label} does not look like an image.`;
  }

  return null;
}

/** Why this message cannot be sent, or null if it can. */
export function messageProblem(text: string): string | null {
  if (!text.trim()) return 'A message needs text.';
  if (text.length > MAX_MESSAGE_CHARS) {
    return `A message is at most ${MAX_MESSAGE_CHARS} characters.`;
  }
  return null;
}
