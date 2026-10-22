/**
 * Exam types, split by whether they belong to the practical section of a
 * module. Theory-only modules (hasPractical === false) must not offer the
 * practical ones.
 *
 * Shared by Exams & Marks (every type) and Practical & Recipe Assessments
 * (practical types only). Both pages write the same exam rows, so the lists
 * must be one list, not two copies.
 */
export const THEORY_TYPES: readonly string[] = ['Written Exam', 'Final Theory Exam', 'Oral Exam'];
export const PRACTICAL_TYPES: readonly string[] = ['Practical Exam', 'Final Practical Exam', 'Final Practical Theory Exam', 'Recipe'];

export const isPracticalType = (type: string | null | undefined): boolean =>
  PRACTICAL_TYPES.includes(type || '');
