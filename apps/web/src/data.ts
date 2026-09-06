import {
  MEMBERSHIP_PLANS,
  SERVICE_CATALOGUE,
  priceLabel,
  serviceById,
  type MembershipPlanId,
} from '@freshfold/core';
import { ServiceItem, SubscriptionPlan } from './types';

/**
 * The service cards.
 *
 * Name, description, price and category come from `@freshfold/core` so the
 * advert and the checkout are the same number — they used to be two, and on six
 * of eleven services they disagreed. What stays here is what only a browser
 * cares about: a `lucide-react` icon name and a photograph.
 */
const SERVICE_PRESENTATION: Record<string, { iconName: string; imageUrl: string }> = {
  washing: {
    iconName: 'Sparkles',
    imageUrl: 'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&q=80&w=800'
  },
  drying: {
    iconName: 'Wind',
    /* Was a Google Images thumbnail — an `encrypted-tbn0.gstatic.com` URL
       ending `&s=10`, which is a ~100px preview of somebody else's search
       result. It rendered as a blur in the services list beside ten sharp
       photographs, it is not a link Google intends anyone to hotlink, and it
       can stop resolving at any time. Same source as the rest now. */
    imageUrl: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?auto=format&fit=crop&q=80&w=800'
  },
  'ironing-folding': {
    iconName: 'Shirt',
    imageUrl: 'https://images.unsplash.com/photo-1489274495757-95c7c837b101?auto=format&fit=crop&q=80&w=800'
  },
  'stain-removal': {
    iconName: 'Droplet',
    imageUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80&w=800'
  },
  'bedding-linens': {
    iconName: 'Bed',
    imageUrl: 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&q=80&w=800'
  },
  'express-laundry': {
    iconName: 'Zap',
    imageUrl: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&q=80&w=800'
  },
  'pickup-delivery': {
    iconName: 'Truck',
    imageUrl: 'https://images.unsplash.com/photo-1617347454431-f49d7ff5c3b1?auto=format&fit=crop&q=80&w=800'
  },
  'car-detailing': {
    iconName: 'Car',
    imageUrl: 'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&q=80&w=800'
  },
  'home-office-cleaning': {
    iconName: 'Home',
    imageUrl: 'https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?auto=format&fit=crop&q=80&w=800'
  },
  'sofa-carpet-cleaning': {
    iconName: 'Armchair',
    imageUrl: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&q=80&w=800'
  },
  corporate: {
    iconName: 'Briefcase',
    imageUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=800'
  }
};

export const SERVICES: ServiceItem[] = SERVICE_CATALOGUE.map((service) => ({
  id: service.id,
  name: service.name,
  description: service.description,
  priceInfo: priceLabel(service),
  category: service.category,
  ...SERVICE_PRESENTATION[service.id]
}));

/** Only these can become an order — see `bookable` in core's catalogue. */
export const BOOKABLE_SERVICE_ITEMS: ServiceItem[] = SERVICES.filter(
  (service) => serviceById(service.id)?.bookable
);

/**
 * How each plan is *presented*. What it costs and what it includes is in
 * `@freshfold/core`, and the two are joined below.
 *
 * Two things used to go wrong with these cards, and both were the same mistake
 * twice:
 *
 *  - **The price was written here.** `'₵79'` sat on the card while a number sat
 *    in the server's plan table, and nothing held them together. There is one
 *    number now, in core, and the card's string is derived from it.
 *  - **The bullets promised things nothing implemented.** "Free priority
 *    emergency delivery (1/month)", "Same-day express upgrades up to twice a
 *    month" and "Special discounted rates for bulk employee vouchers" are not
 *    features; no code has ever granted them. What a plan actually buys is a
 *    number of included pickups and a member rate on everything past them, both
 *    of which core enforces — so that is what the bullets say. They are worded
 *    for the marketing page rather than copied from the customer app; the
 *    numbers are the part that has to agree, and those come from core.
 *
 * Icon names are the one genuinely local field: these are `lucide-react`, and
 * the app's are `lucide-react-native`, which is why `Home` here is `House`
 * there.
 *
 * **The order of `benefits` is a contract.** The first entry is always the
 * included-pickup allowance and the last is always the member rate past it,
 * because the plans table on the marketing page gives both of those a row of
 * their own and lists `benefits.slice(1, -1)` underneath as everything else.
 * It used to work that out with a regular expression over the sentences, which
 * held right up until somebody rephrased one. Add a new bullet in the middle.
 */
const PLAN_PRESENTATION: Record<
  MembershipPlanId,
  Omit<SubscriptionPlan, 'id' | 'name' | 'price' | 'billing'>
> = {
  student: {
    tagline: 'For a hall room and a tight budget. Two collections a month.',
    iconName: 'GraduationCap',
    capacity: '20 lbs a month',
    turnaround: 'Next day',
    benefits: [
      '2 pickups a month, with the washing included',
      'Hypoallergenic soap at no extra charge',
      'Every order kept in your history, priced and dated',
      '10% off once the two are used'
    ]
  },
  professional: {
    tagline: 'Shirts and suits pressed and back before the week starts.',
    popular: true,
    iconName: 'Briefcase',
    capacity: '45 lbs a month, plus 10 ironed items',
    turnaround: 'Next day',
    benefits: [
      '4 pickups a month — one a week, washing included',
      'Delicates and knits washed by hand',
      'Shirts returned on hangers and covered',
      '15% off anything past the four'
    ]
  },
  family: {
    tagline: 'Household volume, kept separate and collected twice a week.',
    iconName: 'Home',
    capacity: '100 lbs a month',
    turnaround: 'Next day',
    benefits: [
      '8 pickups a month — twice a week, washing included',
      'Loads kept apart by household and by fabric',
      'Duvets and bed sheets washed and pressed, included',
      '20% off anything past the eight'
    ]
  },
  corporate: {
    tagline: 'Standing collections for a business that cannot run out.',
    iconName: 'Crown',
    capacity: '200 lbs a month, or whatever we agree',
    turnaround: 'Same day, prioritised',
    benefits: [
      '30 pickups a month — daily if the volume needs it, washing included',
      'A written check on every order before it leaves',
      'One person on your account, and priority on stains',
      '25% off anything past the thirty'
    ]
  }
};

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = MEMBERSHIP_PLANS.map((plan) => ({
  ...PLAN_PRESENTATION[plan.id],
  id: plan.id,
  name: plan.name,
  price: `₵${plan.price}`,
  billing: 'billed monthly'
}));

/**
 * Loyalty tiers come from `@freshfold/core`.
 *
 * This file used to declare its own array, the customer app's catalogue
 * declared a second, and the client portal hardcoded a third inline — with
 * Silver starting at 400 points in the portal and 500 everywhere else. Nothing
 * rendered the Tailwind gradient fields that made a local copy look necessary,
 * so the copy is gone rather than reconciled.
 */
export { LOYALTY_TIERS } from '@freshfold/core';
