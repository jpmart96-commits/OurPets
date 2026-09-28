export type Species = 'dog' | 'cat' | 'other'
export type ItemType = 'food' | 'med' | 'supply'
export type ItemStatus = 'active' | 'paused' | 'finished'
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'as_needed'
export type MedForm = 'tablet' | 'chew' | 'capsule' | 'sachet' | 'dose'
export type TrackBy = 'weight' | 'units'
export type UnitLabel = 'can' | 'pouch' | 'tray' | 'sachet'
export interface UnitOpen { at: string; n: number }

export interface Profile {
  id: string
  display_name: string
  shares_home: boolean
  morning_summary: string
  avatar_path: string | null
  timezone: string
  notify_doses: boolean
  notify_stock: boolean
  notify_appointments: boolean
}

export interface Household {
  id: string
  name: string
}

export interface Member {
  household_id: string
  user_id: string
  role: 'owner' | 'member'
}

export interface Pet {
  id: string
  household_id: string
  owner_id: string
  name: string
  species: Species
  breed: string | null
  sex: 'male' | 'female' | null
  neutered: boolean | null
  birth_date: string | null
  microchip: string | null
  vet_name: string | null
  notes: string | null
  archived: boolean
  photo_path: string | null
  vet_phone: string | null
  vet_address: string | null
  er_vet_name: string | null
  er_vet_phone: string | null
  allergies: string | null
  conditions: string | null
  insurance: string | null
}

export interface Store {
  id: string
  household_id: string
  name: string
  cart_url: string | null
  free_shipping_threshold: number | null
}

export interface StockPet {
  item_id: string
  pet_id: string
  daily_grams: number | null
}

export interface StockItem {
  id: string
  household_id: string
  owner_id: string
  type: ItemType
  name: string
  status: ItemStatus
  source: 'store' | 'vet'
  store_id: string | null
  product_url: string | null
  cart_url: string | null
  price: number | null
  lead_days: number
  pack_kg: number | null
  opened_on: string | null
  left_kg: number | null
  left_counted_at: string | null
  pack_days: number | null
  track_by: TrackBy
  unit_label: UnitLabel
  pack_units: number | null
  unit_days: number | null
  units_left: number | null
  unit_opened_at: string | null
  unit_opens: UnitOpen[]
  form: MedForm | null
  dose: number | null
  frequency: Frequency | null
  dose_times: string[] | null
  start_date: string | null
  box_size: number | null
  on_hand: number | null
  counted_at: string | null
  alert_at: number | null
  in_cart: boolean
  ordered_at: string | null
  created_at: string
  photo_path: string | null
  stock_item_pets: StockPet[]
}

export interface DoseLog {
  id: string
  item_id: string
  pet_id: string
  slot_date: string
  slot_time: string
  given_at: string
  given_by: string | null
  status: 'given' | 'missed'
}

export interface Vaccination {
  id: string
  pet_id: string
  name: string
  given_on: string | null
  next_due: string | null
  interval_months: number | null
  notes: string | null
}

export interface Appointment {
  id: string
  pet_id: string
  title: string
  starts_at: string
  location: string | null
  notes: string | null
}

export interface Weight {
  id: string
  pet_id: string
  measured_on: string
  kg: number
  note: string | null
}

export interface DocumentRow {
  id: string
  pet_id: string
  title: string
  taken_on: string | null
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  created_at: string
}
