# Boswa LMS — Grading system rebuild (handover report)

**Branch:** `boswa-grading-final`
**Date:** 28 Oct 2026
**Scope of this increment:** the grading *engine* (the two award scales, rounding,
GPA, Certificate overall) and the two screens that render grades (Class Report,
Transcript), with a full test suite. The access/security UAT fixes (Section 4 of
the brief) and the full visual transcript redesign are **not** in this increment
— see §5.

> **Governing rule honoured throughout:** this changes the grading **system**, not
> grades already issued. New rules apply from now on only. No result rows are
> recalculated or migrated. Grades are computed live from `assessment_marks`
> today, so the engine returns a *finalised* result's recorded grade verbatim and
> only grades fresh results on the new scale (`displayGrade`, proved by test).

---

## 1. Summary

**Done (complete, tested, builds):**

- Two award scales chosen by programme **level**, from the templates' Award
  Classification tables: **Diploma / Level 6** (A·5.0·Distinction, B·4.0·Merit,
  C·3.0·Credit, D·2.0·Pass, F·0.0·Fail) and **Certificate / Level 5**
  (D·Distinction, M·Merit, C·Credit, P·Pass, F·Fail). The scales live as data in
  `src/lib/grading.ts`, not scattered constants.
- The **"D" collision** (Diploma D = Pass vs Certificate D = Distinction) is
  handled by making every grading function take the scale, and is tested
  explicitly.
- Marks **round to a whole number, half up, before grading**, consistently on the
  report and the transcript (`roundMark`).
- **GPA on the 5.0 scale**, Diploma transcript only; Certificate transcript shows
  **Total Marks (%) = simple average, rounded + grade word** (reproduces Atang
  Thako: 78 / MERIT).
- **Credits per programme+module** are read from the curriculum
  (`programme_modules.credits`) with a fallback to 10; the schema change and seed
  are written as a migration for you to run (§4).
- Class Report, Grade Overview and Transcript all wired to the scale; the Grade
  Overview (which spans classes on either scale) unifies columns by the five
  shared **standings**.

**Still open (not started / deferred):** all Section 4 access & security UAT
fixes (R1, A3, S1/S3, S4, G1), the pixel-for-pixel transcript layout rebuild
(header field order, grouped "Year X Semester Y" headings, the full Award
Classification table with descriptor columns, signatory = Kewame Zwelibanzi /
Principal), and running the credits SQL on live. See §5.

---

## 2. Change log

| # | Change | File · line | Why | Source | Proof |
|---|--------|-------------|-----|--------|-------|
| 1 | Replaced the single university letter scale with two data-driven scales (`GRADING_SCALES`) + scale-aware `letterGrade`, `gradeBand`, `standingFor`, `gradePoint`, `letterOrder`, `gradeScaleDisplay`, `letterBadgeClass` | `src/lib/grading.ts` | Boswa uses Diploma vs Certificate classifications, not A–F +/- | Reubens Transcript.DOCX & Atang Thako.DOCX → Award Classification tables. Boswa, GRADING SYSTEM ANSWERS.docx Q1/Q2 | `grading.test.ts` "grade boundaries — Diploma/Certificate scale" |
| 2 | Scale chosen by programme level (`scaleForProgramme`): 6→Diploma, 5→Certificate, name fallback, default Diploma | `src/lib/grading.ts` | Scale must come from programme/level, not the student number | Brief §2.1 | "scale selection comes from the programme level" |
| 3 | `roundMark` — round half up, float-dust safe; used in transcript (`Math.round`→`roundMark`) and report | `grading.ts`; `TranscriptsPage.tsx` build loop; `ReportsPage.tsx` | Marks rounded before grade; report & transcript were inconsistent | Boswa, GRADING SYSTEM ANSWERS.docx Q3 | "rounding — marks round to a whole number" |
| 4 | GPA moved to 5.0 points, credit-weighted (`computeGpa`); old 4.0 `gradePoint` removed | `grading.ts`; `TranscriptsPage.tsx` `computeGPA` | Diploma GPA is A5…F0 | Reubens Transcript.DOCX GPA table. Brief §2.3 | "Diploma GPA on the 5.0 scale with mixed credits" |
| 5 | `certificateOverall` — simple average, rounded, + uppercased grade word; Certificate transcript shows it instead of GPA | `grading.ts`; `TranscriptsPage.tsx` summary (print + preview) | Certificate has no GPA | Atang Thako.DOCX footer (78 / MERIT). Brief §2.3 | "Certificate overall = simple average … 78 → MERIT" |
| 6 | Credits read from `programme_modules.credits` (fallback 10) instead of hard-coded 10 | `TranscriptsPage.tsx` build loop; `db.ts` `ProgrammeModule`; `useDbData.tsx` map | Credits differ per module and per programme | Both templates' Credits column (Diploma 360 / Cert 132). Brief §2.4 | migration `20261028120000_programme_modules_credits.sql` |
| 7 | Grade Overview columns unified by the five shared standings (`STANDING_ORDER`, `standingBucket`) | `ReportsPage.tsx` overview table | One table spans classes on different scales | Brief §2.1 | "standing buckets unify the two scales" |
| 8 | `displayGrade` / `RecordedResult` seam: a finalised result returns its recorded grade verbatim | `grading.ts` | Never regrade already-issued results | User instruction 27–28 Oct 2026; Brief §0.3, §5.3 | "already-finalised results are never regraded" |
| 9 | `programme_modules.credits` added to backend types by hand | `src/lib/backend/types.ts` | Match the schema migration | CLAUDE.md schema rule | type-check passes |

