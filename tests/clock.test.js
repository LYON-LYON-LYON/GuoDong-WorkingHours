const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright-core');

const PAGE_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

let browser;

before(async () => {
  const executablePath = process.env.CHROME_PATH || (fs.existsSync(EDGE_PATH) ? EDGE_PATH : undefined);
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox']
  });
});

after(async () => {
  await browser?.close();
});

async function openAt(time, viewport = { width: 1440, height: 1300 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.clock.install({ time: new Date(time) });
  await page.goto(PAGE_URL);
  await page.waitForTimeout(80);
  return { context, page, pageErrors, consoleErrors, requests };
}

async function snapshot(page) {
  return page.evaluate(() => {
    const text = selector => document.querySelector(selector)?.textContent.trim() ?? null;
    const scroller = document.querySelector('.schedule-scroll');
    return {
      title: text('#reach-title'),
      detail: text('#reach-detail'),
      nextLabel: text('#reach-next-label'),
      next: text('#reach-next'),
      nextLocal: text('#reach-next-local'),
      badges: ['beijing', 'kazakhstan', 'russia'].map(key => text(`#duty-${key}`)),
      hints: ['beijing', 'kazakhstan', 'russia'].map(key => text(`#hint-${key}`)),
      commonBars: [...document.querySelectorAll('.common-bar')].map(element => ({
        text: element.textContent.trim(),
        width: Math.round(element.getBoundingClientRect().width * 10) / 10,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      })),
      workBars: [...document.querySelectorAll('.work-bar')].map(element => element.textContent.trim()),
      h1: text('h1'),
      bodyScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      globeSideWidth: Math.round((document.querySelector('.globe-side')?.getBoundingClientRect().width ?? 0) * 10) / 10,
      panelWidths: {
        globe: Math.round((document.querySelector('.globe-panel')?.getBoundingClientRect().width ?? 0) * 10) / 10,
        calendar: Math.round((document.querySelector('.calendar-panel')?.getBoundingClientRect().width ?? 0) * 10) / 10
      },
      calendars: [...document.querySelectorAll('.calendar-card')].map(card => ({
        key: card.dataset.calendarKey,
        month: card.querySelector('.calendar-month-title')?.textContent.trim() ?? null,
        localDates: card.querySelector('.calendar-local-dates')?.textContent.trim() ?? null,
        days: card.querySelectorAll('.calendar-day:not(.is-empty)').length,
        weekends: [...card.querySelectorAll('.calendar-day.is-weekend')].map(element => Number(element.querySelector('.calendar-day-number')?.textContent)),
        holidays: [...card.querySelectorAll('.calendar-day.is-holiday')].map(element => Number(element.querySelector('.calendar-day-number')?.textContent)),
        overrides: [...card.querySelectorAll('.calendar-day.is-workday-override')].map(element => Number(element.querySelector('.calendar-day-number')?.textContent)),
        today: Number(card.querySelector('.calendar-day.is-today .calendar-day-number')?.textContent ?? NaN),
        notes: [...card.querySelectorAll('.calendar-note')].map(note => note.textContent.replace(/\s+/g, ' ').trim()),
        holidayMarks: Object.fromEntries([...card.querySelectorAll('.calendar-day.is-holiday')].map(cell => [
          Number(cell.querySelector('.calendar-day-number')?.textContent),
          [...cell.querySelectorAll('.calendar-mark')].map(mark => mark.dataset.countryKey)
        ])),
        hidden: card.hidden
      })),
      calendar: (() => {
        const grid = document.querySelector('#calendar-grid');
        return {
          clientWidth: grid?.clientWidth ?? null,
          scrollWidth: grid?.scrollWidth ?? null,
          role: grid?.getAttribute('role') ?? null,
          ariaLabel: grid?.getAttribute('aria-label') ?? null
        };
      })(),
      schedule: {
        clientWidth: scroller?.clientWidth ?? null,
        scrollWidth: scroller?.scrollWidth ?? null,
        tabindex: scroller?.getAttribute('tabindex') ?? null,
        role: scroller?.getAttribute('role') ?? null,
        ariaLabel: scroller?.getAttribute('aria-label') ?? null,
        hintVisible: getComputedStyle(document.querySelector('.schedule-mobile-hint')).display !== 'none'
      }
    };
  });
}

function assertHealthy(pageErrors, consoleErrors) {
  assert.deepEqual(pageErrors, [], `pageerror: ${pageErrors.join(' | ')}`);
  assert.deepEqual(consoleErrors, [], `console.error: ${consoleErrors.join(' | ')}`);
}

async function runAxe(page) {
  await page.addScriptTag({ path: AXE_PATH });
  const violations = await page.evaluate(async () => {
    const report = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
    });
    return report.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map(node => node.target)
    }));
  });
  assert.deepEqual(violations, [], `axe violations: ${JSON.stringify(violations, null, 2)}`);
}

