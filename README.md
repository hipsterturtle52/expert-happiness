# CLEP Introductory Sociology — study guide

A single self-contained HTML file that takes a beginner to a confident pass on the
CLEP Introductory Sociology exam in about 20–25 hours. There is no build step and no
dependencies, and it works offline: download it and open it in any browser.

**Open:** `clep-introductory-sociology-study-guide.html`

## What's inside

| | |
|---|---|
| Learning path | 12 units following the official College Board outline. Each unit takes up content in proportion to its exam weight |
| Each unit | Lesson (10–15 min read, theorist → idea → example), must-know box, comparison table or theory grid, 10–15 question quiz, flashcards |
| Diagnostic | 30 questions across all units, then each unit is marked *Skim* or *Must study* |
| Practice exams | Two full-length exams: 100 questions each, 90-minute timer that cannot be paused, results by content area and by unit |
| Question bank | 384 original 5-option questions with an explanation for every option. No question repeats across the quizzes, the diagnostic and the two exams |
| Flashcards | 251 cards in Leitner boxes (a missed card returns sooner), plus a “review missed only” mode |
| Mistake log | Every question you miss goes into a drill queue until you answer it right twice in a row |
| Readiness meter | Shows “Ready to book” only when both practice exams are at 75% or higher |
| Study plan | Enter your hours per day and exam date to get a day-by-day schedule, with the practice exams on the last two days |
| Cheat sheet | One printable page of theorists, theory grids, formulas and diagrams |
| Data | Progress is saved in `localStorage` (the app still works if storage is blocked), with export and import as JSON |

Keyboard: <kbd>1</kbd>–<kbd>5</kbd> or <kbd>A</kbd>–<kbd>E</kbd> to answer, <kbd>Enter</kbd> for next, and <kbd>F</kbd> to flag a question in an exam.
Flashcards: <kbd>Space</kbd> to flip, then <kbd>1</kbd> (missed) or <kbd>2</kbd> (got it).

## Sources

`outline.json` holds the exam format (about 100 questions, 90 minutes), the five
content areas with their weights (Institutions 20%, Social Patterns 10%, Social
Processes 25%, Social Stratification 25%, The Sociological Perspective 20%), and the
unit plan. The source is the College Board's
[exam page](https://clep.collegeboard.org/history-and-social-sciences/introductory-sociology).
The network policy in the environment where this guide was built blocked
collegeboard.org, so these figures were checked against search extracts of the
official page and of the College Board "At a Glance" sheet. Two subtopic lists could
not be confirmed: those for Institutions and Social Patterns. They are marked
*unverified* in the app's About panel.

## Self-audit

```
node tools/audit.cjs
```

The audit needs Playwright with Chromium. It checks every question statically: it has
a unit tag, five options, exactly one correct answer, an explanation for every
option, and no duplicate stem. It then works through the diagnostic and both practice
exams in a headless browser and checks scoring, results by topic, the 90-minute
auto-submit and the readiness meter. Finally it exercises the flashcards, the study
plan, export, blocked storage, and printing the cheat sheet on one page. The results
are written to `AUDIT.md`.
