

## Plan: 5 Changes to the System

### 1. Fix Progression Page -- Individual Student Processing

**Current state:** The progression page only has a bulk "Approve Progression" button per class.

**Change:** Rebuild `ProgressionPage.tsx` to:
- Show each class expandable with a student list inside
- Each student row has a checkbox and individual "Approve" / "Reject" buttons
- Add a "progression_status" column to the `students` table (values: `pending`, `approved`, `rejected`) via migration
- On approval, update the student's `year`/`semester` fields in the database
- Bulk "Approve All" button remains but works on checked students only

### 2. Admin User Management Page

**Current state:** `ConfigPage.tsx` has a user management section using the old mock `db.users` array (which is now empty). The `create-user` edge function exists but the UI doesn't use it.

**Change:** Create a dedicated `UserManagementPage.tsx` (or rebuild into ConfigPage):
- Fetch users from `profiles` + `user_roles` tables (admin can view all)
- **Create user**: Form with name, email, password, role, department. Calls the existing `create-user` edge function
- **Delete user**: New `delete-user` edge function using `adminClient.auth.admin.deleteUser()`. Deletes auth user (cascade deletes profile + role)
- **Reset password**: New `reset-password` edge function using `adminClient.auth.admin.updateUserById()` to set a new password
- Table showing all users with Name, Email, Role, Department, Actions (Delete, Reset Password)
- Add "User Management" nav item in sidebar under Management section (replacing or alongside Config)

**Database:** No schema changes needed for this -- profiles and user_roles tables already exist.

**Edge functions to create:**
- `supabase/functions/delete-user/index.ts` -- admin-only, deletes user via service role
- `supabase/functions/reset-password/index.ts` -- admin-only, resets password via service role

### 3. Remove "Term" -- Keep Only Semester

**Current state:** The system has terms (Term 1-4 mapped to semesters) in both the database (`terms` table, `school_config.current_term`) and the UI.

**Change:**
- Database migration: Drop `current_term` column from `school_config` (or just ignore it)
- Remove term references from `ConfigPage.tsx` (the "Terms & Semesters" card, "Active Term" row)
- Remove `currentTerm` from the DB interface and `useDbData` hook
- Update any UI that references terms to show semesters only

### 4. Add Email Field for Students

**Current state:** The `students` table has no `email` column.

**Change:**
- Database migration: `ALTER TABLE students ADD COLUMN email text;`
- Update `Student` interface in `db.ts` to include `email?: string`
- Update `useDbData.tsx` to map the email field
- Update `StudentsPage.tsx` to show email in student detail modal and add email input in the "Add Student" form
- Update any student-related pages that display contact info

### 5. Import Lecturers from Uploaded File

The file contains 8 faculty members. These need to be created as auth users with the `lecturer` role (or `admin`/`hod` for Julia, Malcom, Bonang).

**Data from file:**
| Name | Department | Role (inferred from existing data) |
|---|---|---|
| Julia | Administration | admin |
| Malcom | Admin & Operations | hoy |
| Bonang Keabetswe | Culinary & Hospitality | hod |
| Poneso Kgakge | Culinary Practicals | lecturer |
| Nthoyapelo Senatla | Culinary Practicals | lecturer |
| Sekgele Mono | Culinary Practicals | lecturer |
| Neo Medupe | Culinary & Hospitality | lecturer |
| Tshepang Utlwang | Culinary & Hospitality | lecturer |

**Approach:** Since admin account (Julia) already exists, we need to create the other 7 via the `create-user` edge function. However, calling the edge function requires an authenticated admin session. 

Better approach: Create a `seed-lecturers` edge function (or extend `bootstrap-admin`) that uses the service role key to create all 7 users at once with their emails (e.g., `malcom@boswa.ac.bw`, `bonang@boswa.ac.bw`, etc.), profiles, and roles. This is a one-time seeding operation.

Alternatively, after the User Management UI is built, the admin can manually add them. Since there are only 7, we could also seed them via the bootstrap edge function.

**Recommended:** Create a `seed-faculty` edge function that bulk-creates these 7 users with default password `BoswaStaff2026!`, then the admin can use User Management to reset passwords individually.

---

### Technical Summary

**Database migrations needed:**
1. Add `email` column to `students` table
2. Optionally drop/ignore `current_term` from `school_config`

**New edge functions:**
1. `delete-user` -- admin deletes a user
2. `reset-password` -- admin resets a user's password  
3. `seed-faculty` -- one-time bulk creation of 7 lecturers from the uploaded file

**Files to create/modify:**
- Create `src/pages/UserManagementPage.tsx`
- Rewrite `src/pages/ProgressionPage.tsx`
- Modify `src/pages/ConfigPage.tsx` (remove terms, remove old user management)
- Modify `src/data/db.ts` (Student email, remove currentTerm)
- Modify `src/hooks/useDbData.tsx` (student email mapping, remove term refs)
- Modify `src/components/Sidebar.tsx` (add User Management nav item)
- Modify `src/pages/StudentsPage.tsx` (email field in forms/detail)
- Modify `src/components/AppLayout.tsx` (add route for user management page)

