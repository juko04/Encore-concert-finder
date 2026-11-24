import { cookies } from 'next/headers';
import {
  HOME_LOCATION_COOKIE,
  resolveHomeLocation,
  type HomeLocation,
} from './home-location';

/**
 * Server-side read of the user's chosen home location (cookie only).
 * Never throws: an unreadable cookie simply means "no location set".
 */
export async function getHomeLocation(): Promise<HomeLocation | null> {
  try {
    const store = await cookies();
    return resolveHomeLocation(store.get(HOME_LOCATION_COOKIE)?.value);
  } catch {
    return null;
  }
}
