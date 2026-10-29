import { supabase } from '@/lib/supabase'
import { toApiError } from '@/lib/errors'
import { fetchAllPages, chunk } from '@/lib/paginate'
import { resolveMime, extForMime, validateReceipt } from '@/lib/files'
import { currentDict } from '@/i18n'
import { useCatalogNames } from '@/modules/core/catalogNamesStore'
import type {
  WarehouseStockRow,
  ReportStockMoveRow,
  ToOrderRow,
  ApartmentGapRow,
  EventRow,
  StockMoveRow,
  NormRuleRow,
  CleaningEventRow,
  IssueMissingResult,
  Apartment,
  Building,
  Staff,
  Contact,
  Incident,
  Category,
  Item,
  ItemKind,
  BaseUnit,
  Supplier,
  DocumentRow,
  DocumentWithSupplier,
  AttachmentRow,
  PostDocumentResult,
  ReverseCleaningResult,
  RecalculateCleaningResult,
  ApproveIncidentResult,
  NormalizedShortageEvent,
  OwnerStockRow,
  AptType,
  IncidentCharge,
  IncidentChargePreview,
  ChargeStatus,
  ChargesReportRow,
} from '@/lib/database.types'

// ---- Queries ----

export async function fetchToOrder(): Promise<ToOrderRow[]> {
  const { data, error, status } = await supabase
    .from('to_order')
    .select('item_id,name,category,base_unit,pack_size,pack_label,qty,min_stock,shortage')
    .order('shortage', { ascending: false })
  if (error) throw toApiError(error, status)
  return data ?? []
}

export async function fetchApartmentGaps(): Promise<ApartmentGapRow[]> {
  return fetchAllPages<ApartmentGapRow>((from, to) =>
    supabase
      .from('apartment_gap')
      .select('apartment_id,code,item_id,name,norm,actual,gap')
      .gt('gap', 0)
      .order('apartment_id')
      .order('item_id')
      .range(from, to),
  )
}

