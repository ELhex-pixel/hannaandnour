const fs=require('node:fs');
const articles=require('../content/journal-editorial');
const data=JSON.stringify(articles).replace(/'/g,"''");
if(!fs.statSync('supabase').isDirectory())throw new Error('Missing supabase directory');
const sql=`-- Owner-requested refresh of the six existing articles; prior rows are backed up.
-- Run after migration_blog_community.sql. No customer submission is published here.
begin;
do $$ begin if public.blog_community_schema_version()<>1 then raise exception 'Blog prerequisites missing'; end if; end $$;
with editorial as (select * from jsonb_to_recordset('${data}'::jsonb) as x(slug text,title text,category text,excerpt text,body text,image text,author text,read_minutes integer,translations jsonb))
insert into public.blog_editorial_backups(post_id,revision,snapshot)
select p.id,'journal-refresh-v1',to_jsonb(p) from public.blog_posts p join editorial e on e.slug=p.slug
on conflict(post_id,revision) do nothing;
with editorial as (select * from jsonb_to_recordset('${data}'::jsonb) as x(slug text,title text,category text,excerpt text,body text,image text,author text,read_minutes integer,translations jsonb))
update public.blog_posts p set title=e.title,category=e.category,excerpt=e.excerpt,body=e.body,image=e.image,author=e.author,read_minutes=e.read_minutes,translations=e.translations,updated_at=now()
from editorial e where p.slug=e.slug and p.updated_at is not distinct from (select (b.snapshot->>'updated_at')::timestamptz from public.blog_editorial_backups b where b.post_id=p.id and b.revision='journal-refresh-v1');
commit;
`;
fs.writeFileSync('supabase/refresh_blog_editorial.sql',sql);
console.log('Prepared refresh_blog_editorial.sql for '+articles.length+' articles; no remote action.');
