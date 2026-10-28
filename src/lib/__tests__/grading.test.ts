import { describe, it, expect } from "vitest";
import {
  letterGrade,
  standingFor,
  gradeBand,
  gradePoint,
  letterOrder,
  roundMark,
  scaleForProgramme,
  computeGpa,
  certificateOverall,
  standingBucket,
  displayGrade,
  gradeScaleDisplay,
  STANDING_ORDER,
  PASS_MARK,
} from "../grading";
import {
  categorizeModuleAssessments,
  computeStudentModuleMark,
  avg,
  type ModuleAssessments,
} from "../moduleMark";

// Source for every expected value below:
//   • Scale definitions — the "Award Classification" tables at the foot of
//     Reubens Transcript.DOCX (Diploma, Level 6) and Atang Thako.DOCX (Cert, L5).
//   • Module-mark math — the three marks spreadsheets in /home/olerato/Music.
// Values are quoted in comments so a reviewer can trace each one.

describe("grade boundaries — Diploma (Level 6) scale", () => {
  const cases: [number, string, string][] = [
    [100, "A", "Distinction"],
    [80, "A", "Distinction"],
    [79, "B", "Merit"],
    [70, "B", "Merit"],
    [69, "C", "Credit"],
    [60, "C", "Credit"],
    [59, "D", "Pass"],
    [50, "D", "Pass"],
    [49, "F", "Fail"],
    [0, "F", "Fail"],
  ];
  it.each(cases)("%i → %s (%s)", (mark, letter, standing) => {
    expect(letterGrade(mark, "diploma")).toBe(letter);
    expect(standingFor(mark, "diploma")).toBe(standing);
  });
});

describe("grade boundaries — Certificate (Level 5) scale", () => {
  const cases: [number, string, string][] = [
    [100, "D", "Distinction"],
    [80, "D", "Distinction"],
    [79, "M", "Merit"],
    [70, "M", "Merit"],
    [69, "C", "Credit"],
    [60, "C", "Credit"],
    [59, "P", "Pass"],
    [50, "P", "Pass"],
    [49, "F", "Fail / Not Yet Competent"],
    [0, "F", "Fail / Not Yet Competent"],
  ];
  it.each(cases)("%i → %s (%s)", (mark, letter, standing) => {
    expect(letterGrade(mark, "certificate")).toBe(letter);
    expect(standingFor(mark, "certificate")).toBe(standing);
  });
});

describe("the 'D' collision between scales must never be mixed up", () => {
  it("85 is Distinction on both scales, but letter A (Diploma) vs D (Certificate)", () => {
    expect(letterGrade(85, "diploma")).toBe("A");
    expect(standingFor(85, "diploma")).toBe("Distinction");
    expect(letterGrade(85, "certificate")).toBe("D");
    expect(standingFor(85, "certificate")).toBe("Distinction");
  });
  it("55 is a Pass on both scales: letter D (Diploma) vs P (Certificate)", () => {
    expect(letterGrade(55, "diploma")).toBe("D");
    expect(standingFor(55, "diploma")).toBe("Pass");
    expect(letterGrade(55, "certificate")).toBe("P");
    expect(standingFor(55, "certificate")).toBe("Pass");
  });
  it("Diploma D (Pass) and Certificate D (Distinction) are opposite ends", () => {
    expect(standingFor(55, "diploma")).toBe("Pass"); // D = Pass
    expect(standingFor(85, "certificate")).toBe("Distinction"); // D = Distinction
  });
});

describe("rounding — marks round to a whole number (half up) before grading", () => {
  it("49.5 → 50 → a Pass, not a Fail", () => {
    expect(roundMark(49.5)).toBe(50);
    expect(letterGrade(49.5, "diploma")).toBe("D"); // Pass
    expect(letterGrade(49.5, "certificate")).toBe("P"); // Pass
  });
  it("69.4 → 69 → Credit", () => {
    expect(roundMark(69.4)).toBe(69);
    expect(standingFor(69.4, "diploma")).toBe("Credit");
    expect(standingFor(69.4, "certificate")).toBe("Credit");
  });
  it("69.5 → 70 → Merit", () => {
    expect(roundMark(69.5)).toBe(70);
    expect(letterGrade(69.5, "diploma")).toBe("B");
    expect(letterGrade(69.5, "certificate")).toBe("M");
  });
  it("shrugs off binary-float dust (69.49999999999999 is really 69.5 → 70)", () => {
    expect(roundMark(69.49999999999999)).toBe(70);
  });
  it("PASS_MARK is 50 on both scales", () => {
    expect(PASS_MARK).toBe(50);
    expect(standingFor(49, "diploma")).toBe("Fail");
    expect(standingFor(50, "diploma")).toBe("Pass");
  });
});

