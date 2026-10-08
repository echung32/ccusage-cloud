import { afterEach, describe, expect, it } from 'vitest';
import { readFiltersFromUrl, writeFiltersToUrl } from '../filters';

afterEach(() => window.history.replaceState({}, '', '/'));
describe('personal URL filters', () => {
  it('ignores legacy group scope while retaining supported filters', () => {
    window.history.replaceState({}, '', '/projects?scope=group&source=cursor&device=d1');
    expect(readFiltersFromUrl()).toEqual({ source: 'cursor', device: 'd1' });
  });
  it('removes legacy scope but preserves unrelated parameters and the hash', () => {
    window.history.replaceState({}, '', '/projects?scope=group&returned=1#main');
    writeFiltersToUrl({ source: 'cursor' });
    expect(window.location.pathname).toBe('/projects');
    expect(window.location.search).toBe('?returned=1&source=cursor');
    expect(window.location.hash).toBe('#main');
    writeFiltersToUrl({});
    expect(window.location.search).toBe('?returned=1');
  });
});
