export type Species = 'dog' | 'cat' | 'other'
export type ItemType = 'food' | 'med' | 'supply'
export type ItemStatus = 'active' | 'paused' | 'finished'
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'as_needed'
export type MedForm = 'tablet' | 'chew' | 'capsule' | 'sachet' | 'dose'
/** weight/units: food used up at a steady rate · count: used now and then, just counted (food or supplies) */
export type TrackBy = 'weight' | 'units' | 'count'
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
  created_at?: string
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
  /** best-before of the box/pack in use */
  expires_on: string | null
  /** food by units: how long an opened can keeps, in hours */
  open_life_hours: number | null
  last_order_id: string | null
  /** track_by 'count': buy it again when it's low. false = not bought again; at 0 it's used up (Finished). */
  rebuy: boolean
  /** put it in the next Shopping run once, even if it isn't running low; cleared when it arrives */
  order_next: boolean
  /** med course: the last day of doses (inclusive); null = ongoing */
  ends_on: string | null
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
  /** free-text visit notes: what the vet said (or, before the visit, what to ask) */
  notes: string | null
  /** set on a follow-up booked from a visit: the visit it follows */
  follow_up_of: string | null
  created_at: string
}

export interface Weight {
  id: string
  pet_id: string
  measured_on: string
  kg: number
  note: string | null
  /** weighed at this vet visit */
  appointment_id: string | null
}

export interface DocumentRow {
  id: string
  pet_id: string
  title: string
  taken_on: string | null
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  /** given at this vet visit */
  appointment_id: string | null
  created_at: string
}

export interface HealthNote {
  id: string
  pet_id: string
  noted_at: string
  tags: string[]
  note: string | null
  photo_path: string | null
  created_by: string | null
}

export interface MedChange {
  id: string
  item_id: string
  changed_at: string
  kind: 'start' | 'change'
  dose: number | null
  frequency: Frequency | null
  dose_times: string[] | null
  status: ItemStatus | null
  prev_dose: number | null
  prev_frequency: Frequency | null
  prev_dose_times: string[] | null
  prev_status: ItemStatus | null
  reason: string | null
}

export type ExpenseCategory = 'food' | 'med' | 'supply' | 'vet' | 'insurance' | 'grooming' | 'shipping' | 'other'

export interface Expense {
  id: string
  household_id: string
  owner_id: string
  spent_on: string
  amount: number
  category: ExpenseCategory
  title: string
  pet_ids: string[]
  item_id: string | null
  store_id: string | null
  order_id: string | null
  quantity: number | null
  note: string | null
  /** not part of normal monthly spending: counted in totals, left out of the monthly average */
  one_off: boolean
  /** paid at this vet visit */
  appointment_id: string | null
  created_at: string
}
