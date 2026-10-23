"use client";

import NoteTree from "@/components/NotesTree";
import NoteContent from "@/components/NoteContent";
import { EditorProvider } from "@/providers/EditorProvider";
import { TreeProvider } from "@/providers/TreeProvider";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { VisuallyHidden } from "radix-ui";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTreeContext } from "@/providers/TreeProvider";

function MobileDrawer() {
  const { isDrawerOpen, setIsDrawerOpen, selectedNote } = useTreeContext();

  return (
    <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
      <DrawerContent className="h-[85vh] flex flex-col">
        <VisuallyHidden.Root>
          <DrawerTitle>{selectedNote?.title ?? "Note"}</DrawerTitle>
        </VisuallyHidden.Root>
        <div className="flex-1 overflow-auto px-4 pb-4">
          <NoteContent />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

const NotePageContent = () => {
  const isMobile = useIsMobile();

  if (isMobile === undefined || isMobile) {
    return (
      <EditorProvider>
        <>
          <div className="h-full w-full overflow-auto">
            <NoteTree />
          </div>
          <MobileDrawer />
        </>
      </EditorProvider>
    );
  }

  return (
    <EditorProvider>
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="60%" minSize="250px">
          <NoteTree />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="40%" minSize="400px" className="p-4">
          <NoteContent />
        </ResizablePanel>
      </ResizablePanelGroup>
    </EditorProvider>
  );
};

export default function NotePage() {
  return (
    <TreeProvider>
      <NotePageContent />
    </TreeProvider>
  );
}
