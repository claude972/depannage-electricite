import { createDraftStore } from './draft-store';
import { secureStorage } from './secure-storage';

export const deviceDrafts = createDraftStore(secureStorage);
