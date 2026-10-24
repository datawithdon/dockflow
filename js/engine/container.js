// ISO 6346 container numbers: 3-letter owner code, equipment category
// (U, J or Z), 6-digit serial and a check digit, e.g. MSCU1234565.

const LETTER_VALUES = (() => {
  // Values skip multiples of 11 (11, 22, 33).
  const map = {};
  let v = 10;
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (v % 11 === 0) v++;
    map[ch] = v++;
  }
  return map;
})();

export const normalizeContainer = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function checkDigit(first10) {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = first10[i];
    const v = /\d/.test(ch) ? Number(ch) : LETTER_VALUES[ch];
    sum += v * 2 ** i;
  }
  return (sum % 11) % 10;
}

/** { valid, normalized, reason } */
export function validateContainer(raw) {
  const n = normalizeContainer(raw);
  if (!n) return { valid: false, normalized: n, reason: "empty" };
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(n)) return { valid: false, normalized: n, reason: "format (expected AAAU1234567)" };
  const expected = checkDigit(n.slice(0, 10));
  if (expected !== Number(n[10])) return { valid: false, normalized: n, reason: `check digit should be ${expected}` };
  return { valid: true, normalized: n, reason: "" };
}