test('Monday 14:30 shows three-way coverage and refreshes all second hands', { timeout: 30000 }, async () => {
  const run = await openAt('2026-11-09T14:30:00+08:00');
  try {
    const state = await snapshot(run.page);
    assert.equal(state.h1, '国动 世界时钟');
    assert.equal(state.title, '三地均在岗，可直接联络');
    assert.equal(state.detail, '北京 14:30 · 阿拉木图 11:30 · 莫斯科 09:30');
    assert.equal(state.nextLabel, '当前共同窗口');
    assert.equal(state.next, '至 15:00');
    assert.deepEqual(state.badges, ['办公中', '办公中', '办公中']);
    assert.deepEqual(state.commonBars.map(bar => bar.text), ['14–15', '16–17']);
    assert.ok(state.workBars.includes('09:00–12:00'));
    assert.ok(state.workBars.includes('16:00–21:00'));
    assert.ok(state.workBars.includes('18:00–22:30'));

    const before = await run.page.evaluate(() => ['beijing', 'kazakhstan', 'russia'].map(key =>
      document.querySelector(`#clock-${key}-second`)?.getAttribute('transform') ?? null
    ));
    await run.page.clock.runFor(650);
    const after = await run.page.evaluate(() => ['beijing', 'kazakhstan', 'russia'].map(key =>
      document.querySelector(`#clock-${key}-second`)?.getAttribute('transform') ?? null
    ));
    before.forEach((value, index) => {
      assert.ok(value, `missing second hand ${index}`);
      assert.notEqual(after[index], value, `second hand ${index} did not advance`);
    });
    assertHealthy(run.pageErrors, run.consoleErrors);
    assert.ok(run.requests.every(url => url.startsWith('file:')), `external request: ${run.requests.join(', ')}`);
  } finally {
    await run.context.close();
  }
});

test('workday boundaries and weekend state stay accurate', { timeout: 45000 }, async () => {
  const cases = [
    {
      time: '2026-11-09T06:30:00+08:00',
      title: '本部尚未上班，暂不宜联络',
      next: '今天 14:00–15:00（北京时间）',
      badges: ['未上班', '未上班', '未上班']
    },
    {
      time: '2026-11-09T10:00:00+08:00',
      title: '部分在岗，暂不宜全员联络',
      next: '今天 14:00–15:00（北京时间）',
      badges: ['办公中', '未上班', '未上班']
    },
    {
      time: '2026-11-09T12:30:00+08:00',
      title: '本部午休，暂不宜全员联络',
      next: '今天 14:00–15:00（北京时间）',
      badges: ['午休中', '办公中', '未上班']
    },
    {
      time: '2026-11-09T14:59:30+08:00',
      title: '三地均在岗，可直接联络',
      next: '至 15:00',
      badges: ['办公中', '办公中', '办公中']
    },
    {
      time: '2026-11-09T15:30:00+08:00',
      title: '有人午休，暂不宜全员联络',
      next: '今天 16:00–17:00（北京时间）',
      badges: ['办公中', '午休中', '办公中']
    },
    {
      time: '2026-11-09T17:30:00+08:00',
      title: '本部已下班，暂不宜全员联络',
      next: '明天 14:00–15:00（北京时间）',
      badges: ['已下班', '办公中', '午休中']
    },
    {
      time: '2026-11-09T23:00:00+08:00',
      title: '当前非办公时间',
      next: '明天 14:00–15:00（北京时间）',
      badges: ['已下班', '已下班', '已下班']
    },
    {
      time: '2026-11-07T10:00:00+08:00',
      title: '三地周末休息',
      next: '周一 14:00–15:00（北京时间）',
      badges: ['周末休息', '周末休息', '周末休息']
    }
  ];

  for (const item of cases) {
    const run = await openAt(item.time);
    try {
      const state = await snapshot(run.page);
      assert.equal(state.title, item.title, item.time);
      assert.equal(state.next, item.next, item.time);
      assert.deepEqual(state.badges, item.badges, item.time);
      assertHealthy(run.pageErrors, run.consoleErrors);
    } finally {
      await run.context.close();
    }
  }
});