describe("grade points — Diploma 5.0 scale; Certificate has none", () => {
  it("Diploma A5 B4 C3 D2 F0", () => {
    expect(gradePoint("A", "diploma")).toBe(5.0);
    expect(gradePoint("B", "diploma")).toBe(4.0);
    expect(gradePoint("C", "diploma")).toBe(3.0);
    expect(gradePoint("D", "diploma")).toBe(2.0);
    expect(gradePoint("F", "diploma")).toBe(0.0);
  });
  it("Certificate grades carry no points", () => {
    expect(gradePoint("D", "certificate")).toBe(0);
    expect(gradePoint("M", "certificate")).toBe(0);
  });
});

describe("letter order and displayed classification", () => {
  it("Diploma order A B C D F; Certificate order D M C P F", () => {
    expect(letterOrder("diploma")).toEqual(["A", "B", "C", "D", "F"]);
    expect(letterOrder("certificate")).toEqual(["D", "M", "C", "P", "F"]);
  });
  it("display rows carry grade points on the Diploma only", () => {
    const dip = gradeScaleDisplay("diploma");
    expect(dip[0]).toEqual(["A", "80–100% · 5.0 · Distinction"]);
    const cert = gradeScaleDisplay("certificate");
    expect(cert[0]).toEqual(["D", "80–100% · Distinction"]);
  });
});

describe("Diploma GPA on the 5.0 scale with mixed credits", () => {
  it("(A×10 + C×5) / 15 = (50 + 15)/15 = 4.33", () => {
    // 85 → A → 5.0; 65 → C → 3.0
    expect(computeGpa([{ mark: 85, credits: 10 }, { mark: 65, credits: 5 }])).toBe("4.33");
  });
  it("all A with any credits = 5.00", () => {
    expect(computeGpa([{ mark: 90, credits: 15 }, { mark: 100, credits: 60 }])).toBe("5.00");
  });
});

describe("Certificate overall = simple average, rounded, with a grade word", () => {
  it("reproduces Atang Thako.DOCX: 11 marks average 78.18 → 78 → MERIT", () => {
    // Module marks straight off the Certificate template.
    const marks = [67, 81, 83, 81, 84, 84, 79, 73, 78, 79, 71];
    expect(avg(marks)).toBeCloseTo(78.18, 2);
    const overall = certificateOverall(marks);
    expect(overall.mark).toBe(78);
    expect(overall.grade).toBe("MERIT");
  });
  it("is a SIMPLE average, not credit-weighted (credit-weighted would be 76 → Credit, which is wrong)", () => {
    const marks = [67, 81, 83, 81, 84, 84, 79, 73, 78, 79, 71];
    expect(certificateOverall(marks).mark).toBe(78);
    expect(certificateOverall(marks).mark).not.toBe(76);
  });
});

describe("scale selection comes from the programme level", () => {
  it("Level 6 → Diploma, Level 5 → Certificate", () => {
    expect(scaleForProgramme({ level: 6 })).toBe("diploma");
    expect(scaleForProgramme({ level: 5 })).toBe("certificate");
  });
  it("falls back to the programme name when the level is missing", () => {
    expect(scaleForProgramme({ name: "Certificate in Culinary Arts" })).toBe("certificate");
    expect(scaleForProgramme({ name: "Diploma in Culinary Arts" })).toBe("diploma");
  });
  it("defaults to Diploma when nothing decides (flagged as a Needs-Boswa item)", () => {
    expect(scaleForProgramme({})).toBe("diploma");
    expect(scaleForProgramme(undefined)).toBe("diploma");
  });
});

