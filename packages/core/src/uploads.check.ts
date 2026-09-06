/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a phone is allowed to upload.
 *
 * Run with `npm run check --workspace @freshfold/core`.
 *
 * The proof photographs and signature PNGs are base64 `data:` URIs inside the
 * job record, and nothing checked them at all: no size cap, no type check, and
 * no test that the bytes were an image. The JSON body limit was 12 MB — set
 * that high precisely to let them through — so one authenticated courier could
 * push megabytes per request into Postgres for as long as they liked.
 *
 * The last section is the one worth having. A `data:image/jpeg;base64,` prefix
 * is the caller's word for it, so checking only the prefix leaves the field
 * taking arbitrary bytes under an image label. The leading-byte check is what
 * makes it an image field rather than a blob store with a naming convention.
 */

import { check, checkTrue, report, section } from './check';
import {
  MAX_MESSAGE_CHARS,
  MAX_PHOTO_BYTES,
  MAX_SIGNATURE_BYTES,
  decodedByteLength,
  imageProblem,
  messageProblem,
} from './uploads';

/** base64 for a payload starting with the given bytes, padded out to `bytes`. */
function fake(magic: number[], bytes: number): string {
  const body = [...magic, ...new Array(Math.max(0, bytes - magic.length)).fill(0)];
  let binary = '';
  for (const byte of body) binary += String.fromCharCode(byte);

  // Encoded by hand: this file runs under plain Node with no DOM.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : NaN;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : NaN;
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)];
    out += Number.isNaN(b) ? '=' : ALPHABET[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)];
    out += Number.isNaN(c) ? '=' : ALPHABET[c & 63];
  }
  return out;
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47];
const WEBP = [0x52, 0x49, 0x46, 0x46];

const jpeg = (bytes: number) => `data:image/jpeg;base64,${fake(JPEG, bytes)}`;
const png = (bytes: number) => `data:image/png;base64,${fake(PNG, bytes)}`;

section('an absent image is not a problem');

// Every one of these fields is optional — most hand-offs carry no photograph,
// and refusing "nothing" would refuse the normal case.
check('undefined passes', imageProblem(undefined, 'photo'), null);
check('null passes', imageProblem(null, 'photo'), null);
check('the empty string passes', imageProblem('', 'photo'), null);

section('a real capture passes');

check('a small JPEG photograph', imageProblem(jpeg(20_000), 'photo'), null);
check('a PNG signature', imageProblem(png(9_000), 'signature'), null);
check('a WebP photograph', imageProblem(`data:image/webp;base64,${fake(WEBP, 5_000)}`, 'photo'), null);
check('the jpg spelling too', imageProblem(`data:image/jpg;base64,${fake(JPEG, 5_000)}`, 'photo'), null);

section('size, which is the finding');

checkTrue('a photograph over the limit is refused', imageProblem(jpeg(MAX_PHOTO_BYTES + 4_000), 'photo') !== null);
check('one just under is accepted', imageProblem(jpeg(MAX_PHOTO_BYTES - 4_000), 'photo'), null);

/**
 * A signature has a tighter ceiling than a photograph, and this is the case
 * that proves the two are not sharing one limit: a blob that is a fine
 * photograph is far too big to be somebody's finger on a canvas.
 */
const midsized = png(MAX_SIGNATURE_BYTES + 40_000);
check('that size is fine as a photograph', imageProblem(midsized, 'photo'), null);
checkTrue('but refused as a signature', imageProblem(midsized, 'signature') !== null);

checkTrue(
  'the refusal says how big it was and what the limit is',
  /\d+ (KB|MB).*\d+ (KB|MB)/.test(imageProblem(jpeg(MAX_PHOTO_BYTES + 4_000), 'photo') ?? '')
);

section('type');

checkTrue('a PDF is refused', imageProblem('data:application/pdf;base64,JVBERi0=', 'photo') !== null);
checkTrue('an SVG is refused', imageProblem('data:image/svg+xml;base64,PHN2Zz4=', 'photo') !== null);
checkTrue('a bare URL is refused', imageProblem('https://example.test/photo.jpg', 'photo') !== null);
checkTrue('a plain string is refused', imageProblem('a photograph, honest', 'photo') !== null);
checkTrue('a number is refused', imageProblem(12345, 'photo') !== null);
checkTrue('an object is refused', imageProblem({ photo: 'yes' }, 'photo') !== null);
checkTrue(
  'characters outside base64 are refused',
  imageProblem('data:image/jpeg;base64,not valid base64!!', 'photo') !== null
);

section('and the bytes, not just the label');

/**
 * The check that stops the field being a blob store. Each of these carries a
 * perfectly well-formed `data:image/...;base64,` prefix; none of them is an
 * image.
 */
checkTrue(
  'arbitrary bytes wearing a JPEG prefix are refused',
  imageProblem(`data:image/jpeg;base64,${fake([0x00, 0x01, 0x02], 5_000)}`, 'photo') !== null
);
checkTrue(
  'a zip wearing a PNG prefix is refused',
  imageProblem(`data:image/png;base64,${fake([0x50, 0x4b, 0x03], 5_000)}`, 'photo') !== null
);
checkTrue(
  'text wearing an image prefix is refused',
  imageProblem(`data:image/jpeg;base64,${fake([0x68, 0x65, 0x6c], 5_000)}`, 'photo') !== null
);
checkTrue(
  'a JPEG claiming to be a PNG is refused on neither count',
  imageProblem(`data:image/png;base64,${fake(JPEG, 5_000)}`, 'photo') === null
);

section('decoded length, without decoding');

check('four base64 characters are three bytes', decodedByteLength('AAAA'), 3);
check('one padding character means two', decodedByteLength('AAA='), 2);
check('two padding characters mean one', decodedByteLength('AA=='), 1);
check('and it matches what we built', decodedByteLength(fake(JPEG, 3_000)), 3_000);

section('messages');

check('an ordinary message passes', messageProblem('Left at the door, thanks.'), null);
checkTrue('an empty one is refused', messageProblem('') !== null);
checkTrue('whitespace only is refused', messageProblem('   \n  ') !== null);
check('exactly at the limit passes', messageProblem('x'.repeat(MAX_MESSAGE_CHARS)), null);
checkTrue('one over is refused', messageProblem('x'.repeat(MAX_MESSAGE_CHARS + 1)) !== null);

report();