test('timezone filters update the conclusion, cards, and common window', { timeout: 30000 }, async () => {
  const run = await openAt('2026-11-09T14:30:00+08:00');
  try {
    await run.page.locator('#toggle-kazakhstan').evaluate(element => element.click());
    await run.page.waitForTimeout(80);
    const twoPlaces = await snapshot(run.page);
    assert.equal(await run.page.locator('.clock-card.kazakhstan').isHidden(), true);
    assert.equal(await run.page.locator('.status-card.kazakhstan').isHidden(), true);
    assert.equal(twoPlaces.calendars.length, 1);
    assert.ok(!twoPlaces.calendars[0].localDates.includes('哈萨克斯坦'));
    assert.ok(!twoPlaces.calendars[0].notes.join(' ').includes('哈萨克斯坦'));
    assert.equal(twoPlaces.title, '两地均在岗，可直接联络');
    assert.deepEqual(twoPlaces.commonBars.map(bar => bar.text), ['14–17']);

    await run.page.locator('#toggle-russia').evaluate(element => element.click());
    await run.page.waitForTimeout(80);
    const onePlace = await snapshot(run.page);
    assert.equal(onePlace.title, '北京在岗，可联络');
    assert.equal(onePlace.commonBars.length, 2);
    assertHealthy(run.pageErrors, run.consoleErrors);
  } finally {
    await run.context.close();
  }
});

test('390px layout keeps the globe and scrollable timeline usable', { timeout: 30000 }, async () => {
  const run = await openAt('2026-11-09T14:30:00+08:00', { width: 390, height: 1100 });
  try {
    const state = await snapshot(run.page);
    assert.ok(state.bodyScrollWidth <= state.innerWidth, `${state.bodyScrollWidth} > ${state.innerWidth}`);
    assert.ok(state.globeSideWidth > 200, `globe side width ${state.globeSideWidth}`);
    assert.equal(state.calendars.length, 1);
    assert.ok(state.calendar.scrollWidth <= state.calendar.clientWidth + 1, `calendar overflows: ${JSON.stringify(state.calendar)}`);
    assert.equal(state.calendar.role, 'region');
    assert.ok(state.calendar.ariaLabel?.includes('合并月历'));
    assert.ok(state.schedule.scrollWidth > state.schedule.clientWidth);
    assert.equal(state.schedule.tabindex, '0');
    assert.equal(state.schedule.role, 'region');
    assert.ok(state.schedule.ariaLabel?.includes('时间轴'));
    assert.equal(state.schedule.hintVisible, true);
    for (const bar of state.commonBars) {
      assert.ok(bar.scrollWidth <= bar.clientWidth + 1, `common bar text overflows: ${JSON.stringify(bar)}`);
    }
    assertHealthy(run.pageErrors, run.consoleErrors);
  } finally {
    await run.context.close();
  }
});

test('timezone conversion and three-way intersections are derived correctly', { timeout: 30000 }, async () => {
  const run = await openAt('2026-11-09T14:30:00+08:00');
  try {
    const values = await run.page.evaluate(() => ({
      almatyOffset: getOffsetMinutes(new Date('2026-07-01T00:00:00Z'), 'Asia/Almaty'),
      moscowOffset: getOffsetMinutes(new Date('2026-07-01T00:00:00Z'), 'Europe/Moscow'),
      beijingTime: formatClock(toBeijingWindow(PLACES.kazakhstan, { start: 11 * 60 + 30, end: 12 * 60 }).start),
      threeWay: threeWayWindows(),
      declination: solarElements(toJulianDay(new Date('2026-11-05T12:00:00Z'))).declination
    }));
    assert.equal(values.almatyOffset, 300);
    assert.equal(values.moscowOffset, 180);
    assert.equal(values.beijingTime, '14:30');
    assert.deepEqual(values.threeWay, [{ start: 840, end: 900 }, { start: 960, end: 1020 }]);
    assert.ok(values.declination > -17 && values.declination < -15, `solar declination ${values.declination}`);
    assertHealthy(run.pageErrors, run.consoleErrors);
  } finally {
    await run.context.close();
  }
});

test('top module splits evenly and renders one merged month calendar', { timeout: 30000 }, async () => {
  const run = await openAt('2026-11-09T14:30:00+08:00');
  try {
    const state = await snapshot(run.page);
    assert.ok(Math.abs(state.panelWidths.globe - state.panelWidths.calendar) < 1.5, JSON.stringify(state.panelWidths));
    assert.equal(state.calendars.length, 1);
    const merged = state.calendars[0];
    assert.equal(merged.key, 'merged');
    assert.equal(merged.month, '2026年11月');
    assert.equal(merged.days, 30);
    assert.equal(merged.weekends.length, 9);
    assert.deepEqual(merged.holidays, [4]);
    assert.deepEqual(merged.overrides, []);
    assert.equal(merged.today, 9);
    assert.deepEqual(merged.holidayMarks[4], ['russia']);
    assert.ok(merged.localDates.includes('北京 11月9日'));
    assert.ok(merged.localDates.includes('阿拉木图 11月9日'));
    assert.ok(merged.localDates.includes('莫斯科 11月9日'));
    assert.ok(merged.notes[0].includes('11月4日'));
    assert.ok(merged.notes[0].includes('俄罗斯民族团结日'));
    assert.ok(merged.notes[0].includes('中国、哈萨克斯坦无法定假期'));
    assert.equal(state.calendar.role, 'region');
    assert.ok(state.calendar.ariaLabel.includes('合并月历'));
    assertHealthy(run.pageErrors, run.consoleErrors);
  } finally {
    await run.context.close();
  }
});

