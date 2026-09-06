/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Armchair,
  BadgeCheck,
  Banknote,
  Bed,
  Bike,
  Briefcase,
  Building2,
  CalendarClock,
  Car,
  CreditCard,
  Crown,
  Droplet,
  Feather,
  GraduationCap,
  Hand,
  House,
  Leaf,
  PackageCheck,
  Radar,
  Ruler,
  ShieldCheck,
  Shirt,
  Smartphone,
  Sparkles,
  Truck,
  Wallet,
  Wind,
  Zap,
  type LucideProps,
} from 'lucide-react-native';
import React from 'react';

/**
 * The catalogue stores icons as names so it stays plain data. This is the only
 * place those names are resolved, which means a typo shows up as the fallback
 * sparkle rather than a crash mid-list.
 */
const REGISTRY: Record<string, React.ComponentType<LucideProps>> = {
  Armchair,
  BadgeCheck,
  Banknote,
  Bed,
  Bike,
  Briefcase,
  Building2,
  CalendarClock,
  Car,
  CreditCard,
  Crown,
  Droplet,
  Feather,
  GraduationCap,
  Hand,
  House,
  Leaf,
  PackageCheck,
  Radar,
  Ruler,
  ShieldCheck,
  Shirt,
  Smartphone,
  Sparkles,
  Truck,
  Wallet,
  Wind,
  Zap,
};

export function Icon({
  name,
  size = 18,
  color,
  strokeWidth,
}: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const Component = REGISTRY[name] ?? Sparkles;
  return <Component size={size} color={color} strokeWidth={strokeWidth} />;
}