export async function fetchShortageEvents(): Promise<NormalizedShortageEvent[]> {
  const { data, error, status } = await supabase
    .from('events')
    .select('id,type,payload,created_at,processed_at')
    .in('type', ['shortage', 'inventory_shortage'])
    .is('processed_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(20)
  if (error) throw toApiError(error, status)
  return (data ?? []).map((ev) => normalizeShortageEvent(ev as unknown as EventRow))
}

function normalizeShortageEvent(ev: EventRow): NormalizedShortageEvent {
  const payload = ev.payload as {
    items?: Array<Record<string, unknown>>
  }
  const rawItems = payload?.items ?? []
  const items = rawItems.map((it) => ({
    name: String(it.item ?? it.name ?? '—'),
    qty: Number(it.balance ?? it.qty ?? 0),
    unit: '',
  }))
  return {
    id: ev.id,
    type: ev.type,
    created_at: ev.created_at,
    items,
  }
}

export async function ackEvents(ids: number[]): Promise<void> {
  const { error, status } = await supabase.rpc('events_ack', { p_ids: ids })
  if (error) throw toApiError(error, status)
}

export async function fetchWarehouseStock(): Promise<WarehouseStockRow[]> {
  return fetchAllPages<WarehouseStockRow>((from, to) =>
    supabase
      .from('warehouse_stock')
      .select('item_id,name,category,kind,base_unit,pack_size,pack_label,qty,min_stock,below_min')
      .order('name')
      .order('item_id')
      .range(from, to),
  )
}

export const fetchReportWarehouseStock = fetchWarehouseStock

export async function fetchOwnerStock(): Promise<OwnerStockRow[]> {
  return fetchAllPages<OwnerStockRow>((from, to) =>
    supabase
      .from('owner_stock_balance')
      .select('apartment_id,code,item_id,name,base_unit,qty')
      .order('code')
      .order('name')
      .range(from, to),
  )
}

export async function fetchReportStockMoves(fromISO: string, toISO: string): Promise<ReportStockMoveRow[]> {
  const rows = await fetchAllPages<StockMoveRow & { moved_at: string }>((from, to) =>
    supabase
      .from('stock_moves')
      .select('id,item_id,from_loc,to_loc,qty,unit_cost,source_type,apartment_id,owner_apartment_id,moved_at')
      .gte('moved_at', fromISO)
      .lt('moved_at', toISO)
      .order('moved_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  )

  const sinkResult = await supabase.from('locations').select('id').eq('type', 'sink').limit(1)
  if (sinkResult.error) throw toApiError(sinkResult.error, sinkResult.status)
  const sinkId = sinkResult.data?.[0]?.id ?? null

  const itemIds = Array.from(new Set(rows.map((row) => row.item_id)))
  const apartmentIds = Array.from(new Set(rows.map((row) => row.apartment_id).filter((id): id is number => id !== null)))
  const ownerIds = Array.from(new Set(rows.map((row) => row.owner_apartment_id).filter((id): id is number => id !== null)))

  const itemsResult = itemIds.length
    ? await Promise.all(chunk(itemIds).map((batch) => supabase.from('items').select('id,name,category_id,pack_size,pack_label').in('id', batch)))
    : []
  const apartmentsResult = apartmentIds.length
    ? await Promise.all(chunk(apartmentIds).map((batch) => supabase.from('apartments').select('id,code').in('id', batch)))
    : []
  const ownerAptIds = Array.from(new Set([...apartmentIds, ...ownerIds]))
  const ownerAptResult = ownerAptIds.length
    ? await Promise.all(chunk(ownerAptIds).map((batch) => supabase.from('apartments').select('id,code').in('id', batch)))
    : []
  for (const r of itemsResult) if (r.error) throw toApiError(r.error, r.status)
  for (const r of apartmentsResult) if (r.error) throw toApiError(r.error, r.status)
  for (const r of ownerAptResult) if (r.error) throw toApiError(r.error, r.status)

  const allItems = itemsResult.flatMap((r) => r.data ?? [])
  const allApartments = apartmentsResult.flatMap((r) => r.data ?? [])

  const categoryIds = Array.from(new Set(allItems.map((item) => item.category_id)))
  const categoriesResult = categoryIds.length
    ? await Promise.all(chunk(categoryIds).map((batch) => supabase.from('categories').select('id,name').in('id', batch)))
    : []
  for (const r of categoriesResult) if (r.error) throw toApiError(r.error, r.status)
  const allCategories = categoriesResult.flatMap((r) => r.data ?? [])

  const itemMap = new Map(allItems.map((item) => [item.id, item]))
  const categoryMap = new Map(allCategories.map((category) => [category.id, category.name]))
  const apartmentMap = new Map(allApartments.map((apartment) => [apartment.id, apartment.code]))
  const ownerAptMap = new Map(ownerAptResult.flatMap((r) => (r.data ?? []).map((a: { id: number; code: string }) => [a.id, a.code])))

  return rows.map((row) => {
    const item = itemMap.get(row.item_id)
    return {
      id: row.id,
      item_id: row.item_id,
      item_name: item?.name ?? '—',
      category: item ? categoryMap.get(item.category_id) ?? '—' : '—',
      pack_size: Number(item?.pack_size ?? 1),
      pack_label: item?.pack_label ?? '',
      qty: Number(row.qty),
      unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
      source_type: row.source_type,
      apartment_id: row.apartment_id,
      apartment_code: row.apartment_id == null ? null : apartmentMap.get(row.apartment_id) ?? '—',
      sink_flow: sinkId == null ? 0 : row.to_loc === sinkId ? 1 : row.from_loc === sinkId ? -1 : 0,
      moved_at: row.moved_at,
      owner_apartment_id: row.owner_apartment_id,
      owner_code: row.owner_apartment_id == null ? null : ownerAptMap.get(row.owner_apartment_id) ?? null,
    }
  })
}

export async function fetchChargesReport(fromISO: string, toISO: string): Promise<ChargesReportRow[]> {
  const rawCharges = await fetchAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from('incident_charges')
      .select('incident_id,tenant_note,base_cost,base_source,coef,amount,status,created_at')
      .gte('created_at', fromISO)
      .lt('created_at', toISO)
      .order('created_at', { ascending: false })
      .range(from, to),
  )

  if (rawCharges.length === 0) return []

  const incidentIds = rawCharges.map((r) => String(r.incident_id))
  const incidentResults = await Promise.all(
    chunk(incidentIds).map((batch) =>
      supabase.from('incidents').select('id,apartment_id,item_id,kind,qty,free_text').in('id', batch),
    ),
  )
  for (const r of incidentResults) if (r.error) throw toApiError(r.error, r.status)
  const allIncidents = incidentResults.flatMap((r) => r.data ?? [])

  const apartmentIds = Array.from(new Set(allIncidents.map((inc) => inc.apartment_id).filter((id): id is number => id != null)))
  const itemIds = Array.from(new Set(allIncidents.map((inc) => inc.item_id).filter((id): id is number => id != null)))

  const apartmentResults = apartmentIds.length
    ? await Promise.all(chunk(apartmentIds).map((batch) => supabase.from('apartments').select('id,code,is_owner').in('id', batch)))
    : []
  for (const r of apartmentResults) if (r.error) throw toApiError(r.error, r.status)
  const itemResults = itemIds.length
    ? await Promise.all(chunk(itemIds).map((batch) => supabase.from('items').select('id,name').in('id', batch)))
    : []
  for (const r of itemResults) if (r.error) throw toApiError(r.error, r.status)

  const aptMap = new Map(apartmentResults.flatMap((r) => (r.data ?? []).map((a: { id: number; code: string; is_owner: boolean }) => [a.id, a])))
  const itemMap = new Map(itemResults.flatMap((r) => (r.data ?? []).map((it: { id: number; name: string }) => [it.id, it.name])))
  const incMap = new Map(allIncidents.map((inc) => [String(inc.id), inc]))

  return rawCharges.map((r) => {
    const inc = incMap.get(String(r.incident_id))
    const apt = inc ? aptMap.get(inc.apartment_id) : undefined
    const itemName = inc?.item_id != null ? (itemMap.get(inc.item_id) ?? '—') : (inc?.free_text ?? '—')
    return {
      incident_id: String(r.incident_id),
      date: String(r.created_at),
      apartment_code: apt?.code ?? '—',
      item_name: itemName,
      kind: String(inc?.kind ?? '—'),
      qty: Number(inc?.qty ?? 0),
      tenant_note: (r.tenant_note as string | null) ?? null,
      base_cost: Number(r.base_cost),
      base_source: r.base_source as 'company' | 'owner' | 'manual',
      coef: Number(r.coef),
      amount: Number(r.amount),
      status: r.status as ChargeStatus,
      owner_code: (r.base_source === 'owner' && apt?.code) ? apt.code : null,
    }
  })
}

export async function fetchStockMoves(itemId: number, offset = 0): Promise<StockMoveRow[]> {
  const { data, error, status } = await supabase
    .from('stock_moves')
    .select('id,item_id,from_loc,to_loc,qty,unit_cost,source_type,source_id,apartment_id,owner_apartment_id,staff_id,note,moved_at,created_by')
    .eq('item_id', itemId)
    .order('moved_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + 49)
  if (error) throw toApiError(error, status)
  const rows = (data ?? []) as Array<StockMoveRow & { created_by: string | null }>
  const locationIds = Array.from(new Set(rows.flatMap((row) => [row.from_loc, row.to_loc])))
  const authorIds = Array.from(new Set(rows.map((row) => row.created_by).filter((id): id is string => id !== null)))

  const [locationsResults, profilesResults] = await Promise.all([
    locationIds.length ? Promise.all(chunk(locationIds).map((batch) => supabase.from('locations').select('id,name,type').in('id', batch))) : [],
    authorIds.length ? Promise.all(chunk(authorIds).map((batch) => supabase.from('profiles').select('id,full_name,login').in('id', batch))) : [],
  ])
  for (const r of locationsResults) if (r.error) throw toApiError(r.error, r.status)
  for (const r of profilesResults) if (r.error) throw toApiError(r.error, r.status)
  const allLocations = locationsResults.flatMap((r) => r.data ?? [])
  const allProfiles = profilesResults.flatMap((r) => r.data ?? [])

  const locationMap = new Map(allLocations.map((location) => [location.id, location]))
  const profileMap = new Map(allProfiles.map((profile) => [profile.id, profile.full_name || profile.login]))
  const ownerIds = Array.from(new Set(rows.map((row) => row.owner_apartment_id).filter((id): id is number => id !== null)))
  const ownerResults = ownerIds.length
    ? await Promise.all(chunk(ownerIds).map((batch) => supabase.from('apartments').select('id,code').in('id', batch)))
    : []
  for (const r of ownerResults) if (r.error) throw toApiError(r.error, r.status)
  const ownerMap = new Map(ownerResults.flatMap((r) => (r.data ?? []).map((a: { id: number; code: string }) => [a.id, a.code])))

  return rows.map(({ created_by: createdBy, ...row }) => ({
    ...row,
    from_location: locationMap.get(row.from_loc),
    to_location: locationMap.get(row.to_loc),
    author: createdBy ? profileMap.get(createdBy) ?? null : null,
    owner_code: row.owner_apartment_id == null ? null : ownerMap.get(row.owner_apartment_id) ?? null,
  }))
}

export async function fetchApartmentsAdmin(): Promise<Apartment[]> {
  const { data, error, status } = await supabase
    .from('apartments')
    .select('id,building_id,number,code,type,status,is_owner,created_at')
    .order('code')
  if (error) throw toApiError(error, status)
  return data ?? []
}

export async function fetchBuildings(): Promise<Building[]> {
  const { data, error, status } = await supabase
    .from('buildings')
    .select('id,name')
    .order('name')
  if (error) throw toApiError(error, status)
  return data ?? []
}

export async function createBuilding(name: string): Promise<Building> {
  const { data, error, status } = await supabase
    .from('buildings')
    .insert({ name })
    .select('id,name')
    .single()
  if (error) throw toApiError(error, status)
  return data as Building
}

export async function createApartment(input: {
  buildingId: number
  buildingName: string
  number: string
  type: AptType
  isOwner?: boolean
}): Promise<Apartment> {
  const { data, error, status } = await supabase
    .from('apartments')
    .insert({
      building_id: input.buildingId,
      number: input.number,
      code: `${input.buildingName}/${input.number}`,
      type: input.type,
      is_owner: input.isOwner ?? false,
    })
    .select('id,building_id,number,code,type,status,is_owner,created_at')
    .single()
  if (error) throw toApiError(error, status)
  return data as Apartment
}

export async function updateApartment(input: {
  id: number
  buildingId: number
  buildingName: string
  number: string
  type: AptType
  isOwner?: boolean
}): Promise<Apartment> {
  const { data, error, status } = await supabase
    .from('apartments')
    .update({
      building_id: input.buildingId,
      number: input.number,
      code: `${input.buildingName}/${input.number}`,
      type: input.type,
      is_owner: input.isOwner ?? false,
    })
    .eq('id', input.id)
    .select('id,building_id,number,code,type,status,is_owner,created_at')
    .single()
  if (error) throw toApiError(error, status)
  return data as Apartment
}

export async function fetchNormRules(apartmentId: number): Promise<NormRuleRow[]> {
  const { data, error, status } = await supabase
    .from('norm_rules')
    .select('id,norm_type,apt_type,apartment_id,item_id,qty,note')
    .eq('apartment_id', apartmentId)
    .order('norm_type')
    .order('item_id')
  if (error) throw toApiError(error, status)
  return data ?? []
}

export async function fetchTemplateNorms(aptType: string): Promise<NormRuleRow[]> {
  const { data, error, status } = await supabase
    .from('norm_rules')
    .select('id,norm_type,apt_type,apartment_id,item_id,qty,note')
    .eq('apt_type', aptType)
    .is('apartment_id', null)
    .order('norm_type')
    .order('item_id')
  if (error) throw toApiError(error, status)
  return data ?? []
}

export async function fetchCleaningEvents(apartmentId: number, limit = 200, offset = 0): Promise<CleaningEventRow[]> {
  const { data, error, status } = await supabase
    .from('cleaning_events')
    .select('id, apartment_id, cleaned_at, status, revision, note, lead_staff_id, reverse_reason, cleaning_event_staff(staff_id, staff(full_name))')
    .eq('apartment_id', apartmentId)
    .order('cleaned_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw toApiError(error, status)
  const rows = (data ?? []) as unknown as Array<{
    id: string
    apartment_id: number
    cleaned_at: string
    status: CleaningEventRow['status']
    revision: number
    note: string | null
    lead_staff_id: number | null
    reverse_reason: string | null
    cleaning_event_staff: Array<{
      staff_id: number
      staff: { full_name: string } | { full_name: string }[]
    }>
  }>
  return rows.map((r) => ({
    ...r,
    cleaning_event_staff: (r.cleaning_event_staff ?? []).map((e) => ({
      staff_id: e.staff_id,
      staff: Array.isArray(e.staff) ? e.staff[0] : e.staff,
    })),
  }))
}

export async function fetchAllStaff(): Promise<Staff[]> {
  return fetchAllPages<Staff>((from, to) =>
    supabase
      .from('staff')
      .select('id,full_name,role,phone,active')
      .order('id')
      .range(from, to),
  )
}

export async function fetchAllContacts(): Promise<Contact[]> {
  const { data, error, status } = await supabase
    .from('contacts')
    .select('id,group_name,name,role_title,phone_e164,has_whatsapp,sort,active,notify_on_events')
    .order('sort')
    .order('name')
  if (error) throw toApiError(error, status)
  return data ?? []
}

export async function fetchAllIncidents(): Promise<Incident[]> {
  return fetchAllPages<Incident>((from, to) =>
    supabase
      .from('incidents')
      .select('id,apartment_id,item_id,free_text,kind,qty,status,photo_paths,comment,created_by,created_at,resolved_by,resolved_at,resolution_note,writeoff_move_id,client_op_id')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  )
}

// ---- Mutations (all through RPC) ----

export async function postTransfer(params: {
  fromKind: 'apartment' | 'holder'
  fromId: number
  toApartment: number
  lines: Array<{ item_id: number; qty: number }>
  note?: string | null
  doc_date?: string | null
}): Promise<PostDocumentResult> {
  const { data, error, status } = await supabase.rpc('transfer_stock', {
    p_from_kind: params.fromKind,
    p_from_id: params.fromId,
    p_to_apartment: params.toApartment,
    p_lines: params.lines,
    p_note: params.note ?? null,
    ...(params.doc_date ? { p_doc_date: params.doc_date } : {}),
  })
  if (error) throw toApiError(error, status)
  return data as PostDocumentResult
}

export async function postDocument(params: {
  op: string
  lines: Array<{ item_id: number; qty: number; unit_cost?: number | null }>
  apartment?: number | null
  staff?: number | null
  supplier?: number | null
  note?: string | null
  doc_date?: string | null
  ownerApartment?: number | null
}): Promise<PostDocumentResult> {
  const { data, error, status } = await supabase.rpc('post_document', {
    p_op: params.op,
    p_lines: params.lines,
    p_apartment: params.apartment ?? null,
    p_staff: params.staff ?? null,
    p_supplier: params.supplier ?? null,
    p_note: params.note ?? null,
    // дата передаётся только для операции задним числом: так форма продолжает работать и до обновления базы
    ...(params.doc_date ? { p_doc_date: params.doc_date } : {}),
    ...(params.ownerApartment != null ? { p_owner_apartment: params.ownerApartment } : {}),
  })
  if (error) throw toApiError(error, status)
  return data as PostDocumentResult
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error, status } = await supabase
    .from('suppliers')
    .select('id,name,phone,note')
    .order('name')
  if (error) throw toApiError(error, status)
  return data ?? []
}

export async function fetchDocuments(docType?: string, offset = 0, limit = 50): Promise<DocumentWithSupplier[]> {
  let query = supabase
    .from('documents')
    .select('id,doc_type,number,doc_date,supplier_id,status,note,total_cost,created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)
  if (docType && docType !== 'all') query = query.eq('doc_type', docType)
  const { data, error, status } = await query
  if (error) throw toApiError(error, status)
  const rows = (data ?? []) as DocumentRow[]
  const supplierIds = Array.from(new Set(rows.map((r) => r.supplier_id).filter((id): id is number => id !== null)))
  let supplierMap = new Map<number, string>()
  if (supplierIds.length) {
    const supResults = await Promise.all(chunk(supplierIds).map((batch) => supabase.from('suppliers').select('id,name').in('id', batch)))
    for (const r of supResults) if (r.error) throw toApiError(r.error, r.status)
    supplierMap = new Map(supResults.flatMap((r) => (r.data ?? []).map((s: { id: number; name: string }) => [s.id, s.name])))
  }
  return rows.map((r) => ({ ...r, supplier_name: r.supplier_id ? supplierMap.get(r.supplier_id) ?? null : null }))
}

export type InventoryStatus = 'open' | 'closed' | 'void'

export interface InventoryRow {
  id: string
  scope: 'apartment' | 'warehouse'
  apartment_id: number | null
  apartment_code: string | null
  status: InventoryStatus
  note: string | null
  created_at: string
  closed_at: string | null
}

export interface InventoryLine extends Pick<Item, 'base_unit' | 'pack_size' | 'pack_label'> {
  item_id: number
  name: string
  expected: number
  actual: number
  decision: 'pending' | 'accepted' | 'rejected'
}

export async function fetchInventories(): Promise<InventoryRow[]> {
  const { data, error, status } = await supabase
    .from('inventories')
    .select('id,scope,apartment_id,status,note,created_at,closed_at,apartments(code)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw toApiError(error, status)
  return ((data ?? []) as unknown as Array<Omit<InventoryRow, 'apartment_code'> & { apartments: { code: string } | { code: string }[] | null }>).map((r) => {
    const { apartments, ...rest } = r
    const apt = Array.isArray(apartments) ? apartments[0] : apartments
    return { ...rest, apartment_code: apt?.code ?? null }
  })
}

export async function fetchInventoryLines(inventoryId: string): Promise<InventoryLine[]> {
  const { data, error, status } = await supabase
    .from('inventory_lines')
    .select('item_id,expected,actual,decision,items(name,base_unit,pack_size,pack_label)')
    .eq('inventory_id', inventoryId)
    .order('id')
  if (error) throw toApiError(error, status)
  type ItemPart = Pick<Item, 'base_unit' | 'pack_size' | 'pack_label'> & { name: string }
  return ((data ?? []) as unknown as Array<{
    item_id: number
    expected: number | string
    actual: number | string
    decision: InventoryLine['decision']
    items: ItemPart | ItemPart[] | null
  }>).map((r) => {
    const it = Array.isArray(r.items) ? r.items[0] : r.items
    return {
      item_id: r.item_id,
      name: it?.name ?? `#${r.item_id}`,
      base_unit: it?.base_unit ?? 'pcs',
      pack_size: Number(it?.pack_size ?? 1) || 1,
      pack_label: it?.pack_label ?? '',
      expected: Number(r.expected),
      actual: Number(r.actual),
      decision: r.decision,
    } as InventoryLine
  })
}

export async function startInventory(scope: 'apartment' | 'warehouse', apartmentId: number | null, note: string | null): Promise<string> {
  const { data, error, status } = await supabase.rpc('inventory_start', {
    p_scope: scope,
    p_apartment: apartmentId,
    p_note: note,
  })
  if (error) throw toApiError(error, status)
  return data as unknown as string
}

export async function setInventoryActual(inventoryId: string, itemId: number, actual: number): Promise<void> {
  const { error, status } = await supabase.rpc('inventory_set_actual', {
    p_inventory: inventoryId,
    p_item: itemId,
    p_actual: actual,
  })
  if (error) throw toApiError(error, status)
}

export async function closeInventory(inventoryId: string, rejectItems: number[]): Promise<number> {
  const { data, error, status } = await supabase.rpc('inventory_close', {
    p_inventory: inventoryId,
    p_reject_items: rejectItems,
  })
  if (error) throw toApiError(error, status)
  return Number((data as { adjusted?: number } | null)?.adjusted ?? 0)
}

export async function cancelInventory(inventoryId: string): Promise<void> {
  const { error, status } = await supabase.rpc('inventory_cancel', { p_inventory: inventoryId })
  if (error) throw toApiError(error, status)
}

export type PurchaseOrderStatus = 'draft' | 'sent' | 'received' | 'cancelled'

export interface PurchaseOrderRow {
  id: string
  number: string | null
  status: PurchaseOrderStatus
  supplier_id: number | null
  supplier: string | null
  note: string | null
  created_at: string
  sent_at: string | null
  received_at: string | null
  lines: number
  total_qty: number
  received_qty: number
  est_cost: number | null
}

export interface PurchaseOrderLine extends Pick<Item, 'base_unit' | 'pack_size' | 'pack_label'> {
  item_id: number
  name: string
  qty: number
  unit_cost: number | null
  received_qty: number
}

export async function fetchPurchaseOrders(): Promise<PurchaseOrderRow[]> {
  const { data, error, status } = await supabase
    .from('purchase_orders_v')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw toApiError(error, status)
  return (data ?? []).map((r: Record<string, unknown>) => ({
    ...(r as unknown as PurchaseOrderRow),
    lines: Number(r.lines),
    total_qty: Number(r.total_qty),
    received_qty: Number(r.received_qty),
    est_cost: r.est_cost == null ? null : Number(r.est_cost),
  }))
}

export async function fetchPurchaseOrderLines(orderId: string): Promise<PurchaseOrderLine[]> {
  const { data, error, status } = await supabase
    .from('purchase_order_lines')
    .select('item_id,qty,unit_cost,received_qty,items(name,base_unit,pack_size,pack_label)')
    .eq('order_id', orderId)
    .order('id')
  if (error) throw toApiError(error, status)
  type ItemPart = Pick<Item, 'base_unit' | 'pack_size' | 'pack_label'> & { name: string }
  return ((data ?? []) as unknown as Array<{
    item_id: number
    qty: number | string
    unit_cost: number | string | null
    received_qty: number | string
    items: ItemPart | ItemPart[] | null
  }>).map((r) => {
    const it = Array.isArray(r.items) ? r.items[0] : r.items
    return {
      item_id: r.item_id,
      name: it?.name ?? `#${r.item_id}`,
      base_unit: it?.base_unit ?? 'pcs',
      pack_size: Number(it?.pack_size ?? 1) || 1,
      pack_label: it?.pack_label ?? '',
      qty: Number(r.qty),
      unit_cost: r.unit_cost == null ? null : Number(r.unit_cost),
      received_qty: Number(r.received_qty),
    } as PurchaseOrderLine
  })
}

export async function generatePurchaseOrders(): Promise<number> {
  const { data, error, status } = await supabase.rpc('po_generate')
  if (error) throw toApiError(error, status)
  return Array.isArray(data) ? data.length : 0
}

export async function setPurchaseOrderLine(
  orderId: string,
  itemId: number,
  qty: number,
  unitCost: number | null,
): Promise<void> {
  const { error, status } = await supabase.rpc('po_set_line', {
    p_order: orderId,
    p_item: itemId,
    p_qty: qty,
    p_unit_cost: unitCost,
  })
  if (error) throw toApiError(error, status)
}

export async function setPurchaseOrderStatus(orderId: string, newStatus: 'sent' | 'cancelled'): Promise<void> {
  const { error, status } = await supabase.rpc('po_set_status', { p_order: orderId, p_status: newStatus })
  if (error) throw toApiError(error, status)
}

export async function receivePurchaseOrder(
  orderId: string,
  lines: Array<{ item_id: number; qty: number; unit_cost: number | null }>,
): Promise<void> {
  const { error, status } = await supabase.rpc('po_receive', { p_order: orderId, p_lines: lines })
  if (error) throw toApiError(error, status)
}

export async function voidDocument(docId: string, reason: string | null): Promise<void> {
  const { error, status } = await supabase.rpc('void_document', { p_doc: docId, p_reason: reason })
  if (error) throw toApiError(error, status)
}

export async function fetchDocumentMoves(docId: string): Promise<Array<StockMoveRow & { item_name: string; item_base_unit: string; item_pack_size: number; item_pack_label: string }>> {
  const { data, error, status } = await supabase
    .from('stock_moves')
    .select('id,item_id,from_loc,to_loc,qty,unit_cost,source_type,source_id,apartment_id,owner_apartment_id,staff_id,note,moved_at')
    .eq('doc_id', docId)
    .order('moved_at', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw toApiError(error, status)
  const rows = (data ?? []) as StockMoveRow[]
  const itemIds = Array.from(new Set(rows.map((r) => r.item_id)))
  const locationIds = Array.from(new Set(rows.flatMap((r) => [r.from_loc, r.to_loc])))
  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_apartment_id).filter((id): id is number => id !== null)))

  const [itemsResults, locationsResults, ownerResults] = await Promise.all([
    itemIds.length ? Promise.all(chunk(itemIds).map((batch) => supabase.from('items').select('id,name,base_unit,pack_size,pack_label').in('id', batch))) : [],
    locationIds.length ? Promise.all(chunk(locationIds).map((batch) => supabase.from('locations').select('id,name,type').in('id', batch))) : [],
    ownerIds.length ? Promise.all(chunk(ownerIds).map((batch) => supabase.from('apartments').select('id,code').in('id', batch))) : [],
  ])
  for (const r of itemsResults) if (r.error) throw toApiError(r.error, r.status)
  for (const r of locationsResults) if (r.error) throw toApiError(r.error, r.status)
  for (const r of ownerResults) if (r.error) throw toApiError(r.error, r.status)
  const allItems = itemsResults.flatMap((r) => r.data ?? [])
  const allLocations = locationsResults.flatMap((r) => r.data ?? [])
  const ownerMap = new Map(ownerResults.flatMap((r) => (r.data ?? []).map((a: { id: number; code: string }) => [a.id, a.code])))

  const itemMap = new Map(allItems.map((i) => [i.id, i]))
  const locationMap = new Map(allLocations.map((l) => [l.id, l]))
  return rows.map((r) => {
    const item = itemMap.get(r.item_id)
    return {
      ...r,
      from_location: locationMap.get(r.from_loc),
      to_location: locationMap.get(r.to_loc),
      item_name: item?.name ?? '?',
      item_base_unit: item?.base_unit ?? 'pcs',
      item_pack_size: item?.pack_size ?? 1,
      item_pack_label: item?.pack_label ?? '',
      owner_code: r.owner_apartment_id == null ? null : ownerMap.get(r.owner_apartment_id) ?? null,
    }
  })
}

export async function fetchAttachments(docId: string): Promise<AttachmentRow[]> {
  const { data, error, status } = await supabase
    .from('attachments')
    .select('id,doc_id,incident_id,kind,storage_path,mime,created_at')
    .eq('doc_id', docId)
    .order('created_at', { ascending: false })
  if (error) throw toApiError(error, status)
  return data ?? []
}

export async function uploadAttachment(docId: string, file: File): Promise<AttachmentRow> {
  const validationError = validateReceipt(file)
  if (validationError) throw toApiError(new Error(validationError))

  const mime = resolveMime(file) ?? 'application/octet-stream'
  const ext = extForMime(mime)
  const path = `${docId}/${crypto.randomUUID()}${ext}`

  const { error: uploadError } = await supabase.storage
    .from('receipts')
    .upload(path, file, { upsert: false, contentType: mime })
  if (uploadError) throw toApiError(uploadError)

  const { data, error, status } = await supabase
    .from('attachments')
    .insert({ doc_id: docId, kind: 'receipt', storage_path: path, mime })
    .select('id,doc_id,incident_id,kind,storage_path,mime,created_at')
    .single()
  if (error) {
    await supabase.storage.from('receipts').remove([path])
    throw toApiError(error, status)
  }
  return data as AttachmentRow
}

export async function createSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(path, 3600)
  if (error) throw toApiError(error)
  return data.signedUrl
}

export async function deleteAttachment(id: string, storagePath: string): Promise<void> {
  const { error, status } = await supabase.from('attachments').delete().eq('id', id)
  if (error) throw toApiError(error, status)
  const { error: storageError } = await supabase.storage.from('receipts').remove([storagePath])
  if (storageError) console.error('Failed to remove attachment file:', storageError)
}

export async function issueMissing(apartmentId: number): Promise<IssueMissingResult> {
  const { data, error, status } = await supabase.rpc('issue_missing_to_apartment', {
    p_apartment: apartmentId,
  })
  if (error) throw toApiError(error, status)
  return data as IssueMissingResult
}

export async function reverseCleaning(eventId: string, reason: string | null): Promise<ReverseCleaningResult> {
  const { data, error, status } = await supabase.rpc('reverse_cleaning', {
    p_event: eventId,
    p_reason: reason,
  })
  if (error) throw toApiError(error, status)
  return data as ReverseCleaningResult
}

export async function recalculateCleaning(
  eventId: string,
  cleanedAt: string | null,
  staffIds: number[] | null,
  leadStaffId: number | null,
): Promise<RecalculateCleaningResult> {
  const { data, error, status } = await supabase.rpc('recalculate_cleaning', {
    p_event: eventId,
    p_cleaned_at: cleanedAt,
    p_staff_ids: staffIds,
    p_lead_staff_id: leadStaffId,
  })
  if (error) throw toApiError(error, status)
  return data as RecalculateCleaningResult
}

export async function takeIncident(incidentId: string): Promise<void> {
  const { error, status } = await supabase.rpc('take_incident', { p_incident: incidentId })
  if (error) throw toApiError(error, status)
}

export async function approveIncident(
  incidentId: string,
  decision: 'confirm' | 'reject',
  note: string | null,
  force: boolean,
  charge?: { tenantNote?: string | null; baseCost?: number | null; coef?: number | null } | null,
): Promise<ApproveIncidentResult> {
  const params: Record<string, unknown> = {
    p_incident: incidentId,
    p_decision: decision,
    p_note: note,
    p_force: force,
  }
  if (charge != null) {
    const pCharge: Record<string, unknown> = {}
    if (charge.tenantNote != null) pCharge.tenant_note = charge.tenantNote
    if (charge.baseCost != null) pCharge.base_cost = charge.baseCost
    if (charge.coef != null) pCharge.coef = charge.coef
    params.p_charge = pCharge
  }
  const { data, error, status } = await supabase.rpc('approve_incident', params)
  if (error) throw toApiError(error, status)
  return data as ApproveIncidentResult
}

export async function fetchIncidentChargePreview(incidentId: string): Promise<IncidentChargePreview> {
  const { data, error, status } = await supabase.rpc('incident_charge_preview', { p_incident: incidentId })
  if (error) throw toApiError(error, status)
  const raw = data as Record<string, unknown>
  return {
    qty: raw.qty != null ? Number(raw.qty) : null,
    item_id: raw.item_id != null ? Number(raw.item_id) : null,
    base_cost: raw.base_cost != null ? Number(raw.base_cost) : null,
    base_source: (raw.base_source as 'company' | 'owner' | null) ?? null,
    coef: raw.coef != null ? Number(raw.coef) : null,
    coef_source: (raw.coef_source as 'item' | 'category' | null) ?? null,
  }
}

export async function fetchIncidentCharges(): Promise<IncidentCharge[]> {
  const rows = await fetchAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from('incident_charges')
      .select('incident_id,tenant_note,base_cost,base_source,coef,amount,status,created_at,status_changed_at')
      .order('created_at', { ascending: false })
      .range(from, to),
  )
  return rows.map((r) => ({
    incident_id: String(r.incident_id),
    tenant_note: (r.tenant_note as string | null) ?? null,
    base_cost: Number(r.base_cost),
    base_source: r.base_source as 'company' | 'owner' | 'manual',
    coef: Number(r.coef),
    amount: Number(r.amount),
    status: r.status as ChargeStatus,
    created_at: String(r.created_at),
    status_changed_at: (r.status_changed_at as string | null) ?? null,
  }))
}

export async function setIncidentChargeStatus(incidentId: string, status: ChargeStatus): Promise<void> {
  const { error, status: httpStatus } = await supabase.rpc('set_incident_charge_status', {
    p_incident: incidentId,
    p_status: status,
  })
  if (error) throw toApiError(error, httpStatus)
}

export interface PendingCleaning {
  id: string
  apartment_id: number
  cleaned_at: string
  created_at: string
  created_by: string | null
  lead_staff_id: number | null
  note: string | null
  media_paths: string[] | null
}

export interface CleaningPreviewLine {
  item_id: number
  item: string
  norm_type: string
  qty: number
}

export interface ApproveCleaningResult {
  status: string
  shortages?: Array<{ item_id: number; item: string; location: string; balance: number }>
}

export async function fetchPendingCleanings(): Promise<PendingCleaning[]> {
  const { data, error, status } = await supabase
    .from('cleaning_events')
    .select('id,apartment_id,cleaned_at,created_at,created_by,lead_staff_id,note,media_paths')
    .eq('posting_status', 'pending')
    .eq('status', 'done')
    .order('created_at', { ascending: true })
  if (error) throw toApiError(error, status)
  return (data ?? []) as PendingCleaning[]
}

export async function fetchStaffNames(): Promise<Map<number, string>> {
  const { data, error, status } = await supabase.from('staff').select('id,full_name')
  if (error) throw toApiError(error, status)
  const rows = (data ?? []) as Array<{ id: number; full_name: string }>
  return new Map<number, string>(rows.map((r) => [r.id, r.full_name]))
}

export async function fetchCleaningPreview(eventId: string): Promise<CleaningPreviewLine[]> {
  const { data, error, status } = await supabase.rpc('cleaning_preview', { p_event: eventId })
  if (error) throw toApiError(error, status)
  return (data ?? []) as CleaningPreviewLine[]
}

export async function approveCleaning(
  eventId: string,
  decision: 'confirm' | 'reject',
  note: string | null,
): Promise<ApproveCleaningResult> {
  const { data, error, status } = await supabase.rpc('approve_cleaning', {
    p_event: eventId,
    p_decision: decision,
    p_note: note,
  })
  if (error) throw toApiError(error, status)
  return data as ApproveCleaningResult
}

// ---- Staff CRUD (admin_all policy) ----

const PHONE_RE = /^\+[0-9]{8,15}$/

/** Removes spaces, dashes, dots and brackets; "00" prefix becomes "+". */
export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, '')
  return cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned
}

