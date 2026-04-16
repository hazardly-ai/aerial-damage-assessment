-- Aerial Damage Assessment — Supabase Schema
-- Applied to project: zbnrjjmqbnqunkjbmsdk (us-east-1)
-- Requires: PostGIS extension (enabled by default on Supabase)

-- Enum ----------------------------------------------------------------

CREATE TYPE damage_level AS ENUM (
  'no-damage',
  'minor-damage',
  'major-damage',
  'destroyed',
  'un-classified'
);

-- Tables --------------------------------------------------------------

CREATE TABLE public.disasters (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text UNIQUE NOT NULL,
  type text NOT NULL
);

CREATE TABLE public.image_pairs (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  disaster_id smallint NOT NULL REFERENCES public.disasters(id),
  xbd_id int NOT NULL,
  sensor text,
  gsd real,
  capture_date timestamptz,
  off_nadir_angle real,
  pan_resolution real,
  sun_azimuth real,
  sun_elevation real,
  target_azimuth real,
  width smallint NOT NULL DEFAULT 1024,
  height smallint NOT NULL DEFAULT 1024,
  catalog_id text,
  pre_image_path text,
  post_image_path text,
  geo_origin_lon double precision,
  geo_origin_lat double precision,
  geo_pixel_width double precision,
  geo_pixel_height double precision,
  geo_refine_affine jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (disaster_id, xbd_id)
);

CREATE TABLE public.buildings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uid uuid UNIQUE NOT NULL,
  image_pair_id int NOT NULL REFERENCES public.image_pairs(id) ON DELETE CASCADE,
  actual_damage damage_level NOT NULL DEFAULT 'un-classified',
  predicted_damage damage_level,
  is_correct boolean,
  geom geometry(Polygon, 4326) NOT NULL,
  pixel_coords jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes -------------------------------------------------------------

CREATE INDEX idx_image_pairs_disaster_id ON public.image_pairs(disaster_id);
CREATE INDEX idx_buildings_image_pair_id ON public.buildings(image_pair_id);
CREATE INDEX idx_buildings_geom ON public.buildings USING gist(geom);

-- RLS (public read, writes via service role) --------------------------

ALTER TABLE public.disasters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON public.disasters FOR SELECT USING (true);
CREATE POLICY "public read" ON public.image_pairs FOR SELECT USING (true);
CREATE POLICY "public read" ON public.buildings FOR SELECT USING (true);

-- Storage -------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('satellite-images', 'satellite-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'satellite-images');
