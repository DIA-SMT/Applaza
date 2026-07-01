-- Datos iniciales. Ejecutar después de schema.sql en el SQL Editor de Supabase.
insert into public.providers (id, name, contact_name, phone, email, notes) values
('10000000-0000-0000-0000-000000000001','Verde Norte SAS','Mariana López','381 555-0182','operaciones@verdenorte.test','Zona norte'),
('10000000-0000-0000-0000-000000000002','Servicios del Jardín SRL','Julián Roldán','381 555-0129','contacto@jardin.test','Centro y oeste'),
('10000000-0000-0000-0000-000000000003','Tucumán Paisaje Coop.','Lucía Medina','381 555-0196','cuadrillas@paisaje.test','Corredores viales');

insert into public.green_spaces (id,name,type,address,neighborhood,latitude,longitude,status) values
('20000000-0000-0000-0000-000000000001','Plaza Independencia','plaza','25 de Mayo y San Martín','Centro',-26.83038,-65.20382,'en_curso'),
('20000000-0000-0000-0000-000000000002','Plaza Urquiza','plaza','25 de Mayo 817','Barrio Norte',-26.82178,-65.20191,'finalizado'),
('20000000-0000-0000-0000-000000000003','Plaza San Martín','plaza','Lavalle y Chacabuco','Sur',-26.83794,-65.20775,'observado'),
('20000000-0000-0000-0000-000000000004','Plaza Belgrano','plaza','Lavalle y Bernabé Aráoz','Ciudadela',-26.83853,-65.22020,'programado'),
('20000000-0000-0000-0000-000000000005','Plaza Alberdi','plaza','Santiago del Estero y Catamarca','Centro Norte',-26.82401,-65.20968,'vencido'),
('20000000-0000-0000-0000-000000000006','Parque 9 de Julio','espacio_verde','Av. Soldati 400','Este',-26.83012,-65.19113,'en_curso'),
('20000000-0000-0000-0000-000000000007','Parque Guillermina','espacio_verde','Av. Mate de Luna 4100','Oeste',-26.83165,-65.25868,'incumplido'),
('20000000-0000-0000-0000-000000000008','Parque Avellaneda','espacio_verde','Av. Mate de Luna 1700','Oeste',-26.82963,-65.22406,'finalizado'),
('20000000-0000-0000-0000-000000000009','Platabanda Av. Roca','platabanda','Av. Roca 900–1500','Sur',-26.84417,-65.21111,'programado'),
('20000000-0000-0000-0000-000000000010','Platabanda Av. Sarmiento','platabanda','Av. Sarmiento 300–900','Barrio Norte',-26.81872,-65.20452,'observado');

insert into public.maintenance_tasks (green_space_id,provider_id,start_date,end_date,completed_date,status,fulfilled,observations)
select g.id, ('10000000-0000-0000-0000-00000000000' || ((row_number() over(order by g.id)-1)%3+1))::uuid,
date '2026-06-03' + (row_number() over(order by g.id)-1)::int, date '2026-07-02' + (row_number() over(order by g.id)-1)::int,
case when g.status='finalizado' then date '2026-06-24' end, g.status,
case when g.status='finalizado' then 'si'::public.fulfillment_status when g.status='incumplido' then 'no'::public.fulfillment_status else 'pendiente'::public.fulfillment_status end,
case when g.status='observado' then 'Revisar terminación de canteros y retiro de residuos.' else 'Mantenimiento integral de césped, arbolado y mobiliario.' end
from public.green_spaces g;
