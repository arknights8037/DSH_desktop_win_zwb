export function toggleSelection(values: string[], value: string, limit = 8): string[] {
  if (values.includes(value)) return values.filter((item) => item !== value);
  return [...values, value].slice(-limit);
}
