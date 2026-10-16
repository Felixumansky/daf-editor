import { describe, expect, it } from 'vitest';

import { encodeLink, imageLinks } from './images';

describe('image links', () => {
  it('finds relative pictures on a line', () => {
    expect(imageLinks('see ![](notes.assets/a.png) and ![x](b.jpg "title")')).toEqual(['notes.assets/a.png', 'b.jpg']);
    expect(imageLinks('![](<my notes.assets/a.png>)')).toEqual(['my notes.assets/a.png']);
    expect(imageLinks('![](%D7%A9.assets/a%20b.png)')).toEqual(['ש.assets/a b.png']);
  });

  it('skips URLs, absolute paths and plain text', () => {
    expect(imageLinks('![](https://example.com/a.png) ![](/etc/a.png) ![](C:/a.png)')).toEqual([]);
    expect(imageLinks('[not an image](a.png)')).toEqual([]);
  });

  it('round-trips names with spaces and parentheses', () => {
    const link = encodeLink('my notes (1).assets/screenshot.png');
    expect(link).toBe('my%20notes%20%281%29.assets/screenshot.png');
    expect(imageLinks(`![](${link})`)).toEqual(['my notes (1).assets/screenshot.png']);
  });
});
