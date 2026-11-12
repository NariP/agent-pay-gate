export const toValue = (cents) => (cents / 100).toFixed(2);

export const toCents = (value) => {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) return NaN;
  const [whole, frac = ""] = String(value).split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
};

export const format = (cents, currency = "USD") => `${currency === "USD" ? "$" : `${currency} `}${toValue(cents)}`;
