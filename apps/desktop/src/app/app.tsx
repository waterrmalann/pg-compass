import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Workspace } from "@/components/workspace/workspace";
import { ConnectionProvider } from "@/hooks/use-connections";
import { SettingsProvider } from "@/hooks/use-settings";
import { WorkspaceProvider } from "@/hooks/use-workspace";
import { Toaster } from "@/components/ui/sonner";
import { LicenseDialog } from "@/components/help/license-dialog";
import { AboutDialog } from "@/components/help/about-dialog";
import { KeyboardShortcutsDialog } from "@/components/help/keyboard-shortcuts-dialog";
import { UpdateBanner } from "@/components/updates/update-banner";

export function App() {
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(function setupHelpEventListeners() {
    const removeLicense = globalThis.window.helpApi.onShowLicense(() =>
      setLicenseOpen(true),
    );
    const removeAbout = globalThis.window.helpApi.onShowAbout(() =>
      setAboutOpen(true),
    );
    const removeShortcuts = globalThis.window.helpApi.onShowShortcuts(() =>
      setShortcutsOpen(true),
    );

    return () => {
      removeLicense();
      removeAbout();
      removeShortcuts();
    };
  }, []);

  return (
    <SettingsProvider>
      <ConnectionProvider>
        <WorkspaceProvider>
          <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
            <UpdateBanner />
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <Sidebar />
              <Workspace />
            </div>
          </div>
        </WorkspaceProvider>
        <Toaster position="bottom-right" />
        <LicenseDialog open={licenseOpen} onOpenChange={setLicenseOpen} />
        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
        <KeyboardShortcutsDialog
          open={shortcutsOpen}
          onOpenChange={setShortcutsOpen}
        />
      </ConnectionProvider>
    </SettingsProvider>
  );
}
