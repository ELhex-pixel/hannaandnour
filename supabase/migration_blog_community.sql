begin;
alter table public.blog_posts add column if not exists translations jsonb not null default '{}'::jsonb check(jsonb_typeof(translations)='object');

create table if not exists public.blog_submissions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  author_name text not null check(length(author_name) between 2 and 60),
  title text not null check(length(title) between 5 and 180),
  category text not null check(length(category) between 1 and 60),
  body text not null check(length(body) between 300 and 20000),
  image text not null,
  lang text not null check(lang in ('fr','en','ar')),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  decision_note text,
  published_post_id uuid references public.blog_posts(id) on delete set null,
  published_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists blog_submissions_user_date on public.blog_submissions(user_id,created_at desc);
create index if not exists blog_submissions_status_date on public.blog_submissions(status,created_at desc);
create table if not exists public.blog_submission_decisions (
  id uuid primary key,
  submission_id uuid not null references public.blog_submissions(id) on delete restrict,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.blog_editorial_backups (
  post_id uuid not null,
  revision text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key(post_id,revision)
);
alter table public.blog_submissions enable row level security;
alter table public.blog_submission_decisions enable row level security;
alter table public.blog_editorial_backups enable row level security;
revoke all on public.blog_submissions,public.blog_submission_decisions,public.blog_editorial_backups from public,anon,authenticated,service_role;
grant select,insert,update on public.blog_submissions to service_role;
grant select,insert on public.blog_submission_decisions,public.blog_editorial_backups to service_role;

create or replace function public.submit_blog_article(p_id uuid,p_user uuid,p_content jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous blog_submissions%rowtype; row blog_submissions%rowtype;
begin
  if p_id is null or p_user is null or jsonb_typeof(p_content) is distinct from 'object'
    or coalesce(length(btrim(p_content->>'author_name')),0) not between 2 and 60 or coalesce(length(btrim(p_content->>'title')),0) not between 5 and 180
    or coalesce(length(btrim(p_content->>'body')),0) not between 300 and 20000 or coalesce(p_content->>'lang','') not in ('fr','en','ar')
    or coalesce(p_content->>'category','') not in ('Style','Silhouettes','Bien choisir','Couleurs','Entretien','Inspirations')
    or coalesce(p_content->>'image','') not in ('/images/journal-capsule.webp','/images/journal-superpositions.webp','/images/journal-confort.webp','/images/journal-couleurs.webp','/images/journal-entretien.webp','/images/journal-occasions.webp') then raise exception 'blog_submission_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('blog-user-'||p_user::text,0));
  select * into previous from blog_submissions where id=p_id;
  if found then
    if previous.user_id is distinct from p_user or jsonb_build_object('author_name',previous.author_name,'title',previous.title,'body',previous.body,'category',previous.category,'image',previous.image,'lang',previous.lang) is distinct from p_content then raise exception 'blog_submission_mismatch'; end if;
    return jsonb_build_object('id',previous.id,'status',previous.status,'already',true);
  end if;
  if (select count(*) from blog_submissions where user_id=p_user and status='pending')>=5 then raise exception 'blog_submission_limit'; end if;
  insert into blog_submissions(id,user_id,author_name,title,category,body,image,lang)
  values(p_id,p_user,btrim(p_content->>'author_name'),btrim(p_content->>'title'),p_content->>'category',btrim(p_content->>'body'),p_content->>'image',p_content->>'lang') returning * into row;
  return jsonb_build_object('id',row.id,'status',row.status,'already',false);
end $$;

create or replace function public.moderate_blog_article(p_id uuid,p_submission uuid,p_expected timestamptz,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous blog_submission_decisions%rowtype; s blog_submissions%rowtype; content jsonb; result jsonb; post uuid; slug text; translations jsonb;
begin
  if p_id is null or p_submission is null or p_expected is null or jsonb_typeof(p_request) is distinct from 'object' or coalesce(p_request->>'decision','') not in ('approve','reject') then raise exception 'blog_submission_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into previous from blog_submission_decisions where id=p_id;
  if found then
    if previous.submission_id<>p_submission or previous.request is distinct from p_request then raise exception 'blog_submission_mismatch'; end if;
    return previous.result||jsonb_build_object('already',true);
  end if;
  select * into s from blog_submissions where id=p_submission for update;
  if not found or s.status<>'pending' or s.updated_at is distinct from p_expected then raise exception 'blog_submission_changed'; end if;
  if p_request->>'decision'='approve' then
    content:=p_request->'content';
    if jsonb_typeof(content) is distinct from 'object' or coalesce(length(btrim(content->>'title')),0) not between 5 and 180 or coalesce(length(btrim(content->>'body')),0) not between 300 and 20000
      or coalesce(length(btrim(content->>'excerpt')),0) not between 20 and 400 or coalesce(length(btrim(content->>'author_name')),0) not between 2 and 60
      or coalesce(content->>'category','') not in ('Style','Silhouettes','Bien choisir','Couleurs','Entretien','Inspirations')
      or coalesce(content->>'image','') not in ('/images/journal-capsule.webp','/images/journal-superpositions.webp','/images/journal-confort.webp','/images/journal-couleurs.webp','/images/journal-entretien.webp','/images/journal-occasions.webp') then raise exception 'blog_submission_invalid'; end if;
    slug:='communaute-'||replace(s.id::text,'-','');
    translations:=jsonb_build_object(s.lang,jsonb_build_object('title',btrim(content->>'title'),'excerpt',btrim(content->>'excerpt'),'body',btrim(content->>'body')));
    insert into blog_posts(slug,title,excerpt,body,category,image,author,read_minutes,active,published_at,translations)
    values(slug,btrim(content->>'title'),btrim(content->>'excerpt'),btrim(content->>'body'),content->>'category',content->>'image',btrim(content->>'author_name'),greatest(2,ceil(length(content->>'body')/1000.0)::integer),true,now(),translations) returning id into post;
    update blog_submissions set status='approved',published_post_id=post,published_slug=slug,decision_note=null,updated_at=clock_timestamp() where id=s.id;
  else
    if coalesce(length(btrim(p_request->>'note')),0) not between 3 and 500 then raise exception 'blog_submission_invalid'; end if;
    update blog_submissions set status='rejected',decision_note=btrim(p_request->>'note'),updated_at=clock_timestamp() where id=s.id;
  end if;
  result:=jsonb_build_object('operation_id',p_id,'submission_id',s.id,'status',case when p_request->>'decision'='approve' then 'approved' else 'rejected' end,'post_id',post,'slug',slug,'already',false);
  insert into blog_submission_decisions(id,submission_id,request,result) values(p_id,s.id,p_request,result);
  return result;
end $$;
create or replace function public.blog_community_schema_version()
returns integer language sql immutable security invoker set search_path=public,pg_temp as $$select 1$$;
revoke all on function public.submit_blog_article(uuid,uuid,jsonb),public.moderate_blog_article(uuid,uuid,timestamptz,jsonb),public.blog_community_schema_version() from public,anon,authenticated;
grant execute on function public.submit_blog_article(uuid,uuid,jsonb),public.moderate_blog_article(uuid,uuid,timestamptz,jsonb),public.blog_community_schema_version() to service_role;
commit;
