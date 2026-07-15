import type { Property, Booking, Client } from '@prisma/client';
import { arrivalInfo } from './emails';
import { toEmailBooking } from './email-data';

/** Arrival email needs at least an address + entry + Wi-Fi to be worth sending. */
export function arrivalReady(p: Pick<Property, 'address' | 'doorCode' | 'wifiName' | 'wifiPassword'>): boolean {
  return !!(p.address && p.doorCode && p.wifiName && p.wifiPassword);
}

/** Map a Property's arrival fields into the arrivalInfo() template shape. */
export function buildArrivalEmail(b: Booking, c: Client, p: Property) {
  return arrivalInfo(toEmailBooking(b, c), {
    address: p.address || '',
    doorCode: p.doorCode || '',
    wifiName: p.wifiName || '',
    wifiPassword: p.wifiPassword || '',
    checkinTime: p.checkinTime,
    checkoutTime: p.checkoutTime,
    rules: p.houseRules ?? [],
    hostPhone: process.env.HOST_PHONE || '',
    parking: p.parkingNotes || undefined,
    extraNotes: p.arrivalNotes || undefined,
  });
}
