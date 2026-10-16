/**
 * A small, safe calculator for "evaluate selection": + - * / % ^, parentheses, unary minus,
 * decimals, × and ÷. Recursive descent; never uses eval.
 */

export class CalcError extends Error {}

export function evaluate(expr: string): number {
  const src = expr.replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
  let i = 0;

  const skip = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const peek = () => (skip(), src[i]);
  const eat = (c: string) => {
    if (peek() === c) {
      i++;
      return true;
    }
    return false;
  };

  // expr := term (('+' | '-') term)*
  function expression(): number {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else return v;
    }
  }
  // term := unary (('*' | '/' | '%') unary)*
  function term(): number {
    let v = unary();
    for (;;) {
      if (eat('*')) v *= unary();
      else if (eat('/')) {
        const d = unary();
        if (d === 0) throw new CalcError('division by zero');
        v /= d;
      } else if (eat('%')) {
        const d = unary();
        if (d === 0) throw new CalcError('division by zero');
        v %= d;
      } else return v;
    }
  }
  // unary := ('-' | '+') unary | power     (so -2^2 = -4)
  function unary(): number {
    if (eat('-')) return -unary();
    if (eat('+')) return unary();
    return power();
  }
  // power := atom ('^' unary)?   (right-associative: 2^3^2 = 512)
  function power(): number {
    const base = atom();
    return eat('^') ? base ** unary() : base;
  }
  // atom := number | '(' expr ')'
  function atom(): number {
    if (eat('(')) {
      const v = expression();
      if (!eat(')')) throw new CalcError('missing )');
      return v;
    }
    skip();
    const m = /^(\d+(?:,\d{3})+(?!\d)|\d*\.?\d+(?:e[+-]?\d+)?)/i.exec(src.slice(i));
    if (!m) throw new CalcError('expected a number');
    i += m[0].length;
    return Number(m[0].replace(/,/g, ''));
  }

  const v = expression();
  skip();
  if (i < src.length) throw new CalcError(`unexpected "${src[i]}"`);
  if (!Number.isFinite(v)) throw new CalcError('result is not a finite number');
  return v;
}

/** Format a result without floating-point noise: 0.1 + 0.2 → "0.3". */
export function formatResult(n: number): string {
  const r = Number(n.toPrecision(12));
  return Object.is(r, -0) ? '0' : String(r);
}

/** Does this look like arithmetic at all (so we do not "evaluate" a sentence)? */
export function looksLikeMath(s: string): boolean {
  return /\d/.test(s) && /^[\d\s.,+\-*/%^()×÷xX−–e]+$/.test(s);
}