test('merged calendar anchors on Beijing month and shows local date differences', { timeout: 30000 }, async () => {
  const run = await openAt('2026-12-01T02:00:00+08:00');
  try {
    const state = await snapshot(run.page);
    assert.equal(state.calendars.length, 1);
    const merged = state.calendars[0];
    assert.equal(merged.month, '2026年12月');
    assert.equal(merged.days, 31);
    assert.equal(merged.today, 1);
    assert.ok(merged.localDates.includes('北京 12月1日'));
    assert.ok(merged.localDates.includes('阿拉木图 11月30日'));
    assert.ok(merged.localDates.includes('莫斯科 11月30日'));
    assertHealthy(run.pageErrors, run.consoleErrors);
  } finally {
    await run.context.close();
  }
});

test('holidays and makeup workdays drive duty state and next shared window', { timeout: 30000 }, async () => {
  const holidayRun = await openAt('2026-10-01T14:30:00+08:00');
  try {
    const state = await snapshot(holidayRun.page);
    assert.deepEqual(state.badges, ['国庆节', '办公中', '办公中']);
    const merged = state.calendars[0];
    assert.deepEqual(merged.holidays, [1, 2, 3, 4, 5, 6, 7, 25, 26]);
    assert.deepEqual(merged.overrides, [10]);
    assert.ok(merged.notes.some(note => note.includes('1–7日') && note.includes('中国国庆节') && note.includes('哈萨克斯坦、俄罗斯无法定假期')));
    assert.ok(merged.notes.some(note => note.includes('10日') && note.includes('中国调休上班') && note.includes('无调休')));
    assert.ok(merged.notes.some(note => note.includes('10月25日') && note.includes('哈萨克斯坦共和国日')));
    assert.ok(merged.notes.some(note => note.includes('10月26日') && note.includes('共和国日（补休）')));
    assert.deepEqual(merged.holidayMarks[25], ['kazakhstan']);
    assert.deepEqual(merged.holidayMarks[1], ['beijing']);
    assert.ok(state.next.includes('10月8日'), state.next);
    assert.ok(state.next.includes('14:00–15:00'), state.next);
    assertHealthy(holidayRun.pageErrors, holidayRun.consoleErrors);
  } finally {
    await holidayRun.context.close();
  }

  const overrideRun = await openAt('2026-09-20T14:30:00+08:00');
  try {
    const state = await snapshot(overrideRun.page);
    assert.deepEqual(state.badges, ['办公中', '周末休息', '周末休息']);
    assert.deepEqual(state.calendars[0].overrides, [20]);
    assert.ok(state.calendars[0].notes.some(note => note.includes('20日') && note.includes('中国调休上班')));
    assert.equal(state.next, '明天 14:00–15:00（北京时间）');
    assertHealthy(overrideRun.pageErrors, overrideRun.consoleErrors);
  } finally {
    await overrideRun.context.close();
  }
});

test('shared holidays show all country markers in the merged calendar', { timeout: 30000 }, async () => {
  const run = await openAt('2026-01-01T14:30:00+08:00');
  try {
    const state = await snapshot(run.page);
    const merged = state.calendars[0];
    assert.deepEqual(merged.holidayMarks[1], ['beijing', 'kazakhstan', 'russia']);
    const sharedNote = merged.notes.find(note => note.includes('1月1'));
    assert.ok(sharedNote.includes('中国元旦'));
    assert.ok(sharedNote.includes('哈萨克斯坦新年'));
    assert.ok(sharedNote.includes('俄罗斯新年假期'));
    assert.ok(!sharedNote.includes('无法定假期'));
    assertHealthy(run.pageErrors, run.consoleErrors);
  } finally {
    await run.context.close();
  }
});

test('desktop and mobile pass axe WCAG 2.1 A/AA', { timeout: 45000 }, async () => {
  for (const viewport of [{ width: 1440, height: 1300 }, { width: 390, height: 1100 }]) {
    const run = await openAt('2026-11-09T14:30:00+08:00', viewport);
    try {
      await runAxe(run.page);
      assertHealthy(run.pageErrors, run.consoleErrors);
    } finally {
      await run.context.close();
    }
  }
});
