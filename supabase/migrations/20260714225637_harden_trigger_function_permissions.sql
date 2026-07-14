-- Applied to project yknuhfwwuivhfstrawyx as migration harden_trigger_function_permissions.
-- Trigger functions do not need REST/RPC execution privileges.
alter function public.set_updated_at_and_revision() set search_path = '';
revoke execute on function public.check_time_break_ownership() from public, anon, authenticated;
revoke execute on function public.check_time_entry_project_ownership() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
