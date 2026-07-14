import { supabase } from './supabase';
export const LOCAL_USER_KEY = 'zeitstempel:last-user';
export function localOnlyUser() {
  let id = localStorage.getItem(LOCAL_USER_KEY);
  if (!id) {
    id = `local-${crypto.randomUUID()}`;
    localStorage.setItem(LOCAL_USER_KEY, id);
  }
  return id;
}
export async function sendMagicLink(email: string) {
  if (!supabase) throw new Error('Cloud-Anmeldung ist im lokalen Modus nicht eingerichtet.');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + '/auth/callback' },
  });
  if (error) throw error;
}
