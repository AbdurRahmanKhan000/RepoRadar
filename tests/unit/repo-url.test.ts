import { describe, expect, it } from 'vitest';
import { parseRepoFromUrl, repoId, repoUrl } from '../../src/shared/repo-url';

describe('parseRepoFromUrl — FR-01 detection', () => {
  it('resolves a plain repository page', () => {
    expect(parseRepoFromUrl('https://github.com/facebook/react')).toEqual({
      owner: 'facebook',
      repo: 'react',
    });
  });

  it('resolves repository sub-pages to the same owner/repo', () => {
    expect(parseRepoFromUrl('https://github.com/facebook/react/tree/main/packages')).toEqual({
      owner: 'facebook',
      repo: 'react',
    });
    expect(parseRepoFromUrl('https://github.com/facebook/react/issues/123')).toEqual({
      owner: 'facebook',
      repo: 'react',
    });
    expect(parseRepoFromUrl('https://github.com/facebook/react/pulls')).toEqual({
      owner: 'facebook',
      repo: 'react',
    });
    expect(parseRepoFromUrl('https://github.com/facebook/react/releases')).toEqual({
      owner: 'facebook',
      repo: 'react',
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parseRepoFromUrl('https://github.com/facebook/react/')).toEqual({
      owner: 'facebook',
      repo: 'react',
    });
  });

  it('resolves hyphenated, dotted and underscored names', () => {
    expect(parseRepoFromUrl('https://github.com/AbdurRahmanKhan000/arkConvert')).toEqual({
      owner: 'AbdurRahmanKhan000',
      repo: 'arkConvert',
    });
    expect(parseRepoFromUrl('https://github.com/vuejs/core')).toEqual({
      owner: 'vuejs',
      repo: 'core',
    });
  });

  it('ignores profile pages (one segment)', () => {
    expect(parseRepoFromUrl('https://github.com/facebook')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/facebook/')).toBeNull();
  });

  it('ignores global routes', () => {
    for (const url of [
      'https://github.com/',
      'https://github.com/issues',
      'https://github.com/pulls',
      'https://github.com/settings',
      'https://github.com/settings/profile',
      'https://github.com/explore',
      'https://github.com/trending',
      'https://github.com/search?q=react',
      'https://github.com/notifications',
      'https://github.com/marketplace',
      'https://github.com/organizations/new',
      'https://github.com/new',
      'https://github.com/login',
    ]) {
      expect(parseRepoFromUrl(url), url).toBeNull();
    }
  });

  it('ignores repository settings pages', () => {
    expect(parseRepoFromUrl('https://github.com/facebook/react/settings')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/facebook/react/settings/access')).toBeNull();
  });

  it('rejects non-GitHub hosts and invalid URLs', () => {
    expect(parseRepoFromUrl('https://gitlab.com/facebook/react')).toBeNull();
    expect(parseRepoFromUrl('https://example.com/facebook/react')).toBeNull();
    expect(parseRepoFromUrl('not a url')).toBeNull();
    expect(parseRepoFromUrl('')).toBeNull();
  });

  it('builds repo id and URL helpers', () => {
    const ctx = { owner: 'facebook', repo: 'react' };
    expect(repoId(ctx)).toBe('facebook/react');
    expect(repoUrl(ctx)).toBe('https://github.com/facebook/react');
  });
});
