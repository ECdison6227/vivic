import { AlertDialog } from "radix-ui";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  disabled?: boolean;
  onConfirm: () => void;
}

/** Destructive-action guard (clear canvas / delete canvas). */
export const ConfirmDialog = ({
  trigger,
  title,
  description,
  confirmLabel = "确认",
  disabled,
  onConfirm,
}: ConfirmDialogProps) => (
  <AlertDialog.Root>
    <AlertDialog.Trigger asChild disabled={disabled}>
      {trigger}
    </AlertDialog.Trigger>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,380px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-white p-5 shadow-lg">
        <AlertDialog.Title className="text-sm font-semibold text-neutral-900">
          {title}
        </AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-sm text-neutral-600">
          {description}
        </AlertDialog.Description>
        <div className="mt-5 flex justify-end gap-2">
          <AlertDialog.Cancel asChild>
            <Button variant="secondary" size="sm">
              取消
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action asChild>
            <Button variant="destructive" size="sm" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);
