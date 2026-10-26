import {
  Baby, Beer, Bike, BookOpen, Bus, Car, Cat, Coffee, CreditCard, Dog, Dumbbell, Ellipsis, Film, Fuel, Gamepad2, Gift,
  GraduationCap, HandHeart, HeartPulse, House, Landmark, Music, Package, Pill, PiggyBank, Plane, Receipt, Scissors,
  Shirt, ShoppingBag, ShoppingBasket, Smartphone, Sparkles, Tag, Ticket, TrainFront, Utensils, Wallet, Wifi, Wine,
  Wrench, Zap, type LucideIcon,
} from 'lucide-react'

/** ชื่อไอคอนที่เก็บใน DB (categories.icon) → component — เพิ่มได้ แต่ห้ามเปลี่ยนชื่อ key เดิม */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  utensils: Utensils, coffee: Coffee, fuel: Fuel, 'shopping-basket': ShoppingBasket, 'shopping-bag': ShoppingBag,
  'heart-pulse': HeartPulse, gamepad: Gamepad2, gift: Gift, more: Ellipsis, bus: Bus, car: Car, train: TrainFront,
  bike: Bike, plane: Plane, house: House, zap: Zap, wifi: Wifi, phone: Smartphone, receipt: Receipt, card: CreditCard,
  wallet: Wallet, bank: Landmark, piggy: PiggyBank, baby: Baby, dog: Dog, cat: Cat, shirt: Shirt, book: BookOpen,
  school: GraduationCap, pill: Pill, gym: Dumbbell, beauty: Sparkles, scissors: Scissors, beer: Beer, wine: Wine,
  film: Film, music: Music, ticket: Ticket, tools: Wrench, package: Package, donate: HandHeart, tag: Tag,
}

export function CategoryIcon({ name, size = 18 }: { name: string | undefined; size?: number }) {
  const Icon = (name && CATEGORY_ICONS[name]) || Tag
  return <Icon size={size} strokeWidth={1.6} />
}
