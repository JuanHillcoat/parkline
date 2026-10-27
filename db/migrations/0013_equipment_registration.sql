-- 0013: equipment registration (issue 54): battery kind, and a spare that belongs to a site.
-- The database starts empty: no seed data. Rows are created by the application on
-- request, never by a migration.
--
-- 1. equipments.battery_kind: lithium, lead_acid or combustion. Nullable only because rows
--    stored before this migration have none; the application requires it when it creates
--    or edits an equipment. battery_quantity (0 to 4, from 0009) stays optional and only a
--    lead acid equipment may hold one: the check lets an old row (quantity, no kind) stay
--    valid and makes any new combination of another kind with a quantity impossible.
-- 2. equipment_assignments: operation_id and business_unit_id become nullable. A spare
--    (kind spare) now belongs to a SITE: its operation and division are null and site_id
--    names the site (ADR-0013). Two checks keep the shapes honest: an active assignment
--    always has an operation and a division, and the operation and the division are both
--    set or both null. Existing rows, including a spare inside an operation, satisfy both.
--    Every other constraint, the no-overlap exclusion constraint and the grants of 0010
--    are untouched; nothing here changes a privilege.
-- 3. equipment_assignments_site_spare_idx: the open spares of a site, which the archive
--    block of a site counts (the shared AssignmentDirectory port).
-- audit_log_require_reason() is not replaced: no new sensitive audit action is added.
-- This file is pure ASCII, and a test checks it.

alter table equipments
  add column battery_kind text,
  add constraint equipments_battery_kind_check
    check (battery_kind in ('lithium', 'lead_acid', 'combustion')),
  add constraint equipments_battery_quantity_kind_check
    check (battery_quantity is null or battery_kind is null or battery_kind = 'lead_acid');

alter table equipment_assignments
  alter column operation_id drop not null,
  alter column business_unit_id drop not null,
  add constraint equipment_assignments_active_has_operation_check
    check (kind <> 'active' or (operation_id is not null and business_unit_id is not null)),
  add constraint equipment_assignments_operation_division_check
    check ((operation_id is null) = (business_unit_id is null));

create index equipment_assignments_site_spare_idx
  on equipment_assignments (tenant_id, site_id)
  where operation_id is null and valid_to is null;
