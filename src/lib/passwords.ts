/**
 * The passwords new accounts are issued.
 *
 * These are SHARED and well known — that is deliberate, so an administrator can
 * hand one over without a separate channel. What makes it workable is that every
 * account created with one is flagged `must_change_password`, so the holder has
 * to replace it before they can use the system.
 *
 * ⚠ The residual risk, stated plainly: between an account being created and that
 * person first signing in, anyone who knows the pattern can sign in as them.
 * Student email addresses are derived from student numbers, so both halves of
 * the credential are guessable. The forced change protects the account AFTER
 * first login, not before. This was an informed decision; bulk provisioning
 * therefore issues UNIQUE passwords instead, since nobody is handing those over
 * in person.
 *
 * Three different hardcoded passwords were previously scattered across the app —
 * `BoswaStudent2026!` in provisioning, `BoswaStaff2026!` in User Management and
 * `Boswa@2024` in the Lecturers page, the last of which nobody knew about. They
 * live here now so there is one place to change them.
 */

export const DEFAULT_STUDENT_PASSWORD = 'BoswaStudent2026!';
export const DEFAULT_STAFF_PASSWORD = 'BoswaStaff2026!';

/** The password a new account of this role is given by default. */
export function defaultPasswordFor(role?: string | null): string {
  return role === 'student' ? DEFAULT_STUDENT_PASSWORD : DEFAULT_STAFF_PASSWORD;
}

// A unique-password generator was here. It is gone deliberately: there are now
// exactly TWO passwords, one for students and one for staff, used by every
// creation path including bulk provisioning. If unique passwords are ever wanted
// again, the safeguard that matters is unchanged — every account is flagged
// must_change_password, so whatever it starts as must be replaced at first login.