export async function createStaff(name: string, role: string, phone: string): Promise<void> {
  const trimmedName = name.trim()
  const trimmedPhone = normalizePhone(phone)
  if (trimmedPhone && !PHONE_RE.test(trimmedPhone)) throw toApiError(new Error(currentDict().invalidPhoneFormat))
  const { error, status } = await supabase
    .from('staff')
    .insert({ full_name: trimmedName, role, phone: trimmedPhone || null, active: true })
  if (error) throw toApiError(error, status)
}

export async function updateStaff(id: number, patch: Partial<Pick<Staff, 'full_name' | 'role' | 'phone' | 'active'>>): Promise<void> {
  const next = { ...patch }
  if (typeof next.full_name === 'string') next.full_name = next.full_name.trim()
  if (next.phone !== undefined) {
    const phone = normalizePhone(next.phone ?? '')
    if (phone && !PHONE_RE.test(phone)) throw toApiError(new Error(currentDict().invalidPhoneFormat))
    next.phone = phone || null
  }
  const { error, status } = await supabase.from('staff').update(next).eq('id', id)
  if (error) throw toApiError(error, status)
}

export async function archiveStaff(id: number): Promise<void> {
  const { error, status } = await supabase.from('staff').update({ active: false }).eq('id', id)
  if (error) throw toApiError(error, status)
}

