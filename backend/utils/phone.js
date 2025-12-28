const SCI_NOTATION_REGEX = /e\+?\d+$/i;

function toRawString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") {
    try {
      return String(BigInt(Math.trunc(value)));
    } catch (err) {
      // Fall back to toFixed when BigInt conversion fails (very large or special numbers)
      return String(Number(value).toFixed(0));
    }
  }

  const str = String(value).trim();
  if (SCI_NOTATION_REGEX.test(str) && !str.includes(" ")) {
    const asNumber = Number(str);
    if (Number.isFinite(asNumber)) {
      return String(asNumber.toFixed(0));
    }
  }

  return str;
}

function stripNonDigits(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\D/g, "");
}

function formatDisplayFromDigits(digits) {
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatE164ToDisplay(e164) {
  if (!e164) return null;
  const digits = String(e164).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const tenDigit = digits.slice(1);
    return formatDisplayFromDigits(tenDigit);
  }
  if (digits.length === 10) {
    return formatDisplayFromDigits(digits);
  }
  return null;
}

function normalizeUSPhone(rawInput) {
  const rawString = toRawString(rawInput);
  const digitsOnly = stripNonDigits(rawString);

  let normalizedDigits = digitsOnly;
  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    normalizedDigits = digitsOnly.slice(1);
  }

  if (normalizedDigits.length === 10) {
    const display = formatDisplayFromDigits(normalizedDigits);
    return {
      valid: true,
      e164: `+1${normalizedDigits}`,
      display,
      raw: rawString,
    };
  }

  return {
    valid: false,
    e164: null,
    display: rawString || null,
    raw: rawString,
  };
}

module.exports = {
  normalizeUSPhone,
  formatE164ToDisplay,
};
