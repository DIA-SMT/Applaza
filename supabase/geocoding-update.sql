-- Coordenadas aceptadas automáticamente mediante API Georef Argentina.
begin;
alter table public.green_spaces add column if not exists normalized_address text;
alter table public.green_spaces add column if not exists geocoding_source text;
alter table public.green_spaces add column if not exists geocoded_at timestamptz;

update public.green_spaces set latitude=-26.8511105, longitude=-65.1975294, normalized_address='400, Eugenio Mendez, San Cayetano, Villa Alem, San Miguel de Tucumán, Departamento Capital, Tucumán, T4000, Argentina', geocoding_source='OpenStreetMap Nominatim', geocoded_at=now() where source_key='pdf-2026-06-30-029' and latitude is null;
update public.green_spaces set latitude=-26.8188193, longitude=-65.1939505, normalized_address='1000, Avenida Juan B. Justo, Villa 9 de julio, San Miguel de Tucumán, Departamento Capital, Tucumán, T4000, Argentina', geocoding_source='OpenStreetMap Nominatim', geocoded_at=now() where source_key='pdf-2026-06-30-109' and latitude is null;
update public.green_spaces set latitude=-26.831776, longitude=-65.2192724, normalized_address='250, Avenida Leandro N. Alem, Ciudadela, San Miguel de Tucumán, Departamento Capital, Tucumán, T4000, Argentina', geocoding_source='OpenStreetMap Nominatim', geocoded_at=now() where source_key='pdf-2026-06-30-124' and latitude is null;
update public.green_spaces set latitude=-26.836173811, longitude=-65.227008964, normalized_address='BOLIVAR (ESQUINA FRIAS SILVA), San Miguel de Tucumán, Capital, Tucumán', geocoding_source='Georef Argentina v2', geocoded_at=now() where source_key='pdf-2026-06-30-130' and latitude is null;
update public.green_spaces set latitude=-26.841342198, longitude=-65.217070878, normalized_address='AV JULIO ARGENTINO ROCA (ESQUINA JUAN BAUTISTA ALBERDI), San Miguel de Tucumán, Capital, Tucumán', geocoding_source='Georef Argentina v2', geocoded_at=now() where source_key='pdf-2026-06-30-136' and latitude is null;
update public.green_spaces set latitude=-26.8358354, longitude=-65.1796016, normalized_address='1200, Avenida Benjamín Aráoz, Sarmiento, San Miguel de Tucumán, Departamento Capital, Tucumán, T4000, Argentina', geocoding_source='OpenStreetMap Nominatim', geocoded_at=now() where source_key='pdf-2026-06-30-150' and latitude is null;
update public.green_spaces set latitude=-26.8404613, longitude=-65.2225357, normalized_address='1500, Avenida Néstor Kirchner, El Cruce, Ciudadela, San Miguel de Tucumán, Departamento Capital, Tucumán, T4000, Argentina', geocoding_source='OpenStreetMap Nominatim', geocoded_at=now() where source_key='pdf-2026-06-30-157' and latitude is null;
update public.green_spaces set latitude=-26.8209169, longitude=-65.2367999, normalized_address='2650, Mendoza, Villa Luján, San Miguel de Tucumán, Departamento Capital, Tucumán, T4000, Argentina', geocoding_source='OpenStreetMap Nominatim', geocoded_at=now() where source_key='pdf-2026-06-30-180' and latitude is null;

commit;
