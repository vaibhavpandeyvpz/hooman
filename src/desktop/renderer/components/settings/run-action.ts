import { toast } from "sonner";

/** Runs a management-RPC mutation, reloads on success, and toasts either way. */
export async function runManagementAction(
  action: () => Promise<unknown>,
  successMessage: string,
  reload: () => Promise<void> | void,
): Promise<boolean> {
  try {
    await action();
    await reload();
    toast.success(successMessage);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}
