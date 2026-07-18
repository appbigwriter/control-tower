-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE blog_echonow.article_tags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT article_tags_pkey PRIMARY KEY (id),
  CONSTRAINT article_tags_article_id_fkey FOREIGN KEY (article_id) REFERENCES blog_echonow.articles(id),
  CONSTRAINT article_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES blog_echonow.tags(id)
);
CREATE TABLE blog_echonow.articles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  excerpt text,
  content text,
  featured_image jsonb,
  status text NOT NULL DEFAULT 'DRAFT'::text CHECK (status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'ARCHIVED'::text])),
  published_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  views integer NOT NULL DEFAULT 0,
  read_time integer NOT NULL DEFAULT 5,
  social_summary text,
  instagram_post_url text,
  destaque_hero boolean NOT NULL DEFAULT false,
  colocar_hero boolean NOT NULL DEFAULT false,
  hero_set_at timestamp with time zone,
  source_type text NOT NULL DEFAULT 'manual'::text CHECK (source_type = ANY (ARRAY['manual'::text, 'automated'::text])),
  original_source text,
  ai_context jsonb,
  language text NOT NULL DEFAULT 'pt'::text,
  translation_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  seo_applied boolean NOT NULL DEFAULT false,
  seo_title text,
  seo_description text,
  seo_keywords ARRAY,
  author_id uuid,
  category_id uuid,
  CONSTRAINT articles_pkey PRIMARY KEY (id),
  CONSTRAINT articles_author_id_fkey FOREIGN KEY (author_id) REFERENCES blog_echonow.authors(id),
  CONSTRAINT articles_category_id_fkey FOREIGN KEY (category_id) REFERENCES blog_echonow.categories(id)
);
CREATE TABLE blog_echonow.authors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  bio text,
  avatar_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT authors_pkey PRIMARY KEY (id)
);
CREATE TABLE blog_echonow.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  color text,
  parent_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES blog_echonow.categories(id)
);
CREATE TABLE blog_echonow.media_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  path text NOT NULL,
  url text NOT NULL,
  mime_type text,
  alt_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_pkey PRIMARY KEY (id)
);
CREATE TABLE blog_echonow.redirects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_path text NOT NULL UNIQUE,
  to_path text NOT NULL,
  status_code integer NOT NULL DEFAULT 301,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT redirects_pkey PRIMARY KEY (id)
);
CREATE TABLE blog_echonow.seo_pages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  article_id uuid,
  canonical_url text,
  meta_title text,
  meta_description text,
  og_image text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT seo_pages_pkey PRIMARY KEY (id),
  CONSTRAINT seo_pages_article_id_fkey FOREIGN KEY (article_id) REFERENCES blog_echonow.articles(id)
);
CREATE TABLE blog_echonow.settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT settings_pkey PRIMARY KEY (id)
);
CREATE TABLE blog_echonow.tags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tags_pkey PRIMARY KEY (id)
);