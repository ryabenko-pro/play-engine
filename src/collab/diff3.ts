/**
 * Three-way merge of text by lines (what `git merge-file` does): changes from both sides
 * are combined; when both changed the same lines differently, it is a conflict.
 */

interface Hunk {
  side: 0 | 1;
  /** Replaced base lines [b0, b1) … */
  b0: number;
  b1: number;
  /** … by side lines [s0, s1). */
  s0: number;
  s1: number;
}

/** The merged text, or null when both sides changed the same lines differently. */
export function mergeText(base: string, mine: string, theirs: string): string | null {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  const b = splitLines(base);
  const sides = [splitLines(mine), splitLines(theirs)];
  const hunks = [...diff(b, sides[0], 0), ...diff(b, sides[1], 1)].sort((x, y) => x.b0 - y.b0 || x.side - y.side);

  const out: string[] = [];
  let pos = 0;
  for (let i = 0; i < hunks.length; ) {
    // A group: hunks whose base ranges overlap or touch.
    const group = [hunks[i]];
    const lo = hunks[i].b0;
    let hi = hunks[i].b1;
    for (i++; i < hunks.length && hunks[i].b0 <= hi; i++) {
      group.push(hunks[i]);
      hi = Math.max(hi, hunks[i].b1);
    }
    out.push(...b.slice(pos, lo));
    const texts = ([0, 1] as const).map((side) => {
      const own = group.filter((g) => g.side === side);
      if (!own.length) return b.slice(lo, hi);
      const first = own[0];
      const last = own[own.length - 1];
      return sides[side].slice(first.s0 - (first.b0 - lo), last.s1 + (hi - last.b1));
    });
    const changed = new Set(group.map((g) => g.side));
    if (changed.size === 1) out.push(...texts[group[0].side]);
    else if (texts[0].join('') === texts[1].join('')) out.push(...texts[0]);
    else return null;
    pos = hi;
  }
  out.push(...b.slice(pos));
  return out.join('');
}

/** Lines with their line breaks, so joining gives the text back exactly. */
function splitLines(s: string): string[] {
  return s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** The changed regions between a and b, from a longest common subsequence of lines. */
function diff(a: string[], b: string[], side: 0 | 1): Hunk[] {
  // Common prefix and suffix need no table.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;

  const n = endA - start;
  const m = endB - start;
  // lcs[i][j]: LCS length of a[start+i..endA) and b[start+j..endB).
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[start + i] === b[start + j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let hi = 0;
  let hj = 0;
  const flush = () => {
    if (i > hi || j > hj) hunks.push({ side, b0: start + hi, b1: start + i, s0: start + hj, s1: start + j });
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      flush();
      i++, j++;
      hi = i;
      hj = j;
    } else if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) i++;
    else j++;
  }
  flush();
  return hunks;
}
