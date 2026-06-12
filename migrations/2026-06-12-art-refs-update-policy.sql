-- SQL Wave 33 (2026-06-12) — R-H8: adiciona UPDATE policy em art-refs bucket
--
-- Wave 26 criou INSERT + DELETE pro bucket art-refs com path enforcement
-- `split_part(name, '/', 1) = auth.uid()::text`, mas esqueceu UPDATE.
-- Sem UPDATE, users não conseguem sobrescrever próprios uploads (UX bug).
-- Mesmo path enforcement vale aqui.

drop policy if exists "art-refs owner update" on storage.objects;
create policy "art-refs owner update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'art-refs'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'art-refs'
    and split_part(name, '/', 1) = auth.uid()::text
  );