describe("standing buckets unify the two scales for the Grade Overview", () => {
  it("there are exactly five shared standings", () => {
    expect(STANDING_ORDER).toEqual(["Distinction", "Merit", "Credit", "Pass", "Fail"]);
  });
  it("85 buckets to Distinction on either scale", () => {
    expect(standingBucket(85, "diploma")).toBe("Distinction");
    expect(standingBucket(85, "certificate")).toBe("Distinction");
  });
  it("55 buckets to Pass; 40 to Fail", () => {
    expect(standingBucket(55, "diploma")).toBe("Pass");
    expect(standingBucket(55, "certificate")).toBe("Pass");
    expect(standingBucket(40, "certificate")).toBe("Fail");
  });
});

describe("already-finalised results are never regraded under the new system", () => {
  it("a finalised result keeps its recorded grade verbatim", () => {
    // Finalised long ago under the old letter scale as "B-"; the new Diploma
    // scale would call 85 an "A", but the issued transcript must not change.
    const finalised = { mark: 85, finalizedGrade: "B-", finalizedScale: "diploma" as const };
    expect(displayGrade(finalised, "diploma")).toBe("B-");
  });
  it("a result not yet finalised is graded on the current scale", () => {
    expect(displayGrade({ mark: 85 }, "diploma")).toBe("A");
    expect(displayGrade({ mark: 85, finalizedGrade: null }, "certificate")).toBe("D");
  });
});

// ── Module-mark reproduction against Boswa's own spreadsheets ──────────────────
// Build a ModuleAssessments + a score map, then check computeStudentModuleMark
// reproduces the spreadsheet's module mark (before final rounding).

function scorer(scores: Record<string, number | null>) {
  return (_sid: string, id: string) => (id in scores ? scores[id] : null);
}

describe("module mark reproduces the theory spreadsheet", () => {
  it("Cooking Methods — Changu Moloi (row 8): 74.9  [4 coursework items ×0.6 + exam ×0.4]", () => {
    // E85 F77 G64 H60 (coursework), Final Exam 80.  AVERAGE*0.6 + 80*0.4 = 74.9
    const cat: ModuleAssessments = {
      theoryCWExams: [{ id: "t1" }, { id: "t2" }, { id: "ia" }, { id: "ga" }],
      finalTheoryExam: { id: "fe" },
      practicalCWExams: [],
      recipeExams: [],
      finalPracExam: undefined,
      finalPracTheo: undefined,
      assignments: [],
    };
    const mk = computeStudentModuleMark({
      studentId: "s",
      hasPractical: false,
      cat,
      scoreOf: scorer({ t1: 85, t2: 77, ia: 64, ga: 60, fe: 80 }),
    });
    expect(mk.moduleMark).toBeCloseTo(74.9, 2);
    expect(roundMark(mk.moduleMark)).toBe(75);
    expect(letterGrade(mk.moduleMark, "diploma")).toBe("B"); // 75 → Merit
  });

  it("Food Safety — Abigail Seoketsi (row 4): 69.8  [3 coursework items]", () => {
    // E85 F60 G58, Final 73.  AVERAGE(85,60,58)*0.6 + 73*0.4 = 40.6 + 29.2 = 69.8
    const cat: ModuleAssessments = {
      theoryCWExams: [{ id: "t1" }, { id: "t2" }, { id: "ia" }],
      finalTheoryExam: { id: "fe" },
      practicalCWExams: [],
      recipeExams: [],
      finalPracExam: undefined,
      finalPracTheo: undefined,
      assignments: [],
    };
    const mk = computeStudentModuleMark({
      studentId: "s",
      hasPractical: false,
      cat,
      scoreOf: scorer({ t1: 85, t2: 60, ia: 58, fe: 73 }),
    });
    expect(mk.moduleMark).toBeCloseTo(69.8, 2);
    expect(roundMark(mk.moduleMark)).toBe(70); // 69.8 → 70 → Merit
  });
});

