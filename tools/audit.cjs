#!/usr/bin/env node
/*
 * Self-audit for clep-introductory-sociology-study-guide.html
 *
 * Loads the guide in headless Chromium (Playwright) and:
 *   1. checks every question, flashcard and unit statically;
 *   2. drives the diagnostic and both practice exams through the real UI
 *      with the keyboard, checking scoring, results by topic, the mistake
 *      log, the 90-minute auto-submit, and the readiness meter;
 *   3. exercises flashcards, the study plan, export, blocked storage, and
 *      the one-page cheat-sheet print.
 * Writes AUDIT.md next to the guide and exits non-zero on any failure.
 *
 * Usage: node tools/audit.cjs   (needs Playwright + Chromium)
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'clep-introductory-sociology-study-guide.html');
const URL = 'file://' + FILE;
const failures = [];
const log = [];
function check(cond, msg) { if (!cond) failures.push(msg); return cond; }
function out(line = '') { log.push(line); console.log(line); }

async function answerRunner(page, chooseCorrect) {
  // Answers the currently open runner (diagnostic/quiz) until it finishes.
  let n = 0;
  for (;;) {
    const qid = await page.$eval('.stem', el => el.dataset.qid).catch(() => null);
    if (!qid) break;
    const ans = await page.evaluate(id => window.__APP.QID[id].ans, qid);
    const pick = chooseCorrect(n, qid) ? ans : (ans + 1) % 5;
    await page.keyboard.press(String(pick + 1));
    await page.keyboard.press('Enter');
    n++;
    await page.waitForTimeout(5);
    if (n > 500) throw new Error('runner did not finish');
  }
  return n;
}

async function answerExam(page, chooseCorrect) {
  const total = await page.evaluate(() => document.querySelectorAll('#pal .palette button').length);
  for (let i = 0; i < total; i++) {
    const qid = await page.$eval('.stem', el => el.dataset.qid);
    const ans = await page.evaluate(id => window.__APP.QID[id].ans, qid);
    const pick = chooseCorrect(i, qid) ? ans : (ans + 2) % 5;
    await page.keyboard.press(String(pick + 1));
    if (i === 7) await page.keyboard.press('f'); // flag one question
    if (i < total - 1) await page.keyboard.press('Enter');
  }
  return total;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(URL);

  /* ---------------- 1. static checks ---------------- */
  const S = await page.evaluate(() => {
    const A = window.__APP, strip = s => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const problems = [];
    const stems = {};
    A.QB.forEach(q => {
      const id = q.id;
      if (!A.UNIT[q.u]) problems.push(id + ': bad unit tag');
      if (!['q', 'd', 'a', 'b', 'x', 'p'].includes(q.s)) problems.push(id + ': bad set');
      if (!['E', 'M', 'H'].includes(q.d)) problems.push(id + ': bad difficulty');
      if (q.o.length !== 5) problems.push(id + ': needs 5 options');
      if (new Set(q.o.map(strip)).size !== q.o.length) problems.push(id + ': duplicate options');
      const correct = q.opts.filter(o => o.ok).length;
      if (correct !== 1) problems.push(id + ': ' + correct + ' correct options');
      if (!q.opts[q.ans] || !q.opts[q.ans].ok) problems.push(id + ': answer index mismatch');
      q.opts.forEach((o, i) => { if (!o.e || strip(o.e).length < 15) problems.push(id + ': option ' + 'ABCDE'[i] + ' lacks explanation'); });
      q.o.forEach(t => { if (/all of the above|none of the above|both a and b/i.test(strip(t))) problems.push(id + ': uses all/none-of-the-above'); });
      const k = strip(q.q).toLowerCase();
      if (stems[k]) problems.push(id + ': duplicate stem of ' + stems[k]); else stems[k] = id;
    });
    const cardFronts = {};
    A.CARDS.forEach(c => {
      if (!c.f || !c.b) problems.push(c.id + ': empty flashcard');
      const k = strip(c.f).toLowerCase();
      if (cardFronts[k]) problems.push(c.id + ': duplicate card front of ' + cardFronts[k]); else cardFronts[k] = c.id;
    });
    const units = A.UNITS.map(u => {
      const qs = A.QB.filter(q => q.u === u.id && q.s !== 'p');
      const words = strip(u.lesson + ' ' + u.must.join(' ')).split(' ').length;
      return { id: u.id, short: u.short, title: u.title, area: u.area, weight: u.weight, minutes: u.minutes, words,
        must: u.must.length, cards: u.cards.length, visual: !!u.visual,
        q: qs.filter(q => q.s === 'q').length, d: qs.filter(q => q.s === 'd').length,
        a: qs.filter(q => q.s === 'a').length, b: qs.filter(q => q.s === 'b').length, x: qs.filter(q => q.s === 'x').length, total: qs.length };
    });
    const pos = s => { const p = [0, 0, 0, 0, 0]; A.QB.filter(q => s ? q.s === s : q.s !== 'p').forEach(q => p[q.ans]++); return p; };
    const diff = ['E', 'M', 'H'].map(d => A.QB.filter(q => q.s !== 'p' && q.d === d).length);
    return { problems, units, total: A.QB.filter(q => q.s !== 'p').length, cards: A.CARDS.filter(c => !c.person).length,
      sets: { q: A.QB.filter(q => q.s === 'q').length, d: A.QB.filter(q => q.s === 'd').length, a: A.QB.filter(q => q.s === 'a').length, b: A.QB.filter(q => q.s === 'b').length, x: A.QB.filter(q => q.s === 'x').length, p: A.QB.filter(q => q.s === 'p').length, people: (typeof PEOPLE !== 'undefined' ? PEOPLE : []).length, pcards: A.CARDS.filter(c => c.person).length },
      pos: { all: pos(), q: pos('q'), d: pos('d'), a: pos('a'), b: pos('b') }, diff,
      areas: window.__APP.UNITS.length && JSON.parse(JSON.stringify(Object.values(window.__APP.UNITS.reduce((m, u) => { m[u.area] = m[u.area] || { area: u.area, weight: 0 }; m[u.area].weight += u.weight; return m; }, {})))) };
  });
  S.problems.forEach(p => failures.push('static: ' + p));
  check(S.sets.d === 30, 'diagnostic should have 30 questions, has ' + S.sets.d);
  check(S.sets.a === 100 && S.sets.b === 100, 'each practice exam should have 100 questions');
  check(S.total >= 300, 'question bank should have 300+ questions');
  S.units.forEach(u => {
    check(u.q >= 10 && u.q <= 15, u.id + ' quiz should have 10-15 questions');
    check(u.must >= 5 && u.must <= 10, u.id + ' must-know box should have 5-10 items');
    check(u.minutes >= 10 && u.minutes <= 20, u.id + ' lesson should be a 10-20 minute read (is ' + u.minutes + ')');
    check(u.visual, u.id + ' needs a visual');
  });

  /* ---------------- 2a. diagnostic run-through ---------------- */
  await page.goto(URL + '#/diag');
  await page.click('#go');
  const diagSeen = [];
  let dn = 0;
  for (;;) {
    const qid = await page.$eval('.stem', el => el.dataset.qid).catch(() => null);
    if (!qid) break;
    diagSeen.push(qid);
    const ans = await page.evaluate(id => window.__APP.QID[id].ans, qid);
    const pick = dn % 3 === 2 ? (ans + 1) % 5 : ans; // miss every third question
    await page.keyboard.press(String(pick + 1));
    await page.keyboard.press('Enter');
    dn++;
  }
  const diag = await page.evaluate(() => window.__APP.state().diag);
  const diagCorrect = Math.ceil(dn * 2 / 3);
  check(dn === 30, 'diagnostic presented ' + dn + ' questions');
  check(new Set(diagSeen).size === dn, 'diagnostic repeated a question');
  check(diagSeen.every(id => /-d-/.test(id)), 'diagnostic showed a non-diagnostic question');
  check(diag && diag.score === Math.round(100 * diagCorrect / dn), 'diagnostic score ' + (diag && diag.score) + ' != expected');
  check(diag && Object.values(diag.res).reduce((a, r) => a + r[1], 0) === 30, 'diagnostic per-unit totals do not add to 30');
  const diagView = await page.textContent('#view');
  check(/Skim|Must study/.test(diagView), 'diagnostic results do not show skim/must-study verdicts');
  const mistakesAfterDiag = await page.evaluate(() => Object.keys(window.__APP.state().mistakes).length);
  check(mistakesAfterDiag === dn - diagCorrect, 'mistake log should hold ' + (dn - diagCorrect) + ' diagnostic misses, holds ' + mistakesAfterDiag);

  /* ---------------- 2b. unit quiz with immediate feedback ---------------- */
  await page.goto(URL + '#/quiz/u1');
  await page.keyboard.press('1');
  const shown = await page.$$eval('.why', els => els.filter(e => !e.hidden && e.textContent.length > 20).length);
  check(shown === 5, 'unit quiz should explain all 5 options after answering (showed ' + shown + ')');
  await page.keyboard.press('Enter');
  const qn = 1 + await answerRunner(page, () => true);
  check(qn === 15, 'U1 quiz presented ' + qn + ' questions');
  const u1 = await page.evaluate(() => window.__APP.state().units.u1);
  check(u1 && u1.attempts === 1 && u1.best >= 90, 'U1 quiz score not recorded correctly');

  /* ---------------- 2c. practice exam 1 (full, 100 Qs) ---------------- */
  await page.goto(URL + '#/exam/a');
  await page.click('#st');
  await page.click('#pl'); // open grid so the total can be read
  const navHidden = await page.evaluate(() => getComputedStyle(document.getElementById('nav')).display === 'none');
  check(navHidden, 'navigation should be hidden during a practice exam');
  const examSeen = new Set();
  page.on('framenavigated', () => {});
  const total = await answerExam(page, (i, qid) => { examSeen.add(qid); return i % 5 !== 4; }); // 80% correct
  check(total === 100, 'Practice Exam 1 has ' + total + ' questions');
  check([...examSeen].every(id => /-a-/.test(id)), 'Practice Exam 1 showed a question from another set');
  const flagged = await page.evaluate(() => Object.values(window.__APP.state().exams.a.live.flag).filter(Boolean).length);
  check(flagged === 1, 'flagging did not register');
  await page.click('#sb');
  await page.click('#mOk');
  await page.waitForTimeout(100);
  const ea = await page.evaluate(() => { const e = window.__APP.state().exams.a; return e.attempts[e.attempts.length - 1]; });
  check(ea && ea.score === 80, 'Practice Exam 1 score ' + (ea && ea.score) + ' (expected 80)');
  check(ea && Object.values(ea.byArea).reduce((a, r) => a + r[1], 0) === 100, 'exam results by area do not total 100');
  const areaBars = await page.$$eval('.hbar', els => els.length);
  check(areaBars >= 5 + 12, 'exam results should show 5 content areas and 12 units (found ' + areaBars + ' bars)');
  const overlapA = [...examSeen].filter(id => diagSeen.includes(id)).length;
  check(overlapA === 0, 'practice exam repeated diagnostic questions');

  /* ---------------- 2d. practice exam 2: 90-minute auto-submit ---------------- */
  await page.goto(URL + '#/exam/b');
  await page.click('#st');
  await page.keyboard.press('1');
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('clep-intro-sociology-v1')); st.exams.b.live.start = Date.now() - 91 * 60000; localStorage.setItem('clep-intro-sociology-v1', JSON.stringify(st)); });
  await page.goto(URL + '#/');
  await page.reload();
  await page.waitForTimeout(1500);
  const eb = await page.evaluate(() => { const e = window.__APP.state().exams.b; return { live: !!e.live, last: e.attempts[e.attempts.length - 1] }; });
  check(!eb.live && eb.last && eb.last.timedOut, 'exam did not auto-submit after 90 minutes');
  const notReady = await page.textContent('#readyChip');
  check(!/Ready to book/.test(notReady), 'readiness shows ready before both exams reach 75%');

  /* ---------------- 2e. retake exam 2 at 100% -> readiness ---------------- */
  await page.goto(URL + '#/exam/b');
  await page.click('#rt');
  await page.click('#st');
  await page.click('#pl');
  await answerExam(page, () => true);
  await page.click('#sb');
  await page.click('#mOk');
  await page.waitForTimeout(100);
  await page.goto(URL + '#/');
  const ready = await page.textContent('#readyChip');
  check(/Ready to book/.test(ready), 'readiness should say “Ready to book” when both exams are at least 75%');

  /* ---------------- 2f. extra practice and who's-who quiz ---------------- */
  await page.goto(URL + '#/extra/u7');
  const xn = await answerRunner(page, () => true);
  check(xn > 0, 'extra practice did not run');
  check(xn === S.units.find(u => u.id === 'u7').x, 'U7 extra practice presented ' + xn + ' questions');
  await page.goto(URL + '#/people');
  const peopleRows = await page.$$eval('#pt tr[data-k]', r => r.length);
  check(peopleRows === S.sets.people, 'Key people table lists ' + peopleRows + ' of ' + S.sets.people + ' people');
  await page.click('#pq');
  const pn = await answerRunner(page, (i, id) => /-p-/.test(id));
  check(pn === 20, "who's-who quiz presented " + pn + ' questions (expected 20)');

  /* ---------------- 3. other features ---------------- */
  await page.goto(URL + '#/cards/u3');
  await page.click('#d3');
  await page.keyboard.press(' ');
  await page.keyboard.press('2'); // got it
  await page.keyboard.press(' ');
  await page.keyboard.press('1'); // missed
  const cards = await page.evaluate(() => Object.values(window.__APP.state().cards));
  check(cards.length === 2 && cards.some(c => c.box === 2) && cards.some(c => c.box === 1 && c.miss), 'Leitner boxes did not update');

  await page.goto(URL + '#/plan');
  const d = new Date(Date.now() + 20 * 86400000);
  await page.fill('#hp', '1.5');
  await page.fill('#dt', d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  await page.click('#mk');
  const planRows = await page.$$eval('table.plan tr', trs => trs.map(t => t.textContent));
  check(planRows.length === 1 + 20 + 1, 'study plan should list 20 study days plus exam day');

  // fresh state: practice exams must be scheduled in the last two days
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await p2.goto(URL + '#/plan');
  await p2.fill('#dt', d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  await p2.click('#mk');
  const rows2 = await p2.$$eval('table.plan tr', trs => trs.map(t => t.textContent));
  check(/Practice Exam 1/.test(rows2[rows2.length - 3]) && /Practice Exam 2/.test(rows2[rows2.length - 2]), 'practice exams are not scheduled 1-2 days before the exam');
  await p2.close();

  // export produces valid JSON
  await page.goto(URL + '#/about');
  await page.click('#ex');
  const dump = await page.inputValue('#dump');
  let parsed = null; try { parsed = JSON.parse(dump); } catch (e) {}
  check(parsed && parsed.v === 1 && parsed.exams && parsed.exams.a, 'export is not valid progress JSON');

  // blocked storage still works
  const p3 = await ctx.newPage();
  const errs3 = [];
  p3.on('pageerror', e => errs3.push(e.message));
  await p3.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  await p3.goto(URL + '#/');
  const blockedText = await p3.textContent('#view');
  check(errs3.length === 0 && /storage is blocked/i.test(blockedText), 'app should work and warn when storage is blocked');
  await p3.goto(URL + '#/quiz/u2');
  await p3.keyboard.press('1');
  check(errs3.length === 0, 'quiz failed with blocked storage');
  await p3.close();

  // cheat sheet prints on one page
  await page.goto(URL + '#/cheat');
  await page.evaluate(() => document.body.classList.add('printcheat'));
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'Letter', printBackground: false, preferCSSPageSize: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check(pages === 1, 'cheat sheet prints on ' + pages + ' pages (expected 1)');
  await page.emulateMedia({ media: 'screen' });

  errors.forEach(e => failures.push('page error: ' + e));
  await browser.close();

  /* ---------------- report ---------------- */
  const tot = { w: S.units.reduce((a, u) => a + u.words, 0), q: S.total, c: S.cards };
  const pct = (a, b) => (100 * a / b).toFixed(1) + '%';
  out('# Self-audit report');
  out('');
  out('Generated by `node tools/audit.cjs` on ' + new Date().toISOString().slice(0, 10) + '.');
  out('');
  out('## Result: ' + (failures.length ? 'FAIL (' + failures.length + ')' : 'PASS'));
  failures.forEach(f => out('- ' + f));
  out('');
  out('## Run-throughs');
  out('- Diagnostic: ' + dn + ' questions presented, all diagnostic-only, scored ' + (diag && diag.score) + '% as expected; skim/must-study verdicts shown; misses added to mistake log.');
  out('- Practice Exam 1: ' + total + ' questions answered by keyboard (80% correct), scored ' + (ea && ea.score) + '%; results by 5 content areas and 12 units; no overlap with diagnostic.');
  out('- Practice Exam 2: auto-submitted after the 90-minute limit; retake at 100% turned the readiness meter to “Ready to book”.');
  out('- Extra practice (U7: ' + xn + ' questions) and the 20-question who\'s-who quiz ran; Key People table lists ' + peopleRows + ' people.');
  out('- Unit quiz, Leitner flashcards, study plan (exams on the last two days), JSON export, blocked storage, one-page cheat-sheet print: checked.');
  out('');
  out('## Question bank');
  out('- Total: ' + S.total + ' original questions — unit quizzes ' + S.sets.q + ', diagnostic ' + S.sets.d + ', Practice Exam 1 ' + S.sets.a + ', Practice Exam 2 ' + S.sets.b + ', extra practice ' + S.sets.x + '.');
  out('- Plus ' + S.sets.p + ' who\'s-who questions generated from the Key People list (' + S.sets.people + ' people, ' + S.sets.pcards + ' people flashcards).');
  out('- Every question: unit tag, 5 options, exactly one correct, an explanation for every option, no duplicate stems: ' + (S.problems.length ? S.problems.length + ' problem(s)' : 'OK') + '.');
  out('- Difficulty: easy ' + S.diff[0] + ' (' + pct(S.diff[0], S.total) + '), medium ' + S.diff[1] + ' (' + pct(S.diff[1], S.total) + '), hard ' + S.diff[2] + ' (' + pct(S.diff[2], S.total) + ').');
  out('- Correct-answer positions A/B/C/D/E: all ' + S.pos.all.join('/') + '; diagnostic ' + S.pos.d.join('/') + '; Exam 1 ' + S.pos.a.join('/') + '; Exam 2 ' + S.pos.b.join('/') + '.');
  out('');
  out('## Content per unit vs. official weights');
  out('');
  out('| Unit | Weight | Lesson (min / words / share) | Must-know | Questions (quiz/diag/ex1/ex2/extra = total, share) | Flashcards (share) |');
  out('|---|---|---|---|---|---|');
  S.units.forEach(u => out('| ' + u.short + ' ' + u.title + ' | ' + u.weight + '% | ' + u.minutes + ' / ' + u.words + ' / ' + pct(u.words, tot.w) + ' | ' + u.must + ' | ' + u.q + '/' + u.d + '/' + u.a + '/' + u.b + '/' + u.x + ' = ' + u.total + ', ' + pct(u.total, tot.q) + ' | ' + u.cards + ' (' + pct(u.cards, tot.c) + ') |'));
  out('| **Total** | 100% | ' + S.units.reduce((a, u) => a + u.minutes, 0) + ' min / ' + tot.w + ' | ' + S.units.reduce((a, u) => a + u.must, 0) + ' | ' + tot.q + ' | ' + tot.c + ' |');
  out('');
  out('## By official content area');
  out('');
  out('| Area | Official weight | Units | Question share | Exam 1 / Exam 2 questions | Flashcard share |');
  out('|---|---|---|---|---|---|');
  const AREAS = { inst: 'Institutions', patt: 'Social Patterns', proc: 'Social Processes', strat: 'Social Stratification', persp: 'The Sociological Perspective' };
  Object.keys(AREAS).forEach(k => {
    const us = S.units.filter(u => u.area === k);
    const q = us.reduce((a, u) => a + u.total, 0), c = us.reduce((a, u) => a + u.cards, 0);
    out('| ' + AREAS[k] + ' | ' + us.reduce((a, u) => a + u.weight, 0) + '% | ' + us.map(u => u.short).join(', ') + ' | ' + pct(q, tot.q) + ' | ' + us.reduce((a, u) => a + u.a, 0) + ' / ' + us.reduce((a, u) => a + u.b, 0) + ' | ' + pct(c, tot.c) + ' |');
  });
  fs.writeFileSync(path.join(ROOT, 'AUDIT.md'), log.join('\n') + '\n');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
