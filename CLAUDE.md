# BoswaLMS

School management system for Boswa Culinary Institute: LMS, student admin, HR and payroll. React + Vite + TypeScript + Supabase. The frontend is hosted on Lovable (project `43fcd034-190c-4e87-aa19-b5460dffab83`) and published at https://boswalms.automate.co.bw.

## The database is pinned to boswa-live — read this first

The only backend is the client's own Supabase project **boswa-live** (`dwavbotriuabrvhqeshm`). It holds live production data.

Lovable Cloud is switched on for the Lovable project and can't be removed. On 21 Oct 2026 it rewrote the backend settings to its own empty database (`towrwhzqvlvnwknlesde`) and locked every user out. The fix pins the backend in code:

- `src/lib/backend/config.ts`: boswa-live's URL and publishable key
- `src/lib/backend/client.ts`: the Supabase client
- `src/lib/backend/types.ts`: the database types
- `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` and `tsconfig.app.json` redirect `@/integrations/supabase/client` and `@/integrations/supabase/types` to those files

Rules:

- **Ignore `.env`, `supabase/config.toml` and `src/integrations/supabase/client.ts`/`types.ts`.** Lovable owns them and they may name `towrwhzqvlvnwknlesde`. The app never loads them. Don't "fix" them, and don't point anything back at them.
- **Never remove or change the aliases or `src/lib/backend/`** unless the user asks to move the backend.
- **Schema changes:** write the SQL for the user to run on boswa-live, then update `src/lib/backend/types.ts` by hand to match. Never run migrations or SQL against boswa-live without explicit approval.
- **Edge functions** are deployed to boswa-live with the Supabase CLI (`--project-ref dwavbotriuabrvhqeshm`). Lovable deploys them to its Cloud project, which the app doesn't call.
- **Only the publishable key goes in code.** It is public by design and row-level security protects the data. Never put the service-role key in the frontend.

## Lovable

- Pushing to `main` syncs into Lovable. The live site changes only on Publish.
- Lovable's bot commits to `main` too. Fetch and rebase before pushing.
- **After any Lovable bot commit that touches `.env`, `supabase/` or `src/integrations/supabase/`**, check that the published bundle still contains `dwavbotriuabrvhqeshm` and no `towrwhzqvlvnwknlesde`:
  `js=$(curl -s https://boswalms.automate.co.bw/ | grep -oE '/assets/index-[^"]+\.js' | head -1); curl -s "https://boswalms.automate.co.bw$js" | grep -oE 'dwavbotriuabrvhqeshm|towrwhzqvlvnwknlesde' | sort | uniq -c`
- Never accept a Lovable prompt to enable Cloud, connect a database, or "confirm backend status". Account settings → Preferences → Agent permissions → Enable Cloud is set to **Never allow**.

## Commands

- `npm run dev`: dev server on port 8080
- `npm run build`: production build
- `npm test`: Vitest unit tests
- `node_modules/.bin/tsc --noEmit -p tsconfig.app.json`: type-check
