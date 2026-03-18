import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Workspace } from '@/components/workspace/Workspace';
import { ConnectionProvider } from '@/hooks/use-connections';
import { SettingsProvider } from '@/hooks/use-settings';
import { WorkspaceProvider } from '@/hooks/use-workspace';
import { Toaster } from '@/components/ui/sonner';
import { LicenseDialog } from '@/components/help/LicenseDialog';
import { AboutDialog } from '@/components/help/AboutDialog';

export function App() {
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    const removeLicense = globalThis.window.helpApi.onShowLicense(() => setLicenseOpen(true));
    const removeAbout = globalThis.window.helpApi.onShowAbout(() => setAboutOpen(true));

    return () => {
      removeLicense();
      removeAbout();
    };
  }, []);

  return (
    <SettingsProvider>
      <ConnectionProvider>
        <WorkspaceProvider>
          <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
            <Sidebar />
            <Workspace />
          </div>
        </WorkspaceProvider>
        <Toaster position="bottom-right" />
        <LicenseDialog open={licenseOpen} onOpenChange={setLicenseOpen} />
        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      </ConnectionProvider>
    </SettingsProvider>
  );
}
