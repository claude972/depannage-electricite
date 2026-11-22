export type AddressCandidate = {
  id: string;
  label: string;
  address: string;
  postal_code: string;
  city: string;
  latitude: number;
  longitude: number;
};
export type AddressSuggestions = {
  source: "IGN / BAN";
  candidates: AddressCandidate[];
  attribution: string;
};
export type AddressAssistError = { message: string; retryable: boolean };
