import {
  Code2,
  Columns3,
  KeyRound,
  ListTree,
  Rows3,
  Shapes,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RelationSubTab } from "@/shared/types/workspace";

const SUB_TABS: Record<RelationSubTab, { label: string; icon: LucideIcon }> = {
  data: { label: "Data", icon: Rows3 },
  structure: { label: "Structure", icon: Columns3 },
  indexes: { label: "Indexes", icon: ListTree },
  constraints: { label: "Constraints", icon: KeyRound },
  triggers: { label: "Triggers", icon: Zap },
  types: { label: "Types", icon: Shapes },
  query: { label: "Query", icon: Code2 },
};

/** Segmented view switcher for a table or view's sub-tabs (§9.2). */
export function RelationSubTabsList({
  tabs,
}: Readonly<{ tabs: RelationSubTab[] }>) {
  return (
    <TabsList className="shrink-0">
      {tabs.map((tab) => {
        const { label, icon: Icon } = SUB_TABS[tab];
        return (
          <TabsTrigger key={tab} value={tab}>
            <Icon />
            {label}
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}
