import {authenticatedClient} from '@/lib/supabase/server';
import {createMissionRadiusHandlers} from '@/lib/features/mission-radius/handlers';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const handlers=createMissionRadiusHandlers(authenticatedClient);
export const GET=handlers.GET;
export const POST=handlers.POST;
