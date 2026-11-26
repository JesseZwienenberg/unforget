import { describe, expect, it } from 'vitest';
import { parseCapture, splitPrefix } from '../src/parse';
import { DEFAULT_SETTINGS } from '../src/settings';

const P = DEFAULT_SETTINGS.prefixes;
// 14:03:20 Amsterdam winter time
const NOW = new Date('2026-11-26T13:03:20.000Z');
const parse = (text: string) => parseCapture(text, NOW, P);
const minutesFromNow = (text: string): number | null => {
  const r = parse(text).remindAt;
  return r ? Math.round((Date.parse(r) - NOW.getTime()) / 60_000) : null;
};

describe('prefixes', () => {
  it.each([
    ['w call Anna', 'work', 'call Anna'],
    ['p tandarts bellen', 'personal', 'tandarts bellen'],
    ['g ketchup', 'groceries', 'ketchup'],
    ['G Melk', 'groceries', 'Melk'], // the keyboard capitalises the first letter
    ['  w   budget review', 'work', 'budget review'],
  ])('%s', (text, list, title) => {
    expect(parse(text)).toMatchObject({ list, title });
  });

  it.each(['water the plants', 'pizza bestellen', 'g', 'w ', 'gras maaien', 'ww test'])('no prefix in "%s"', (text) => {
    expect(parse(text).list).toBeNull();
  });

  it('uses configured letters', () => {
    const custom = { work: 'j', personal: 'x', groceries: 'boodschap' };
    expect(splitPrefix('j standup', custom)).toEqual({ list: 'work', rest: 'standup' });
    expect(splitPrefix('boodschap melk', custom)).toEqual({ list: 'groceries', rest: 'melk' });
    expect(splitPrefix('w standup', custom).list).toBeNull();
  });

  it('treats special characters in a prefix literally', () => {
    expect(splitPrefix('. note', { work: '.', personal: 'p', groceries: 'g' })).toEqual({ list: 'work', rest: 'note' });
    expect(splitPrefix('x note', { work: '.', personal: 'p', groceries: 'g' }).list).toBeNull();
  });
});

describe('relative times', () => {
  it.each([
    // English
    ['in 10 min', 10],
    ['in 10 mins', 10],
    ['in 10 minutes', 10],
    ['in 1 minute', 1],
    ['in 10m', 10],
    ['in an hour', 60],
    ['in a hour', 60],
    ['in one hour', 60],
    ['in 2 hours', 120],
    ['in 2h', 120],
    ['in 2 hrs', 120],
    ['in 1.5 hours', 90],
    ['in half an hour', 30],
    ['in a half hour', 30],
    ['in an hour and a half', 90],
    ['in a quarter of an hour', 15],
    ['in ten minutes', 10],
    ['in about 20 minutes', 20],
    ['in 1 hour and 30 minutes', 90],
    ['In 5 Min', 5],
    // Dutch
    ['over 10 minuten', 10],
    ['over 10 min', 10],
    ['over 1 minuut', 1],
    ['over een minuutje', 1],
    ['over een kwartier', 15],
    ['over een kwartiertje', 15],
    ['over 3 kwartier', 45],
    ['over 2 uur', 120],
    ['over 2u', 120],
    ['over een uur', 60],
    ['over één uur', 60],
    ['over een uurtje', 60],
    ['over 1,5 uur', 90],
    ['over anderhalf uur', 90],
    ['over een half uur', 30],
    ['over een half uurtje', 30],
    ['over een halfuur', 30],
    ['over twee uur', 120],
    ['over vijf minuten', 5],
    ['over ongeveer 20 minuten', 20],
    ['over 2 uur en 15 minuten', 135],
    ['in 10 minuten', 10], // Dutch speakers say this too
    ['over 45 min', 45],
  ])('"%s" → +%d min', (text, minutes) => {
    expect(minutesFromNow(`${text} test`)).toBe(minutes);
  });

  it.each([
    'over de brug lopen',
    'in de winkel melk kopen',
    'praten over 2 opties',
    'in 2 weken tandarts',
    'over 3 dagen bellen',
    'meeting in room 5',
    'in nu',
    'in 0 min',
    'within 5 minutes',
    'bin 5 min',
    'in 5 miles',
    'in 2 houses',
    'morgen om 10 uur',
    'at 10 min past',
  ])('no reminder in "%s"', (text) => {
    expect(parse(text).remindAt).toBeNull();
  });

  it('removes the time phrase from the title, wherever it is', () => {
    expect(parse('over 10 minuten oven uit').title).toBe('oven uit');
    expect(parse('oven uit over 10 minuten').title).toBe('oven uit');
    expect(parse('call mom in an hour please').title).toBe('call mom please');
    expect(parse('was ophangen, over een kwartier').title).toBe('was ophangen');
  });

  it('keeps the whole text as title when nothing else is left', () => {
    expect(parse('over 2 min')).toMatchObject({ title: 'over 2 min' });
    expect(parse('over 2 min').remindAt).not.toBeNull();
  });

  it('combines a prefix and a time', () => {
    expect(parse('w over 2 uur standup notes sturen')).toMatchObject({
      list: 'work',
      title: 'standup notes sturen',
      remindAt: '2026-11-26T15:03:00.000Z',
    });
  });

  it('counts from the moment of typing and rounds to the minute', () => {
    // 13:03:20 + 10 min = 13:13:20 → 13:13
    expect(parse('in 10 min x').remindAt).toBe('2026-11-26T13:13:00.000Z');
    // 13:03:40 + 10 min = 13:13:40 → 13:14
    expect(parseCapture('in 10 min x', new Date('2026-11-26T13:03:40.000Z'), P).remindAt).toBe('2026-11-26T13:14:00.000Z');
  });

  it('mixes Dutch and English in one capture', () => {
    expect(parse('reminder to bellen met de garage over een kwartier')).toMatchObject({
      title: 'reminder to bellen met de garage',
      remindAt: '2026-11-26T13:18:00.000Z',
    });
  });

  it('is exact across both daylight-saving changes (relative time is absolute time)', () => {
    // Spring: 01:30 CET on 29 Mar 2026; clocks jump 02:00 → 03:00. One hour later is 03:30 CEST.
    const spring = parseCapture('in an hour x', new Date('2026-03-29T00:30:00.000Z'), P);
    expect(spring.remindAt).toBe('2026-03-29T01:30:00.000Z');
    // Autumn: 02:30 CEST on 25 Oct 2026; clocks fall back 03:00 → 02:00. Two hours later is 03:30 CET.
    const autumn = parseCapture('over 2 uur x', new Date('2026-10-25T00:30:00.000Z'), P);
    expect(autumn.remindAt).toBe('2026-10-25T02:30:00.000Z');
  });
});
