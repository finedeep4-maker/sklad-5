import { supabase } from '@/lib/supabase'
import { toApiError } from '@/lib/errors'
import type { Room, ApartmentRoomRow, AptType } from '@/lib/database.types'

export async function fetchRooms(): Promise<Room[]> {
  const { data, error, status } = await supabase
    .from('rooms')
    .select('id,name,sort,active')
    .eq('active', true)
    .order('sort')
  if (error) throw toApiError(error, status)
  return (data ?? []) as Room[]
}

export async function fetchApartmentRoomRows(apartmentId: number): Promise<ApartmentRoomRow[]> {
  const { data, error, status } = await supabase
    .from('apartment_room_view')
    .select('apartment_id,room_id,room_name,room_sort,item_id,item_name,base_unit,pack_label,norm,actual,gap')
    .eq('apartment_id', apartmentId)
    .order('room_sort')
    .order('item_name')
  if (error) throw toApiError(error, status)
  return (data ?? []).map((r) => ({
    ...r,
    norm: Number(r.norm),
    actual: Number(r.actual),
    gap: Number(r.gap),
  })) as ApartmentRoomRow[]
}

/**
 * Норма предмета в комнате. forType=false: исключение для этой квартиры.
 * forType=true: шаблон для всех квартир этого типа (исключение квартиры при этом удаляется).
 */
export async function saveRoomNorm(p: {
  apartmentId: number
  aptType: AptType | null
  roomId: number
  itemId: number
  qty: number
  forType: boolean
}): Promise<void> {
  if (p.forType) {
    if (!p.aptType) throw new Error('apt_type is required for a template norm')
    const { data: tpl, error: e1, status: s1 } = await supabase
      .from('room_norms')
      .select('id')
      .is('apartment_id', null)
      .eq('apt_type', p.aptType)
      .eq('room_id', p.roomId)
      .eq('item_id', p.itemId)
      .maybeSingle()
    if (e1) throw toApiError(e1, s1)
    if (tpl) {
      const { error, status } = await supabase.from('room_norms').update({ qty: p.qty }).eq('id', tpl.id)
      if (error) throw toApiError(error, status)
    } else {
      const { error, status } = await supabase
        .from('room_norms')
        .insert({ apt_type: p.aptType, room_id: p.roomId, item_id: p.itemId, qty: p.qty })
      if (error) throw toApiError(error, status)
    }
    const { error: e3, status: s3 } = await supabase
      .from('room_norms')
      .delete()
      .eq('apartment_id', p.apartmentId)
      .eq('room_id', p.roomId)
      .eq('item_id', p.itemId)
    if (e3) throw toApiError(e3, s3)
    return
  }
  const { data: ov, error: e1, status: s1 } = await supabase
    .from('room_norms')
    .select('id')
    .eq('apartment_id', p.apartmentId)
    .eq('room_id', p.roomId)
    .eq('item_id', p.itemId)
    .maybeSingle()
  if (e1) throw toApiError(e1, s1)
  if (ov) {
    const { error, status } = await supabase.from('room_norms').update({ qty: p.qty }).eq('id', ov.id)
    if (error) throw toApiError(error, status)
  } else {
    const { error, status } = await supabase
      .from('room_norms')
      .insert({ apartment_id: p.apartmentId, room_id: p.roomId, item_id: p.itemId, qty: p.qty })
    if (error) throw toApiError(error, status)
  }
}

/** Фактическое количество предмета в комнате (ручной ввод). qty = 0 удаляет запись. */
export async function saveRoomStock(p: {
  apartmentId: number
  roomId: number
  itemId: number
  qty: number
}): Promise<void> {
  if (p.qty <= 0) {
    const { error, status } = await supabase
      .from('room_stock')
      .delete()
      .eq('apartment_id', p.apartmentId)
      .eq('room_id', p.roomId)
      .eq('item_id', p.itemId)
    if (error) throw toApiError(error, status)
    return
  }
  const { error, status } = await supabase
    .from('room_stock')
    .upsert(
      {
        apartment_id: p.apartmentId,
        room_id: p.roomId,
        item_id: p.itemId,
        qty: p.qty,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'apartment_id,room_id,item_id' },
    )
  if (error) throw toApiError(error, status)
}

/** Убрать предмет из комнаты: норма в 0 для этой квартиры и удаление фактической записи. */
export async function removeFromRoom(p: {
  apartmentId: number
  roomId: number
  itemId: number
  hadNorm: boolean
}): Promise<void> {
  if (p.hadNorm) {
    await saveRoomNorm({ apartmentId: p.apartmentId, aptType: null, roomId: p.roomId, itemId: p.itemId, qty: 0, forType: false })
  }
  await saveRoomStock({ apartmentId: p.apartmentId, roomId: p.roomId, itemId: p.itemId, qty: 0 })
}
