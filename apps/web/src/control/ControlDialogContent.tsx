import { Dialog } from "radix-ui";
import "./reading.css";
import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useDisplayPreferences } from "@/state/canvasStore";
import { Button } from "@/components/ui/button";

/** Control-only reading surfaces share Radix focus trapping and Motion. */
export function ControlDialogContent({ title, description, children, className = "", ...props }:
  Omit<ComponentProps<typeof Dialog.Content>, "title"> & { title: string; description: string; children: ReactNode }) {
  const systemReduced = useReducedMotion();
  const preferences = useDisplayPreferences();
  const reduced = systemReduced || preferences.reducedMotion;
  return <Dialog.Portal>
    <Dialog.Overlay className="vivic-dialog-overlay" />
    <Dialog.Content asChild {...props}>
      <motion.div className={`vivic-control-dialog ${className}`} data-reduced-motion={reduced || undefined}
        initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.18 }}>
        <header className="vivic-dialog-header">
          <div className="min-w-0">
            <Dialog.Title className="vivic-reading-title">{title}</Dialog.Title>
            <Dialog.Description className="vivic-reading-caption mt-2">{description}</Dialog.Description>
          </div>
          <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="关闭窗口"><X size={18} aria-hidden /></Button></Dialog.Close>
        </header>
        {children}
      </motion.div>
    </Dialog.Content>
  </Dialog.Portal>;
}
