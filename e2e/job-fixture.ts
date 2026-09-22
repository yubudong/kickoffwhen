export function mergeFixtureJobIds(
  existingIds: string[],
  rows: Array<{ id: string }>,
): string[] {
  return [...new Set([...existingIds, ...rows.map((row) => row.id)])];
}

export function hasExactFixtureJobKeys(
  expectedKeys: string[],
  rows: Array<{ dedupeKey: string }>,
): boolean {
  const expected = new Set(expectedKeys);
  const observed = new Set(rows.map((row) => row.dedupeKey));
  return (
    expected.size === expectedKeys.length &&
    observed.size === rows.length &&
    expected.size === observed.size &&
    [...expected].every((key) => observed.has(key))
  );
}
