export type Category =
  | 'party'
  | 'address'
  | 'email'
  | 'phone'
  | 'card'
  | 'iban'
  | 'gov_id'
  | 'account'
  | 'other';

export interface Proposal {
  id: string;
  category: Category;
  start: number;
  end: number;
  text: string;
  source: 'rule' | 'party' | 'manual';
  basis: 'checksum' | 'pattern' | 'user';
  placeholderHint?: 'LANDLORD' | 'TENANT';
}
