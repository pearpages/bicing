import { describe, expect, test, vi } from 'vitest';
import { inRange, isAllowedUrl, monthlyResources, packageShowUrl } from './ckan';

const HOST = 'https://opendata-ajuntament.barcelona.cat';
const url = (id: string) => `${HOST}/data/dataset/x/resource/${id}/download`;

function body(resources: unknown[]) {
  return { success: true, result: { resources } };
}

describe('monthlyResources', () => {
  test('keeps monthly archives, sorted by month, with the fields the cache needs', () => {
    const found = monthlyResources(
      'estat-estacions-bicing',
      body([
        {
          id: 'b',
          name: '2026_02_Febrer_BicingNou_ESTACIONS.7z',
          url: url('b'),
          size: 18997508,
          last_modified: null,
        },
        {
          id: 'a',
          name: '2019_03_Marc_BicingNou_ESTACIONS.7z',
          url: url('a'),
          size: '17000000',
          last_modified: '2024-05-09T16:35:10',
        },
      ]),
    );
    expect(found).toEqual([
      {
        dataset: 'estat-estacions-bicing',
        id: 'a',
        name: '2019_03_Marc_BicingNou_ESTACIONS.7z',
        url: url('a'),
        month: '2019-03',
        size: 17_000_000,
        lastModified: '2024-05-09T16:35:10',
      },
      expect.objectContaining({ id: 'b', month: '2026-02', size: 18_997_508, lastModified: null }),
    ]);
  });

  test('accepts accented Catalan month names', () => {
    const found = monthlyResources(
      'informacio-estacions-bicing',
      body([{ id: 'x', name: '2024_03_Març_BicingNou_INFORMACIO.7z', url: url('x') }]),
    );
    expect(found.map((r) => r.month)).toEqual(['2024-03']);
  });

  test('drops token-gated feeds, other formats, foreign hosts, plain HTTP and bad months', () => {
    const found = monthlyResources(
      'estat-estacions-bicing',
      body([
        {
          id: '1',
          name: 'Estat_Estacions_Bicing_securitzat_json',
          url: url('1'),
          token_required: 'Yes',
        },
        {
          id: '2',
          name: '2024_01_Gener_BicingNou_ESTACIONS.7z',
          url: url('2'),
          token_required: 'Yes',
        },
        { id: '3', name: '2024_02_Febrer_BicingNou_ESTACIONS.zip', url: url('3') },
        { id: '4', name: '2024_03_Marc_BicingNou_ESTACIONS.7z', url: 'https://evil.example/a.7z' },
        {
          id: '5',
          name: '2024_04_Abril_BicingNou_ESTACIONS.7z',
          url: url('5').replace('https', 'http'),
        },
        { id: '6', name: '2024_13_Error_BicingNou_ESTACIONS.7z', url: url('6') },
        { id: '7', name: '../../2024_05_Maig_BicingNou_ESTACIONS.7z', url: url('7') },
        'not a resource',
        { id: 8, name: '2024_06_Juny_BicingNou_ESTACIONS.7z', url: url('8') },
      ]),
    );
    expect(found).toEqual([]);
  });

  test('keeps the first archive when two claim the same month', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const found = monthlyResources(
      'estat-estacions-bicing',
      body([
        { id: 'first', name: '2024_01_Gener_BicingNou_ESTACIONS.7z', url: url('first') },
        { id: 'second', name: '2024_01_Gener_BicingNou_ESTACIONS.7z', url: url('second') },
      ]),
    );
    expect(found.map((r) => r.id)).toEqual(['first']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  test('rejects a body that is not a successful package_show', () => {
    expect(() => monthlyResources('estat-estacions-bicing', null)).toThrow(/did not succeed/);
    expect(() => monthlyResources('estat-estacions-bicing', { success: false })).toThrow(
      /did not succeed/,
    );
    expect(() =>
      monthlyResources('estat-estacions-bicing', { success: true, result: { resources: 'x' } }),
    ).toThrow(/no resources/);
  });
});

describe('urls and ranges', () => {
  test('only HTTPS on the Open Data BCN origin is allowed', () => {
    expect(isAllowedUrl(`${HOST}/data/x`)).toBe(true);
    expect(isAllowedUrl('http://opendata-ajuntament.barcelona.cat/data/x')).toBe(false);
    expect(isAllowedUrl('https://opendata-ajuntament.barcelona.cat.evil.example/x')).toBe(false);
    expect(isAllowedUrl('not a url')).toBe(false);
  });

  test('package_show is built from the API base and the dataset id', () => {
    expect(packageShowUrl('estat-estacions-bicing')).toBe(
      `${HOST}/data/api/3/action/package_show?id=estat-estacions-bicing`,
    );
  });

  test('inRange is inclusive and open-ended', () => {
    const months = ['2019-03', '2024-01', '2024-12', '2026-09'].map((month) => ({
      dataset: 'estat-estacions-bicing' as const,
      id: month,
      name: month,
      url: '',
      month,
      size: null,
      lastModified: null,
    }));
    expect(inRange(months, '2024-01', '2024-12').map((r) => r.month)).toEqual([
      '2024-01',
      '2024-12',
    ]);
    expect(inRange(months, null, '2019-03').map((r) => r.month)).toEqual(['2019-03']);
    expect(inRange(months, '2026-01', null).map((r) => r.month)).toEqual(['2026-09']);
  });
});
