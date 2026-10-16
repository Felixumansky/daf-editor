import type { Extension } from '@codemirror/state';
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from '@codemirror/language';
import { Tag, tags as t } from '@lezer/highlight';

/**
 * Highlighting for a hand-written password list, so each account reads at a glance:
 * site names stand out as headings, the email / user name in one color, the password in another.
 * It understands the usual shapes people type:
 *
 *   Gmail                          [Bank]
 *   me@gmail.com  Hunter2!         user: me@x.com
 *   me@gmail.com : Hunter2!        password: correct horse battery
 *   Facebook - me@x.com - pass1    סיסמה: 1234
 *
 * and an email on one line with its password alone on the next.
 */

const pwTags = { user: Tag.define(), secret: Tag.define() };

type Next = 'user' | 'site' | 'secretRest' | 'secretWord' | null;
interface PwState {
  /** What the next value token is expected to be (set by a label or an email). */
  next: Next;
}

const EMAIL = /^[^\s@:|,;<>()"]+@[^\s@:|,;<>()"]+\.[^\s@:|,;<>()"]+/;
const URL = /^(?:https?:\/\/|www\.)\S+/i;
const LABEL =
  /^(?:e-?mail|mail|user(?:\s?name)?|login|account|pass(?:word)?|pwd|pw|pin|code|site|url|web(?:site)?|אימייל|מייל|דוא["״]ל|שם משתמש|משתמש|סיסמה|סיסמא|קוד|אתר)\s*[:=]/i;
const SEPARATOR = /^(?:[:|,;=]+|[-–—/](?=\s|$))/;

function labelKind(label: string): Next {
  if (/^(?:pass|pwd|pw|pin|code|סיסמ|קוד)/i.test(label)) return 'secretRest';
  if (/^(?:site|url|web|אתר)/i.test(label)) return 'site';
  return 'user';
}

/** A line naming an account rather than holding credentials: "Gmail", "Gmail:", "[Bank]", "== Work ==". */
function isHeading(line: string): boolean {
  const s = line.trim();
  if (/^\[.+\]$/.test(s) || /^={2,}.*\S/.test(s)) return true;
  if (s.includes('@') || URL.test(s) || LABEL.test(s)) return false;
  if (/^[^:|,;=]+:$/.test(s)) return true;
  return !/[\d:|,;=]/.test(s) && s.split(/\s+/).length <= 4;
}

export const passwordsParser: StreamParser<PwState> = {
  name: 'passwords',
  startState: () => ({ next: null }),
  token(stream, s) {
    if (stream.sol()) {
      // An email that ended its line lends its password slot to a lone word on the next line.
      const line = stream.string;
      const carry = s.next === 'secretWord' && /^\s*\S+\s*$/.test(line) && !line.includes('@');
      s.next = carry ? 'secretWord' : null;
      if (/^\s*(?:#|\/\/)/.test(line)) {
        stream.skipToEnd();
        return 'comment';
      }
      if (!carry && isHeading(line)) {
        stream.skipToEnd();
        return 'heading';
      }
    }
    if (stream.eatSpace()) return null;

    if (s.next === 'secretRest') {
      s.next = null;
      stream.match(/^.*\S/);
      return 'secret';
    }
    const label = stream.match(LABEL) as RegExpMatchArray | null;
    if (label) {
      s.next = labelKind(label[0]);
      return 'label';
    }
    if (stream.match(SEPARATOR)) return 'punctuation';
    if (s.next === 'user') {
      s.next = 'secretWord';
      stream.match(/^[^\s|,;]+/);
      return 'user';
    }
    if (s.next === 'site') {
      s.next = null;
      stream.match(/^\S+/);
      return 'site';
    }
    if (stream.match(EMAIL)) {
      s.next = 'secretWord';
      return 'user';
    }
    if (stream.match(URL)) return 'site';
    if (s.next === 'secretWord') {
      s.next = null;
      stream.match(/^\S+/);
      return 'secret';
    }
    if (!stream.match(/^[^\s:|,;=]+/)) stream.next();
    return null;
  },
  blankLine: (s) => {
    s.next = null;
  },
  tokenTable: {
    user: pwTags.user,
    secret: pwTags.secret,
    label: t.propertyName,
    site: t.link,
    heading: t.heading,
    comment: t.comment,
    punctuation: t.punctuation,
  },
};

const passwordsHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: pwTags.user, color: 'var(--tok-function)' },
    // A tinted box shows exactly where the password starts and ends (stray spaces included).
    { tag: pwTags.secret, color: 'var(--tok-string)', backgroundColor: 'var(--surface-2)', borderRadius: '3px' },
  ]),
);

export const passwords = (): Extension => [StreamLanguage.define(passwordsParser), passwordsHighlight];