export async function staffHasHistory(staffId: number): Promise<boolean> {
  const [moves, cleaningStaff] = await Promise.all([
    supabase.from('stock_moves').select('id', { head: true, count: 'exact' }).eq('staff_id', staffId),
    supabase.from('cleaning_event_staff').select('event_id', { head: true, count: 'exact' }).eq('staff_id', staffId),
  ])
  return (moves.count ?? 0) > 0 || (cleaningStaff.count ?? 0) > 0
}

export async function deleteStaff(id: number): Promise<void> {
  const { error, status } = await supabase.from('staff').delete().eq('id', id)
  if (error) throw toApiError(error, status)
}

// ---- Contacts CRUD (admin_all policy) ----

export async function createContact(params: {
  name: string
  group_name: string | null
  role_title: string | null
  phone_e164: string
  has_whatsapp: boolean
  notify_on_events?: boolean
  sort: number
}): Promise<void> {
  const trimmedName = params.name.trim()
  const trimmedPhone = normalizePhone(params.phone_e164)
  if (!PHONE_RE.test(trimmedPhone)) throw toApiError(new Error(currentDict().invalidPhoneFormat))
  const { error, status } = await supabase.from('contacts').insert({
    group_name: params.group_name,
    name: trimmedName,
    role_title: params.role_title,
    phone_e164: trimmedPhone,
    has_whatsapp: params.has_whatsapp,
    notify_on_events: params.notify_on_events ?? false,
    sort: params.sort,
    active: true,
  })
  if (error) throw toApiError(error, status)
}

