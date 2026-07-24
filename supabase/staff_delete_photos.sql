-- Permite eliminar evidencias fotograficas: admin/supervisor/auditor,
-- o el propio usuario que subio la foto.

drop policy if exists "Staff delete photos" on public.maintenance_photos;
create policy "Staff delete photos"
on public.maintenance_photos
for delete
to authenticated
using (
  uploaded_by = auth.uid()
  or public.current_user_role()::text in ('admin','supervisor','auditor')
);

drop policy if exists "Staff delete evidence files" on storage.objects;
create policy "Staff delete evidence files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'maintenance-photos'
  and (owner = auth.uid() or public.current_user_role()::text in ('admin','supervisor','auditor'))
);