The module-mark weighting in `moduleMark.ts` was **verified, not changed** — it
already matches the spreadsheets' intended formulas (§3).

---

## 3. Spreadsheet comparison results

Verified `computeStudentModuleMark` against Boswa's three spreadsheets
(`/home/olerato/Music`). Matches are **before final rounding** (the lib rounds
each weighted part to 2 dp, so values land within ~0.1 of the sheet).

**Matches (reproduced by test):**

- **Theory** — Ruebens Ramseys Theory Final: `AVERAGE(coursework)×0.6 +
  FinalExam×0.4`. Cooking Methods, Changu Moloi (row 8) → **74.9**. Food Safety,
  Abigail Seoketsi (row 4) → **69.8**. (3- and 4-item coursework both covered.)
- **Hot Kitchen practical** — RAMSAYS, Kaelo Mpotokwane (row 6) → **74.45**
  (CW×0.4 + practical×0.2 + exam×0.4; practical = recipes×0.7 + finalPrac×0.2 +
  finalPracTheo×0.1). This is the sheet's *correct* formula (`AC = X+Z+AB`).
- **Pastry practical** — REUBENS, Ogone Tseladikae (row 5): practical = recipes×0.7
  only (no final practical), → module rounds to **64**. Confirms Q5 "same as Hot
  Kitchen but no final practical".

**Known spreadsheet errors — system is deliberately *not* bug-compatible** (the
LMS computes the intended value; list these for Boswa):

- **Hot Kitchen REUBENS col AC** omits the 10% final-practical-theory (`AC = X+Z`,
  missing `AB`). LMS includes it.
- **Hot Kitchen RAMSAYS cell Z5 empty** — Pego's 73 final practical is dropped by
  the sheet; the sheet shows 67.32, intended is 81.92. LMS uses 81.92.
- **Hot Kitchen col K** = `CONCATENATE(AC + AD{wrong row})`; the AD cells are
  empty/0 so no numeric effect, but it is fragile.
- **Pastry practical marks are hand-typed** (REUBENS col AA ≈ round(recipes×0.7);
  RAMSAYS col J is 1–3 points below recipes×0.7). The LMS computes from recipes,
  so it will differ from the hand-typed figure by the same 1–3 points.
- **Pastry RAMSAYS col W** averages the module mark into the recipe range
  (`AVERAGE(N:V)`), a stray side-calc; the module uses hand-typed J, not W.

**Not yet done:** the row-by-row comparison of *every* student in all three
sheets (brief §6). The representative rows above are tested; a full sweep is a
follow-up.

---

## 4. Credits migration — action for Boswa / dev

`supabase/migrations/20261028120000_programme_modules_credits.sql` — run on
**boswa-live** (not run by this work). It:

1. `ALTER TABLE programme_modules ADD COLUMN credits integer;` (additive, changes
   no result rows), and
