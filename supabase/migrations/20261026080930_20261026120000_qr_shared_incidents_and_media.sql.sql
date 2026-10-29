DROP POLICY IF EXISTS sv_incidents_read ON public.incidents;
CREATE POLICY sv_incidents_read ON public.incidents FOR SELECT
  TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS "incident_photos_read_active" ON storage.objects;
CREATE POLICY "incident_photos_read_active"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'incident-photos'
  AND (is_admin() OR is_active_user())
);