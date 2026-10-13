import { getAddress, keccak256, parseUnits, toBytes } from 'viem';

export function invoiceMetadataHash(title: string, description: string, amount: string, seller: string) {
  return keccak256(toBytes(JSON.stringify({ title, description, amount, seller: getAddress(seller) })));
}

export function validateAmount(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,8}(\.\d{1,6})?$/.test(value)) {
    throw new Error('Enter an amount with up to 6 decimal places.');
  }
  const units = parseUnits(value, 6);
  if (units <= 0n) throw new Error('The amount must be greater than zero.');
  return units.toString();
}

export function validateDeliveryUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid HTTPS delivery URL.');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    return url.toString();
  } catch { throw new Error('Enter a valid HTTPS delivery URL.'); }
}