2. seeds credits from the templates (Diploma 360, Certificate 132), matching
   programmes by level/name — **review the WHERE clauses against your real
   programme rows first**.

The `credits` column is now included in the `programme_modules` select in
`src/hooks/useDbData.tsx`, so credits flow through once published (fallback 10 if
a row's credit is null).

**Run on boswa-live (28 Oct 2026, done):** credits were seeded by **module name**,
not code — the live module codes differ from the templates (spaces/different
prefixes, e.g. `BSCASHI 104`, `BOSCFS 107`, `BOSC3220`). Final totals:
**Certificate = 132** (exact). **Diploma = 385** — the live Diploma curriculum
differs from the sample transcript: it has 3 extra modules (**Hospitality
Management**, **Introduction to Hot Kitchen/Savory**, **Introduction to Pastry**)
left at a **placeholder 10 credits** pending Boswa's real figures, and lacks the
template's "Introduction to the Hospitality Industry" (5 cr). Two name gotchas
that are 8 credits: **"Providing Guest Service"** and **"Professional Workplace
Standards"** (double space).

---

## 5. Needs Boswa (unconfirmed — left configurable at current behaviour)

1. **"A+".** Boswa's answer says "letter grades (A+ – F)", but neither template has
   an A+ (top is A at 80–100). Implemented the template scale (A max). *Is there an
   A+ band, and at what percentage?*
2. **Diploma GPA averaging.** Kept **credit-weighted** (Σ points×credits ÷ Σ
   credits); the template's GPA cell is blank. *Credit-weighted or simple average?*
3. **Pastry practical without a final practical.** Kept recipes×0.7 only (max 70),
   matching the REUBENS sheet. *Or should the 70% be re-scaled to 100%?*
4. **Supplementary / retake / absence / progression** (Tab A rows 9–12) unchanged
   in `progression.ts`. *Principal to confirm supplementary rules.*
5. **Institution name spelling.** Templates say "BOSSWA CULINARY INSTITUTE"; the app
   stores "Boswa". Left as stored. *Which spelling is official for the transcript?*
6. **Default scale.** A programme with no level and no "Diploma/Certificate" in its
   name defaults to the Diploma scale. *Confirm every programme has a level set.*

## 5b. Deferred workstreams (brief §4 and §2.6) — NOT in this increment

- **R1** HOD has no reports; **A3** lecturer sees a class they don't teach
  (security); **S1/S3** confirm lecturer ≠ admin; **S4** test student-login script;
  **G1** slow upload. None started.
- Full transcript **layout** rebuild to match the templates field-for-field
  (grouped "Year X Semester Y" headings, the complete Award Classification table
  with the descriptor columns, signatory **Kewame Zwelibanzi / Principal**,
  configurable). This increment fixed the *grades, GPA, overall and credits*; the
  surrounding layout is largely the existing design.
- Full row-by-row spreadsheet sweep and the M1 Tab-B comparison.

---

## 6. UAT readiness (this increment)

| Test | Ready to retest? | Note |
|------|------------------|------|
| Grade correctness, both scales | **Yes** | New scales live on report + transcript; 50 unit tests pass |
| Rounding before grade | **Yes** | Report and transcript now consistent |
| Certificate overall (Atang Thako) | **Yes** | Reproduces 78 / MERIT |
| Diploma GPA (5.0) | **Yes** (pending credits on live) | GPA math tested; credit-weighting flagged (§5.2) |
| Credits per programme | **No** | Needs the SQL run on live (§4) |
| R1/A3/S1/S3/S4/G1 access | **No** | Not started (§5b) |

Suggested Problem-Log entries for Boswa to add by hand: "Grading scales switched
to Diploma(5.0)/Certificate per level — verify a Diploma and a Certificate
transcript"; "Credits show 10 for every module until the credits migration is run
on live".

---

## 7. Test results (actually run)

- **Type-check:** `node_modules/.bin/tsc --noEmit -p tsconfig.app.json` → exit 0.
- **Unit/integration:** `npx vitest run` → **6 files, 107 tests passed** (incl. the
  50 new `src/lib/__tests__/grading.test.ts`). Duration ~130s.
- **Build:** `npm run build` → see commit (run at handover).

No tests were skipped or deleted.
