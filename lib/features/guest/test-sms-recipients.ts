// A hosted preview cannot use phone Auth without its own test recipient list.
// Supplying the variable also enables the restriction on local test servers.
export function testSmsRecipients(env: Record<string, string | undefined>): string[] | null {
  const list = env.TEST_PHONE_NUMBERS;
  if (env.VERCEL_ENV !== "preview" && list === undefined) return null;
  if (!list || list.length > 1024) return [];
  const phones = list.split(",").map(value => value.trim());
  return phones.every(phone => /^\+[1-9]\d{7,14}$/.test(phone)) ? phones : [];
}