export async function updateContact(id: number, patch: Partial<Omit<Contact, 'id'>>): Promise<void> {
  const next = { ...patch }
  if (typeof next.phone_e164 === 'string') {
    const phone = normalizePhone(next.phone_e164)
    if (!PHONE_RE.test(phone)) throw toApiError(new Error(currentDict().invalidPhoneFormat))
    next.phone_e164 = phone
  }
  const { error, status } = await supabase.from('contacts').update(next).eq('id', id)
  if (error) throw toApiError(error, status)
}

export async function deleteContact(id: number): Promise<void> {
  const { error, status } = await supabase.from('contacts').delete().eq('id', id)
  if (error) throw toApiError(error, status)
}

// ---- Norm rules CRUD (admin_all policy) ----

export async function upsertNormRule(params: {
  id?: number
  norm_type: string
  apartment_id: number | null
  apt_type: string | null
  item_id: number
  qty: number
  note?: string | null
}): Promise<void> {
  const payload = {
    norm_type: params.norm_type,
    apartment_id: params.apartment_id,
    apt_type: params.apt_type,
    item_id: params.item_id,
    qty: params.qty,
    note: params.note ?? null,
  }
  if (params.id) {
    const { error, status } = await supabase.from('norm_rules').update(payload).eq('id', params.id)
    if (error) throw toApiError(error, status)
  } else {
    const { error, status } = await supabase.from('norm_rules').insert(payload)
    if (error) throw toApiError(error, status)
  }
}

