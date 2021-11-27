export const sleep = async (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export function timestamp(): number {
  return Math.round(Date.now() / 1000);
}

export function roundUSD(num: number): number {
  return Math.round(num);
}

export function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear()
  );
}

export function getSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(/[^\w-]+/g, "");
}

export function weiToETH(wei: number): number {
  return wei / Math.pow(10, 18);
}

export function getPriceAtDate(
  date: string,
  historicalPrices: number[][] // [0] is a UNIX timestamp, [1] is the price
): number | null {
  const match = historicalPrices.find((priceArr) => {
    const d1 = new Date(priceArr[0]);
    const d2 = new Date(date);
    return isSameDay(d1, d2);
  });

  if (match) {
    return match[1];
  }

  return null;
}

export function formatUSD(price: number): bigint {
  return BigInt(roundUSD(price));
}
