// 0.3.0 — supply chain: manifest parsing, version extraction,
// OSV severity mapping, and the deterministic risk score.

import { describe, expect, it } from 'vitest';

import { cvssBaseScore, severityForCvssVector, severityForDbSpecific } from '../../src/supply-chain/cvss';
import { highestCvssScore, severityFromDetail, severityLevelForScore } from '../../src/supply-chain/osv-client';
import {
  baseVersion,
  findManifests,
  hasNpmLockfile,
  parseCargoToml,
  parseGemfile,
  parseGoMod,
  parsePackageJson,
  parseRequirementsTxt,
} from '../../src/supply-chain/manifests';
import { scoreSupplyChainRisk } from '../../src/supply-chain/scoring';

describe('baseVersion', () => {
  it('takes the minimum version of a range', () => {
    expect(baseVersion('^4.17.21')).toBe('4.17.21');
    expect(baseVersion('~1.0')).toBe('1.0');
    expect(baseVersion('>=2.0,<3')).toBe('2.0');
    expect(baseVersion('v1.2.3')).toBe('v1.2.3');
    expect(baseVersion('1.2.3')).toBe('1.2.3');
    expect(baseVersion('~> 7.0')).toBe('7.0');
  });
  it('returns null when no version is pinned', () => {
    expect(baseVersion(null)).toBeNull();
    expect(baseVersion('*')).toBeNull();
    expect(baseVersion('latest')).toBeNull();
    expect(baseVersion('')).toBeNull();
  });
});

describe('findManifests / hasNpmLockfile', () => {
  it('finds root manifests in discovery order and caps at 5', () => {
    const found = findManifests([
      'README.md',
      'package.json',
      'src/nested/package.json',
      'requirements.txt',
      'go.mod',
      'Cargo.toml',
      'Gemfile',
      'package-lock.json',
    ]);
    expect(found.map((m) => m.path)).toEqual([
      'package.json',
      'requirements.txt',
      'go.mod',
      'Cargo.toml',
      'Gemfile',
    ]);
    // Nested manifests are out of scope in 0.3.0 (root only).
    expect(found).toHaveLength(5);
  });
  it('returns none when there is no supported manifest', () => {
    expect(findManifests(['README.md', 'index.html'])).toEqual([]);
  });
  it('detects the npm lockfile marker', () => {
    expect(hasNpmLockfile(['package.json', 'package-lock.json'])).toBe(true);
    expect(hasNpmLockfile(['package.json'])).toBe(false);
  });
});

describe('parsePackageJson', () => {
  it('reads dependencies and devDependencies', () => {
    const deps = parsePackageJson(
      JSON.stringify({
        dependencies: { lodash: '^4.17.21', react: '19.2.0' },
        devDependencies: { vitest: '^3.0.0', typescript: 'file:../ts' },
      }),
      'package.json',
    );
    expect(deps).toHaveLength(4);
    expect(deps[0]).toMatchObject({ name: 'lodash', ecosystem: 'npm', versionSpec: '^4.17.21', checkVersion: '4.17.21', dev: false, osvChecked: true });
    expect(deps[2]).toMatchObject({ name: 'vitest', dev: true });
    // A non-range spec has no check version — listed, not checked.
    expect(deps[3]).toMatchObject({ name: 'typescript', checkVersion: null, osvChecked: false });
  });
  it('returns [] for invalid JSON', () => {
    expect(parsePackageJson('{ nope', 'package.json')).toEqual([]);
  });
});

describe('parseRequirementsTxt', () => {
  it('parses pins, ranges and bare names; skips comments and options', () => {
    const deps = parseRequirementsTxt(
      [
        '# comment',
        'requests==2.31.0',
        'Flask>=2.0',
        'numpy',
        '-r other.txt',
        'Django[argon2]~=4.2',
        '',
      ].join('\n'),
      'requirements.txt',
    );
    expect(deps.map((d) => [d.name, d.checkVersion])).toEqual([
      ['requests', '2.31.0'],
      ['flask', '2.0'],
      ['numpy', null],
      ['django', '4.2'],
    ]);
    expect(deps[2]?.osvChecked).toBe(false);
  });
});