export async function deleteNormRule(id: number): Promise<void> {
  const { error, status } = await supabase.from('norm_rules').delete().eq('id', id)
  if (error) throw toApiError(error, status)
}

// ---- Categories CRUD (admin_all policy) ----

export async function fetchTenantCoefs(): Promise<{ item_id: number | null; category_id: number | null; coef: number }[]> {
  const { data, error, status } = await supabase.from('tenant_coefs').select('item_id,category_id,coef')
  if (error) throw toApiError(error, status)
  return (data ?? []) as { item_id: number | null; category_id: number | null; coef: number }[]
}

export async function setTenantCoef(scope: 'item' | 'category', id: number, coef: number | null): Promise<void> {
  if (coef == null) {
    const col = scope === 'item' ? 'item_id' : 'category_id'
    const { error, status } = await supabase.from('tenant_coefs').delete().eq(col, id)
    if (error) throw toApiError(error, status)
    return
  }
  const row = scope === 'item' ? { item_id: id, coef, updated_at: new Date().toISOString() } : { category_id: id, coef, updated_at: new Date().toISOString() }
  const { error, status } = await supabase.from('tenant_coefs').upsert(row, { onConflict: scope === 'item' ? 'item_id' : 'category_id' })
  if (error) throw toApiError(error, status)
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error, status } = await supabase
    .from('categories')
    .select('id,name,name_en,name_ar,kind,sort')
    .order('sort')
    .order('name')
  if (error) throw toApiError(error, status)
  const coefs = await fetchTenantCoefs()
  const catCoef = new Map(coefs.filter((c) => c.category_id != null).map((c) => [c.category_id as number, c.coef]))
  return (data ?? []).map((c) => ({ ...c, tenant_coef: catCoef.get(c.id) ?? null }))
}

