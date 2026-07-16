export type LineDiffStats = { adds: number; removes: number };

/** Return minimal added/removed line counts between two text snapshots. */
export function lineDiffStats(oldText: string, newText: string): LineDiffStats {
  const oldLines = oldText === "" ? [] : oldText.split("\n");
  const newLines = newText === "" ? [] : newText.split("\n");

  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start += 1;
  }

  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (
    endOld > start &&
    endNew > start &&
    oldLines[endOld - 1] === newLines[endNew - 1]
  ) {
    endOld -= 1;
    endNew -= 1;
  }

  const oldLength = endOld - start;
  const newLength = endNew - start;
  if (oldLength === 0 || newLength === 0) {
    return { removes: oldLength, adds: newLength };
  }

  const maxDistance = oldLength + newLength;
  const offset = maxDistance;
  const furthest = new Int32Array(maxDistance * 2 + 1);
  furthest.fill(-1);
  furthest[offset + 1] = 0;

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const index = offset + diagonal;
      let oldIndex: number;
      if (
        diagonal === -distance ||
        (diagonal !== distance && furthest[index - 1]! < furthest[index + 1]!)
      ) {
        oldIndex = furthest[index + 1]!;
      } else {
        oldIndex = furthest[index - 1]! + 1;
      }
      let newIndex = oldIndex - diagonal;
      while (
        oldIndex < oldLength &&
        newIndex < newLength &&
        oldLines[start + oldIndex] === newLines[start + newIndex]
      ) {
        oldIndex += 1;
        newIndex += 1;
      }
      furthest[index] = oldIndex;
      if (oldIndex >= oldLength && newIndex >= newLength) {
        const lengthDelta = newLength - oldLength;
        return {
          adds: (distance + lengthDelta) / 2,
          removes: (distance - lengthDelta) / 2,
        };
      }
    }
  }

  return { removes: oldLength, adds: newLength };
}
