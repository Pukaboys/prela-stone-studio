/** Website side of desktop licensing: issue tokens for activated devices. */
import { licenceStatus, saveAccount, type Account } from "@/lib/accounts";
import { signLicence } from "@/lib/licence-token";

export class LicenceRefused extends Error {
  constructor(message: string, public status = 403) {
    super(message);
  }
}

const clean = (s: unknown, max: number) => String(s ?? "").replace(/[^\w .\-'()]/g, "").slice(0, max);

/** Add (or refresh) this device on the account and return a signed token. */
export async function issueToken(a: Account, deviceId: string, deviceName?: string, allowNew = true) {
  if (!/^[a-f0-9-]{36}$/.test(deviceId)) throw new LicenceRefused("Invalid device.", 400);
  const status = licenceStatus(a);
  const now = new Date().toISOString();
  let device = a.licence.devices.find((d) => d.id === deviceId);
  if (!device) {
    if (!allowNew) throw new LicenceRefused("This computer was removed from your licence. Activate it again.");
    if (a.emailVerified === false) throw new LicenceRefused("Confirm your email address first: open the link we sent you, then sign in again.");
    if (!status.active) throw new LicenceRefused("Your licence has ended. Renew it on your account page.", 402);
    if (a.licence.devices.length >= status.maxDevices)
      throw new LicenceRefused(
        `Your licence is already active on ${status.maxDevices} computer${status.maxDevices === 1 ? "" : "s"}. Remove one on your account page first.`,
      );
    device = { id: deviceId, name: clean(deviceName, 60) || "Computer", activatedAt: now, lastSeen: now };
    a.licence.devices.push(device);
  } else {
    device.lastSeen = now;
    if (deviceName) device.name = clean(deviceName, 60) || device.name;
  }
  await saveAccount(a);
  return signLicence({ acc: a.id, email: a.email, plan: a.licence.plan, exp: new Date(a.licence.expiresAt).getTime(), dev: deviceId });
}