export async function createCategory(params: {
  name: string
  name_en?: string | null
  name_ar?: string | null
  kind: ItemKind
  sort: number
  tenant_coef?: number | null
}): Promise<void> {
  const { tenant_coef: tenantCoef, ...payload } = params
  payload.name_en = payload.name_en?.trim() || null
  payload.name_ar = payload.name_ar?.trim() || null
  const { data, error, status } = await supabase.from('categories').insert({ name: payload.name, name_en: payload.name_en, name_ar: payload.name_ar, kind: payload.kind, sort: payload.sort }).select('id').single()
  if (error) throw toApiError(error, status)
  const newId = (data as { id: number }).id
  if (tenantCoef != null) {
    await setTenantCoef('category', newId, tenantCoef)
  }
  void useCatalogNames.getState().load()
}

export async function updateCategory(id: number, patch: Partial<Pick<Category, 'name' | 'name_en' | 'name_ar' | 'kind' | 'sort' | 'tenant_coef'>>): Promise<void> {
  const { tenant_coef: tenantCoef, name_en: nameEn, name_ar: nameAr, ...base } = patch
  const rest = {
    ...base,
    ...(nameEn !== undefined ? { name_en: nameEn?.trim() || null } : {}),
    ...(nameAr !== undefined ? { name_ar: nameAr?.trim() || null } : {}),
  }
  if (Object.keys(rest).length > 0) {
    const { error, status } = await supabase.from('categories').update(rest).eq('id', id)
    if (error) throw toApiError(error, status)
  }
  if (tenantCoef !== undefined) {
    await setTenantCoef('category', id, tenantCoef)
  }
  void useCatalogNames.getState().load()
}

