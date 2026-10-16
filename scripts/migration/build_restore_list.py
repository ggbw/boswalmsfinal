"""Filter a `pg_restore --list` of the Lovable Cloud export down to what the
target Supabase project needs.

Kept: every object in the public schema, the public schema's grants, the
auth.users and auth.identities rows, the trigger that creates a profile for a
new auth user, and the app's storage policies.

Left out: Supabase-managed schemas (auth, storage, realtime, vault, graphql)
which the target already has, sessions and refresh tokens (everyone signs in
again after the move), and storage rows (copy_storage.mjs uploads the files,
which creates them).

Usage: python build_restore_list.py <full_list.txt> <filtered_list.txt>
"""
import re
import sys

DESCS = [
    'SEQUENCE OWNED BY', 'SEQUENCE SET', 'FK CONSTRAINT', 'DEFAULT ACL',
    'ROW SECURITY', 'TABLE DATA', 'EVENT TRIGGER', 'DATABASE PROPERTIES',
    'ACL', 'COMMENT', 'CONSTRAINT', 'DEFAULT', 'EXTENSION', 'FUNCTION', 'INDEX',
    'POLICY', 'PUBLICATION', 'SCHEMA', 'SEQUENCE', 'TABLE', 'TRIGGER', 'TYPE',
    'VIEW', 'MATERIALIZED VIEW', 'ENCODING', 'STDSTRINGS', 'SEARCHPATH', 'DATABASE',
]
LINE = re.compile(r'^(\d+); \d+ \d+ (.*)$')
AUTH_DATA = {'users', 'identities'}


def parse(rest):
    for desc in DESCS:
        if rest.startswith(desc + ' '):
            ns, _, tag = rest[len(desc) + 1:].partition(' ')
            return desc, ns, tag
    return None, None, rest


def keep(desc, ns, tag):
    owner = tag.rsplit(' ', 1)[-1]
    if ns == 'public':
        # supabase_admin's default privileges can't be set by the postgres role.
        return desc != 'DEFAULT ACL' or owner == 'postgres'
    if desc == 'ACL' and ns == '-' and tag.startswith('SCHEMA public '):
        return True
    if ns == 'auth' and desc == 'TABLE DATA':
        return tag.split(' ')[0] in AUTH_DATA
    if ns == 'auth' and desc == 'TRIGGER':
        return True
    if ns == 'storage' and desc == 'POLICY':
        return True
    return False


def main(src, dst):
    kept, dropped = [], 0
    with open(src, encoding='utf-8') as f:
        for line in f:
            m = LINE.match(line.rstrip('\n'))
            if not m:
                continue
            desc, ns, tag = parse(m.group(2))
            if desc and keep(desc, ns, tag):
                kept.append(line)
            else:
                dropped += 1
    # auth.identities has a live foreign key to auth.users on the target, so
    # users must load first. pg_restore follows the list order.
    users = next(l for l in kept if ' TABLE DATA auth users ' in l)
    identities = next(l for l in kept if ' TABLE DATA auth identities ' in l)
    kept.remove(users)
    kept.insert(kept.index(identities), users)
    with open(dst, 'w', encoding='utf-8') as out:
        out.writelines(kept)
    sys.stdout.write(f'kept {len(kept)} entries, left out {dropped}\n')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
