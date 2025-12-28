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
  const raw = rawInput === undefined || rawInput === null ? "" : String(rawInput).trim();
  const digitsOnly = stripNonDigits(raw);

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
      raw,
    };
  }

  return {
    valid: false,
    e164: null,
    display: raw || null,
    raw,
  };
}

module.exports = {
  normalizeUSPhone,
  formatE164ToDisplay,
};