export async function deleteCategory(id: number): Promise<void> {
  const { count, error: itemsError, status: itemsStatus } = await supabase
    .from('items')
    .select('id', { head: true, count: 'exact' })
    .eq('category_id', id)
  if (itemsError) throw toApiError(itemsError, itemsStatus)
  if ((count ?? 0) > 0) throw toApiError(new Error(currentDict().categoryHasItems))
  const { error, status } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw toApiError(error, status)
}

// ---- Items CRUD (admin_all policy) ----

export async function fetchItems(): Promise<Item[]> {
  const rows = await fetchAllPages<Item>((from, to) =>
    supabase
      .from('items')
      .select('id,category_id,name,name_en,name_ar,base_unit,pack_size,pack_label,min_stock,target_stock,note,default_cost,track_on_hand,qr_code,photo_path,active,sort,supplier_id')
      .order('sort')
      .order('name')
      .order('id')
      .range(from, to),
  )
  const coefs = await fetchTenantCoefs()
  const itemCoef = new Map(coefs.filter((c) => c.item_id != null).map((c) => [c.item_id as number, c.coef]))
  return rows.map((it) => ({ ...it, tenant_coef: itemCoef.get(it.id) ?? null }))
}

export async function createItem(params: {
  category_id: number
  name: string
  name_en?: string | null
  name_ar?: string | null
  base_unit: BaseUnit
  pack_size: number
  pack_label: string
  min_stock: number | null
  target_stock?: number | null
  note?: string | null
  default_cost?: number | null
  sort?: number
  track_on_hand: boolean
  supplier_id?: number | null
  tenant_coef?: number | null
}): Promise<number> {
  const { tenant_coef: tenantCoef, ...payload } = params
  payload.name_en = payload.name_en?.trim() || null
  payload.name_ar = payload.name_ar?.trim() || null
  const { data, error, status } = await supabase
    .from('items')
    .insert({ sort: 0, ...payload, active: true })
    .select('id')
    .single()
  if (error) throw toApiError(error, status)
  const newId = (data as { id: number }).id
  if (tenantCoef != null) {
    await setTenantCoef('item', newId, tenantCoef)
  }
  void useCatalogNames.getState().load()
  return newId
}

export async function updateItem(id: number, patch: Partial<Pick<Item, 'name' | 'name_en' | 'name_ar' | 'category_id' | 'base_unit' | 'pack_size' | 'pack_label' | 'min_stock' | 'target_stock' | 'note' | 'default_cost' | 'sort' | 'track_on_hand' | 'active' | 'supplier_id' | 'tenant_coef'>>): Promise<void> {
  const { tenant_coef: tenantCoef, name_en: nameEn, name_ar: nameAr, ...base } = patch
  const rest = {
    ...base,
    ...(nameEn !== undefined ? { name_en: nameEn?.trim() || null } : {}),
    ...(nameAr !== undefined ? { name_ar: nameAr?.trim() || null } : {}),
  }
  if (Object.keys(rest).length > 0) {
    const { error, status } = await supabase.from('items').update(rest).eq('id', id)
    if (error) throw toApiError(error, status)
  }
  if (tenantCoef !== undefined) {
    await setTenantCoef('item', id, tenantCoef)
  }
  void useCatalogNames.getState().load()
}

export async function archiveItem(id: number): Promise<void> {
  const { error, status } = await supabase.from('items').update({ active: false }).eq('id', id)
  if (error) throw toApiError(error, status)
}

export async function deleteItem(id: number): Promise<void> {
  const { error, status } = await supabase.from('items').delete().eq('id', id)
  if (error) throw toApiError(error, status)
}

export async function fetchItemStockSummary(
  itemId: number,
): Promise<{ warehouse: number; apartments: number; holders: number; total: number }> {
  const [bal, locs] = await Promise.all([
    supabase.from('stock_balance').select('loc_id,qty').eq('item_id', itemId),
    supabase.from('locations').select('id,type').in('type', ['warehouse', 'apartment', 'holder']),
  ])
  if (bal.error) throw toApiError(bal.error, bal.status)
  if (locs.error) throw toApiError(locs.error, locs.status)
  const typeOf = new Map<number, string>(
    ((locs.data ?? []) as { id: number; type: string }[]).map((l) => [l.id, l.type]),
  )
  const sum = { warehouse: 0, apartments: 0, holders: 0 }
  for (const r of (bal.data ?? []) as { loc_id: number; qty: number | string }[]) {
    const q = Number(r.qty)
    if (!(q > 0)) continue
    const type = typeOf.get(r.loc_id)
    if (type === 'warehouse') sum.warehouse += q
    else if (type === 'apartment') sum.apartments += q
    else if (type === 'holder') sum.holders += q
  }
  return { ...sum, total: sum.warehouse + sum.apartments + sum.holders }
}

export async function itemHasHistory(itemId: number): Promise<boolean> {
  const [moves, norms, poLines, invLines, roomNorms, roomStock, incidents, cleanLines] = await Promise.all([
    supabase.from('stock_moves').select('id', { head: true, count: 'exact' }).eq('item_id', itemId),
    supabase.from('norm_rules').select('id', { head: true, count: 'exact' }).eq('item_id', itemId),
    supabase.from('purchase_order_lines').select('id', { head: true, count: 'exact' }).eq('item_id', itemId),
    supabase.from('inventory_lines').select('id', { head: true, count: 'exact' }).eq('item_id', itemId),
    supabase.from('room_norms').select('id', { head: true, count: 'exact' }).eq('item_id', itemId),
    supabase.from('room_stock').select('id', { head: true, count: 'exact' }).eq('item_id', itemId),
    supabase.from('incidents').select('id', { head: true, count: 'exact' }).eq('item_id', itemId),
    supabase.from('cleaning_event_lines').select('id', { head: true, count: 'exact' }).eq('item_id', itemId),
  ])
  return [moves, norms, poLines, invLines, roomNorms, roomStock, incidents, cleanLines].some((r) => (r.count ?? 0) > 0)
}
