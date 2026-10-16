import { describe, expect, it } from 'vitest';
import { innerRange } from './isolates';

const inner = (s: string) => {
  const { start, end } = innerRange(s);
  return s.slice(start, end);
};

describe('innerRange keeps markers and quotes outside the isolate', () => {
  it.each([
    ['// הערה בעברית', 'הערה בעברית'],
    ['/* הערת בלוק */', 'הערת בלוק'],
    ['/** תיעוד */', 'תיעוד'],
    ['# הערה בפייתון', 'הערה בפייתון'],
    ['-- הערה ב-SQL', 'הערה ב-SQL'],
    ['<!-- הערה -->', 'הערה'],
    ['"שלום"', 'שלום'],
    ["'שלום'", 'שלום'],
    ['`שלום ${x}`', 'שלום ${x}'],
    ['"""מחרוזת ארוכה"""', 'מחרוזת ארוכה'],
    ['f"שלום {name}"', 'שלום {name}'],
  ])('%s', (node, expected) => {
    expect(inner(node)).toBe(expected);
  });
});