describe('parseGoMod', () => {
  it('parses block and single-line requires, skips indirect deps', () => {
    const deps = parseGoMod(
      [
        'module example.com/foo',
        '',
        'go 1.21',
        '',
        'require github.com/spf13/cobra v1.8.0',
        '',
        'require (',
        '\tgithub.com/pkg/errors v0.9.1',
        '\tgolang.org/x/text v0.14.0 // indirect',
        ')',
      ].join('\n'),
      'go.mod',
    );
    expect(deps.map((d) => [d.name, d.checkVersion])).toEqual([
      ['github.com/spf13/cobra', 'v1.8.0'],
      ['github.com/pkg/errors', 'v0.9.1'],
    ]);
  });
});

describe('parseCargoToml', () => {
  it('parses string and table dependency forms', () => {
    const deps = parseCargoToml(
      [
        '[dependencies]',
        'serde = "1.0"',
        'tokio = { version = "1.35", features = ["full"] }',
        '',
        '[dev-dependencies]',
        'criterion = "0.5"',
        '',
        '[profile.release]',
        'opt-level = 3',
      ].join('\n'),
      'Cargo.toml',
    );
    expect(deps.map((d) => [d.name, d.checkVersion, d.dev])).toEqual([
      ['serde', '1.0', false],
      ['tokio', '1.35', false],
      ['criterion', '0.5', true],
    ]);
  });
});

describe('parseGemfile', () => {
  it('parses gem lines with and without versions', () => {
    const deps = parseGemfile(
      ["source 'https://rubygems.org'", "gem 'rails', '~> 7.0'", 'gem "puma"', 'gem "nokogiri", "1.15.0"'].join('\n'),
      'Gemfile',
    );
    expect(deps.map((d) => [d.name, d.checkVersion])).toEqual([
      ['rails', '7.0'],
      ['puma', null],
      ['nokogiri', '1.15.0'],
    ]);
  });
});

