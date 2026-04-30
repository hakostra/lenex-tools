export const LENEX_VERSION = '3.0';
export const UTF8_XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

export const APP_CONSTRUCTOR = {
  name: 'lenex-tools',
  version: '1',
  contact: {
    name: 'Håkon Strandenes',
    email: 'haakon@hakostra.net'
  }
} as const;

export const FORBIDDEN_REGISTRATION_ROUND_CODES = ['FIN', 'SEM', 'QUA', 'SOP', 'SOS', 'SOQ'] as const;
export const FORBIDDEN_REGISTRATION_ROUNDS = new Set<string>(FORBIDDEN_REGISTRATION_ROUND_CODES);
