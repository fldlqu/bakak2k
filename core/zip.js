// Zip access via JSZip.
// We do NOT ship the dictionary: the user feeds the official A2Kanji2Koe SDK
// zip (aqk2k_win_413.zip) or a raw aqdic.bin, and we pull aqdic.bin out of it.
// JSZip is used instead of a hand-rolled parser so that zip64 / data
// descriptors / various flag combos in the wild just work.
import JSZip from 'jszip';

async function load(zipBytes) {
  const zip = await JSZip.loadAsync(zipBytes);
  return zip;
}

// List entry names (files only, no dirs).
export async function listZipEntries(zipBytes) {
  const zip = await load(zipBytes);
  return Object.keys(zip.files).filter((n) => !zip.files[n].dir);
}

// Find a file entry whose name ends with `suffix` (e.g. `aqdic.bin`).
export async function findZipEntry(zipBytes, suffix) {
  const zip = await load(zipBytes);
  const lower = suffix.toLowerCase();
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (!f.dir && name.toLowerCase().endsWith(lower)) {
      return { name, size: f._data?.uncompressedSize ?? undefined };
    }
  }
  return null;
}

// Extract one entry as a fresh Uint8Array. `nameOrSuffix` may be an exact name
// or a suffix (matched case-insensitively).
export async function extractZipEntry(zipBytes, nameOrSuffix) {
  const zip = await load(zipBytes);
  const lower = nameOrSuffix.toLowerCase();
  let entry = null;
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (!f.dir && (name === nameOrSuffix || name.toLowerCase().endsWith(lower))) {
      entry = f;
      break;
    }
  }
  if (!entry) throw new Error(`zip entry not found: ${nameOrSuffix}`);
  const data = await entry.async('uint8array');
  return new Uint8Array(data);
}

// Extract aqdic.bin (the AQ dictionary) from the SDK zip.
export async function extractAqdicFromZip(zipBytes) {
  return extractZipEntry(zipBytes, 'aqdic.bin');
}