describe('OSV severity mapping', () => {
  it('maps CVSS bands to levels', () => {
    expect(severityLevelForScore(9.8)).toBe('critical');
    expect(severityLevelForScore(9.0)).toBe('critical');
    expect(severityLevelForScore(7.5)).toBe('high');
    expect(severityLevelForScore(5.0)).toBe('medium');
    expect(severityLevelForScore(2.0)).toBe('low');
    expect(severityLevelForScore(null)).toBe('unknown');
  });
  it('picks the highest numeric CVSS score and ignores non-CVSS entries', () => {
    expect(
      highestCvssScore([
        { type: 'CVSS_V3', score: '5.3' },
        { type: 'CVSS_V4', score: '8.1' },
        { type: 'OTHER', score: '9.9' },
      ]),
    ).toBe(8.1);
    expect(highestCvssScore(undefined)).toBeNull();
    expect(highestCvssScore([{ type: 'OTHER', score: '9.9' }])).toBeNull();
  });
  it('ignores vector strings — they are scored by cvss.ts, not parseFloat', () => {
    expect(
      highestCvssScore([{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H' }]),
    ).toBeNull();
  });
  it('resolves detail severity: CVSS vector first, then database word, then unknown', () => {
    expect(
      severityFromDetail({
        severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H' }],
        database_specific: { severity: 'LOW' },
      }),
    ).toEqual({ level: 'high', score: 7.4 });
    expect(
      severityFromDetail({ severity: [], database_specific: { severity: 'HIGH' } }),
    ).toEqual({ level: 'high', score: null });
    expect(severityFromDetail({})).toEqual({ level: 'unknown', score: null });
  });
});

describe('CVSS 3.1 base score (FIRST.org formula)', () => {
  it('scores real lodash vectors to their published NVD scores', () => {
    // CVE-2020-8203 (prototype pollution): NVD 7.4 High.
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H')).toBe(7.4);
    // CVE-2020-28500 (ReDoS): NVD 5.3 Medium.
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L')).toBe(5.3);
  });
  it('scores a scope-changed vector (Log4Shell) at 10.0', () => {
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')).toBe(10);
  });
  it('scores a zero-impact vector at 0', () => {
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N')).toBe(0);
  });
  it('rejects non-3.1 vectors and malformed strings', () => {
    expect(cvssBaseScore('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N')).toBeNull();
    expect(cvssBaseScore('7.4')).toBeNull();
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H')).toBeNull();
  });
  it('maps vectors to levels with their scores', () => {
    expect(severityForCvssVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')).toEqual({
      level: 'critical',
      score: 10,
    });
    expect(severityForCvssVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L')).toEqual({
      level: 'medium',
      score: 5.3,
    });
    expect(severityForCvssVector('not-a-vector')).toBeNull();
  });
  it('maps database severity words', () => {
    expect(severityForDbSpecific('CRITICAL')).toBe('critical');
    expect(severityForDbSpecific('HIGH')).toBe('high');
    expect(severityForDbSpecific('MODERATE')).toBe('medium');
    expect(severityForDbSpecific('LOW')).toBe('low');
    expect(severityForDbSpecific(undefined)).toBe('unknown');
    expect(severityForDbSpecific('???')).toBe('unknown');
  });
});

describe('scoreSupplyChainRisk', () => {
  it('scores 100 with no vulnerabilities, no abandoned deps, lockfile present', () => {
    const { score, label } = scoreSupplyChainRisk({
      severities: [],
      abandonedCount: 0,
      hasNpmManifest: true,
      hasLockfile: true,
    });
    expect(score).toBe(100);
    expect(label).toBe('low');
  });
  it('deducts per severity and caps the vulnerability total at 60', () => {
    const { score, label } = scoreSupplyChainRisk({
      severities: ['critical', 'critical', 'critical', 'high'],
      abandonedCount: 0,
      hasNpmManifest: false,
      hasLockfile: false,
    });
    // 25+25+25+15 = 90, capped at 60 → 40.
    expect(score).toBe(40);
    expect(label).toBe('elevated');
  });
  it('treats unknown severity as medium', () => {
    const { score } = scoreSupplyChainRisk({
      severities: ['unknown'],
      abandonedCount: 0,
      hasNpmManifest: false,
      hasLockfile: false,
    });
    expect(score).toBe(93);
  });
  it('caps the abandoned deduction at 20 and applies the lockfile penalty', () => {
    const { score, label } = scoreSupplyChainRisk({
      severities: [],
      abandonedCount: 10,
      hasNpmManifest: true,
      hasLockfile: false,
    });
    // Abandoned 10×5 = 50, capped 20; no lockfile −5 → 75.
    expect(score).toBe(75);
    expect(label).toBe('moderate');
  });
  it('does not apply the lockfile penalty without an npm manifest', () => {
    const { score } = scoreSupplyChainRisk({
      severities: [],
      abandonedCount: 0,
      hasNpmManifest: false,
      hasLockfile: false,
    });
    expect(score).toBe(100);
  });
  it('never scores below 0 and labels the bands', () => {
    const { score, label } = scoreSupplyChainRisk({
      severities: ['critical', 'critical', 'critical'],
      abandonedCount: 10,
      hasNpmManifest: true,
      hasLockfile: false,
    });
    // 60 (capped) + 20 (capped) + 5 = 85 → 15.
    expect(score).toBe(15);
    expect(label).toBe('high');
  });
  it('treats an entirely unknown abandoned count as zero deduction', () => {
    const { score } = scoreSupplyChainRisk({
      severities: [],
      abandonedCount: null,
      hasNpmManifest: false,
      hasLockfile: false,
    });
    expect(score).toBe(100);
  });
});