describe("module mark reproduces the Hot Kitchen practical spreadsheet", () => {
  it("RAMSAYS — Kaelo Mpotokwane (row 6): 74.45  [CW×0.4 + prac×0.2 + exam×0.4]", () => {
    // CW E74 F90 G69 H89 I64 → avg 77.2 ×0.4 = 30.88
    // recipes 88,97,89,100,68,88 → avg 88.333 ×0.7 = 61.83
    // final prac 70 ×0.2 = 14; final prac theory 60 ×0.1 = 6 → practical 81.83
    // practical ×0.2 = 16.37; final exam 68 ×0.4 = 27.2 → module ≈ 74.45
    const cat: ModuleAssessments = {
      theoryCWExams: [{ id: "e" }, { id: "f" }, { id: "g" }, { id: "h" }, { id: "i" }],
      finalTheoryExam: { id: "m" },
      practicalCWExams: [],
      recipeExams: [{ id: "r1" }, { id: "r2" }, { id: "r3" }, { id: "r4" }, { id: "r5" }, { id: "r6" }],
      finalPracExam: { id: "y" },
      finalPracTheo: { id: "aa" },
      assignments: [],
    };
    const mk = computeStudentModuleMark({
      studentId: "s",
      hasPractical: true,
      cat,
      scoreOf: scorer({
        e: 74, f: 90, g: 69, h: 89, i: 64,
        r1: 88, r2: 97, r3: 89, r4: 100, r5: 68, r6: 88,
        y: 70, aa: 60, m: 68,
      }),
    });
    expect(mk.practicalMark).toBeCloseTo(81.83, 1);
    expect(mk.moduleMark).toBeCloseTo(74.45, 1);
    expect(roundMark(mk.moduleMark)).toBe(74);
  });
});

describe("Pastry practical — same as Hot Kitchen but NO final practical (confirmed Q5)", () => {
  it("REUBENS — Ogone Tseladikae (row 5): practical = recipes ×0.7 only", () => {
    // recipes 88,78,77,92,73,0,71,71,75 → avg 69.444 ×0.7 = 48.61 (no final prac)
    const cat: ModuleAssessments = {
      theoryCWExams: [{ id: "e" }, { id: "f" }, { id: "g" }, { id: "h" }],
      finalTheoryExam: { id: "m" },
      practicalCWExams: [],
      recipeExams: [
        { id: "q1" }, { id: "q2" }, { id: "q3" }, { id: "q4" },
        { id: "q5" }, { id: "q6" }, { id: "q7" }, { id: "q8" }, { id: "q9" },
      ],
      finalPracExam: undefined, // Pastry has no final practical
      finalPracTheo: undefined,
      assignments: [],
    };
    const mk = computeStudentModuleMark({
      studentId: "s",
      hasPractical: true,
      cat,
      scoreOf: scorer({
        e: 74, f: 58, g: 64, h: 80,
        q1: 88, q2: 78, q3: 77, q4: 92, q5: 73, q6: 0, q7: 71, q8: 71, q9: 75,
        m: 67,
      }),
    });
    // Practical mark is recipes×0.7 with nothing else added (max 70).
    expect(mk.practicalMark).toBeCloseTo(48.61, 1);
    expect(mk.finalPrac).toBeNull();
    // Whole module rounds to 64 (spreadsheet N5 = 64.2 using a hand-rounded 49).
    expect(roundMark(mk.moduleMark)).toBe(64);
  });
});

describe("absent is not zero; a real 0 counts, a blank is skipped", () => {
  it("a skipped (blank) coursework item is left out of the average", () => {
    const cat: ModuleAssessments = {
      theoryCWExams: [{ id: "a" }, { id: "b" }],
      finalTheoryExam: undefined,
      practicalCWExams: [],
      recipeExams: [],
      finalPracExam: undefined,
      finalPracTheo: undefined,
      assignments: [],
    };
    // a blank (null) → skipped, average is just 60
    const blank = computeStudentModuleMark({
      studentId: "s", hasPractical: false, cat, scoreOf: scorer({ a: null, b: 60 }),
    });
    expect(blank.theoryCWAvg).toBe(60);
    // a real 0 → counts, dragging the average to 30
    const zero = computeStudentModuleMark({
      studentId: "s", hasPractical: false, cat, scoreOf: scorer({ a: 0, b: 60 }),
    });
    expect(zero.theoryCWAvg).toBe(30);
  });
});

describe("categorizeModuleAssessments splits the buckets the weighting needs", () => {
  it("a 'Final Theory Exam' is weighted 40%, not averaged into coursework", () => {
    const cat = categorizeModuleAssessments(
      [
        { id: "t1", type: "Written Exam" },
        { id: "fe", type: "Final Theory Exam" },
      ],
      [],
    );
    expect(cat.theoryCWExams.map((e) => e.id)).toEqual(["t1"]);
    expect(cat.finalTheoryExam?.id).toBe("fe");
  });
});
