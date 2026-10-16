import { describe, expect, it } from 'vitest';
import { StringStream } from '@codemirror/language';
import { passwordsParser as p } from './passwords';

/** Styled tokens of a document, as [text, style] pairs. */
function tokens(text: string): [string, string][] {
  const state = p.startState!(2);
  const out: [string, string][] = [];
  for (const line of text.split('\n')) {
    const stream = new StringStream(line, 4, 2);
    if (stream.eol()) p.blankLine!(state, 2);
    while (!stream.eol()) {
      const style = p.token(stream, state);
      if (style) out.push([stream.current(), style]);
      stream.start = stream.pos;
    }
  }
  return out;
}

describe('passwords highlighting', () => {
  it.each([
    ['me@gmail.com Hunter2!'],
    ['me@gmail.com : Hunter2!'],
    ['me@gmail.com\t|\tHunter2!'],
    ['me@gmail.com, Hunter2!'],
  ])('email then password: %s', (line) => {
    expect(tokens(line).filter(([, s]) => s !== 'punctuation')).toEqual([
      ['me@gmail.com', 'user'],
      ['Hunter2!', 'secret'],
    ]);
  });

  it('site, email and password on one line', () => {
    expect(tokens('Facebook - me@x.com - pa:ss-1')).toEqual([
      ['-', 'punctuation'],
      ['me@x.com', 'user'],
      ['-', 'punctuation'],
      ['pa:ss-1', 'secret'],
    ]);
  });

  it('labelled lines, English and Hebrew', () => {
    expect(tokens('user: me@x.com\npassword: correct horse battery \nסיסמה: 1234')).toEqual([
      ['user:', 'label'],
      ['me@x.com', 'user'],
      ['password:', 'label'],
      ['correct horse battery', 'secret'],
      ['סיסמה:', 'label'],
      ['1234', 'secret'],
    ]);
  });

  it('headings and a password on the line after its email', () => {
    expect(tokens('Gmail\nme@gmail.com\nHunter2!\n\n[בנק]\nבנק לאומי:\n# old account')).toEqual([
      ['Gmail', 'heading'],
      ['me@gmail.com', 'user'],
      ['Hunter2!', 'secret'],
      ['[בנק]', 'heading'],
      ['בנק לאומי:', 'heading'],
      ['# old account', 'comment'],
    ]);
  });

  it('a blank line ends the record', () => {
    expect(tokens('me@gmail.com\n\nxyz123')).toEqual([['me@gmail.com', 'user']]);
  });
});
