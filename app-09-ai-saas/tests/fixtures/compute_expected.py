#!/usr/bin/env python3
"""Writes <date>/expected.json from the captured npm rows and release lists in this folder.

Test data only, not app code. Written from the spec (rev 7, sections 1-2) with exact
fractions, independent of the TypeScript in shared/. Run: python3 -I compute_expected.py
"""
import datetime
import json
import os
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
WINDOW_NAME = {30: 'the past month', 90: 'the past three months', 365: 'the past year'}


def fname(name):
    return name.replace('@', '', 1).replace('/', '-')


def add(day, n):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=n)).isoformat()


def load_rows(date, name):
    body = json.load(open(f'{HERE}/{date}/npm-{fname(name)}.json'))
    return {r['day']: r['downloads'] for r in body['downloads']}


def load_releases(date, name):
    return json.load(open(f'{HERE}/{date}/releases-{fname(name)}.json'))['releases']


def median(values):
    s = sorted(values)
    k = len(s)
    return Fraction(s[k // 2]) if k % 2 else Fraction(s[k // 2 - 1] + s[k // 2], 2)


def semver_key(version):
    return tuple(int(p) for p in version.split('.'))


def round_half_away(x, places):
    """Fraction -> integer count of 10**-places units, half away from zero."""
    scaled = x * 10 ** places
    n = abs(scaled.numerator) * 2 + abs(scaled.denominator)
    q = n // (2 * scaled.denominator)
    return q if scaled >= 0 else -q


def signed(units, places):
    sign = '-' if units < 0 else '+'
    u = abs(units)
    return f'{sign}{u // 10 ** places}.{str(u % 10 ** places).zfill(places)}'


def frac(x):
    return None if x is None else f'{x.numerator}/{x.denominator}'


def scenario(date, names, days):
    rows = {n: load_rows(date, n) for n in names}
    solo = len(names) == 1
    all_days = sorted(set(d for r in rows.values() for d in r))
    before = [d for d in all_days if d < date]
    v = lambda n, d: rows[n].get(d, 0)
    no_data = [] if solo else [d for d in before if all(v(n, d) == 0 for n in names)]
    nd = set(no_data)
    candidates = [d for d in before if (v(names[0], d) > 0 if solo else d not in nd)]
    if not candidates:
        return {'error': 'npm reports no downloads for these packages'}
    last = max(candidates)
    if last < add(date, -7):
        return {'error': 'npm has not published recent days yet'}
    start = add(last, -(days - 1))
    window = [add(start, i) for i in range(days)]
    past = [add(last, -29 + i) for i in range(30)]
    month_before = [add(last, -59 + i) for i in range(30)]
    out = {'runDate': date, 'L': last, 'days': days, 'start': start, 'name': WINDOW_NAME[days],
           'noData': no_data, 'past': [past[0], past[-1]], 'before': [month_before[0], month_before[-1]],
           'noDataInWindow': [d for d in no_data if start <= d <= last], 'packages': {}}
    for n in names:
        total = sum(v(n, d) for d in window)
        last30 = sum(v(n, d) for d in past)
        peak_day = window[0]
        for d in window:
            if v(n, d) > v(n, peak_day):
                peak_day = d
        pos1 = [d for d in past if v(n, d) > 0]
        pos0 = [d for d in month_before if v(n, d) > 0]
        s1, n1 = sum(v(n, d) for d in pos1), len(pos1)
        s0, n0 = sum(v(n, d) for d in pos0), len(pos0)
        computable = n1 > 0 and n0 > 0 and s0 > 0
        a1 = Fraction(s1, n1) if n1 else None
        a0 = Fraction(s0, n0) if n0 else None
        change = (a1 / a0 - 1) * 100 if computable else None
        releases = load_releases(date, n)
        unusual, gaps, not_assessed = [], [], []
        for d in window:
            if d in nd:
                continue
            vals = [v(n, add(d, -7 * k)) for k in range(1, 9)
                    if add(d, -7 * k) in rows[n] and add(d, -7 * k) not in nd and v(n, add(d, -7 * k)) > 0]
            if len(vals) < 4 or median(vals) < 100:
                not_assessed.append(d)
                continue
            m = median(vals)
            x = v(n, d)
            if x == 0:
                if solo or any(v(o, d) > 0 for o in names if o != n):
                    gaps.append(d)
                continue
            kind = 'spike' if 4 * x >= 6 * m else 'drop' if 4 * x <= 2 * m else None
            if kind is None:
                continue
            offsets = [(datetime.date.fromisoformat(d) - datetime.date.fromisoformat(r['day'])).days for r in releases]
            near = [o for o in offsets if 0 <= o <= 2]
            row = {'day': d, 'value': x, 'median': float(m), 'kind': kind, 'release': min(near) if near else 'none'}
            if near:
                at = [r['version'] for r in releases
                      if (datetime.date.fromisoformat(d) - datetime.date.fromisoformat(r['day'])).days == min(near)]
                row['version'] = max(at, key=semver_key)
            unusual.append(row)
        strength = lambda u: Fraction(u['value']) / Fraction(u['median']) if u['kind'] == 'spike' \
            else Fraction(u['median']) / max(u['value'], 1)
        top = sorted(sorted(unusual, key=strength, reverse=True)[:6], key=lambda u: u['day'])
        out['packages'][n] = {
            'windowTotal': str(total), 'last30Total': str(last30), 'peakDay': peak_day, 'peakValue': v(n, peak_day),
            'S1': str(s1), 'n1': n1, 'S0': str(s0), 'n0': n0, 'computable': computable,
            'A1': frac(a1), 'A0': frac(a0), 'change': frac(change),
            'change1': signed(round_half_away(change, 1), 1) if computable else None,
            'change2': signed(round_half_away(change, 2), 2) if computable else None,
            'notAssessed': not_assessed, 'possibleGaps': gaps, 'unusual': unusual, 'top6': [u['day'] for u in top],
        }
    return out


def main():
    cfg = json.load(open(f'{HERE}/scenarios.json'))
    for date in cfg['dates']:
        result = {key: scenario(date, sc['names'], sc['days']) for key, sc in cfg['scenarios'].items()}
        with open(f'{HERE}/{date}/expected.json', 'w') as fh:
            json.dump(result, fh, indent=1)
            fh.write('\n')
        print(date, {k: (r.get('L'), len(r.get('noData', []))) for k, r in result.items()})


if __name__ == '__main__':
    main()
