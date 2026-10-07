/** Simple entropy calculation in bits per character. */
export function entropy(value: string): number {
  if (!value) return 0;

  const frequencies = new Map<string, number>();

  for (const char of value) {
    frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
  }

  let result = 0;

  for (const count of frequencies.values()) {
    const p = count / value.length;
    result -= p * Math.log2(p);
  }

  return result;
}
