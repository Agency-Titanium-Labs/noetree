"use client";

import { DragDropProvider, PointerSensor } from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { useSortable, isSortable } from "@dnd-kit/react/sortable";
import { cn } from "@/lib/utils";

import ConditionChecker from "@/components/helpers/ConditionChecker";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { useHeaderConfig } from "@/providers/HeaderProvider";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useState } from "react";
import {
  Search,
  MoreVertical,
  Edit,
  Copy,
  Trash,
  Pin,
  UserPlus,
  LogOut,
  Users,
} from "lucide-react";
import ShareDialog from "@/components/ShareDialog";
import {
  DashboardTreeItem,
  addTreeToList,
  removeTreeFromList,
  renameTreeInList,
  updateTreeIndexInList,
  togglePinTreeInList,
} from "@/lib/treeUtils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const customSensors = [
  PointerSensor.configure({
    activationConstraints: event => {
      if (event.pointerType === "touch") {
        return [
          new PointerActivationConstraints.Delay({
            value: 250,
            tolerance: 10,
          }),
        ];
      }
      return [
        new PointerActivationConstraints.Distance({
          value: 5,
        }),
      ];
    },
    preventActivation: event => {
      const target = event.target as Element;
      return !!(
        target.closest("button") ||
        target.closest("input") ||
        target.closest("textarea") ||
        target.closest("[role='menu']") ||
        target.closest("[role='menuitem']")
      );
    },
  }),
];

interface DashboardSortableItemProps {
  tree: {
    _id: Id<"notes">;
    title: string;
    childNotes?: unknown[] | undefined;
    nestedNotesCount?: number;
    isPinned?: boolean;
    shareId?: Id<"shares">;
    isShared?: boolean;
    role?: "owner" | "admin" | "edit" | "view";
  };
  index: number;
  duplicateNote: (args: { id: Id<"notes"> }) => void;
  togglePinNote: (args: { id: Id<"notes"> }) => void;
  setNoteToRename: (val: { id: Id<"notes">; title: string } | null) => void;
  setNewTitle: (val: string) => void;
  setRenameError: (val: string | null) => void;
  setRenameDialogOpen: (val: boolean) => void;
  setNoteToDelete: (val: Id<"notes"> | null) => void;
  setDeleteAlertDialogOpen: (val: boolean) => void;
}

function DashboardSortableItem({
  tree,
  index,
  duplicateNote,
  togglePinNote,
  setNoteToRename,
  setNewTitle,
  setRenameError,
  setRenameDialogOpen,
  setNoteToDelete,
  setDeleteAlertDialogOpen,
}: DashboardSortableItemProps) {
  const t = useTranslations("Notes");
  const { ref, isDragging } = useSortable({
    id: tree._id,
    index,
  });

  const isTemp = typeof tree._id === "string" && tree._id.startsWith("temp-");
  const [isShareOpen, setIsShareOpen] = useState(false);

  return (
    <div
      ref={ref}
      className={cn(
        "relative group transition-transform h-full",
        isDragging ? "opacity-50 scale-95 z-20" : "hover:scale-[1.02]",
        isTemp && "opacity-60 pointer-events-none animate-pulse",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger disabled={isTemp}>
          <div className="h-full relative">
            <Link
              href={isTemp ? "#" : `/notes/${tree._id}`}
              className={cn("block h-full", isTemp && "pointer-events-none")}
            >
              <Card className="h-full hover:bg-muted/50 transition-colors pr-10">
                <CardHeader>
                  <CardTitle className="text-xl pr-6 truncate flex items-center gap-2">
                    {tree.title}
                    {tree.isShared && (
                      <Users className="h-4 w-4 text-blue-500 shrink-0" />
                    )}
                  </CardTitle>
                  <CardDescription>
                    {t("nestedNotes", { count: tree.nestedNotesCount ?? 0 })}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
            <div className="absolute top-4 right-4 z-10 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 transition-all duration-200",
                  tree.isPinned
                    ? "text-blue-500 hover:text-blue-600 scale-110"
                    : "md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-blue-500",
                )}
                disabled={tree.role === "view"}
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePinNote({ id: tree._id });
                }}
              >
                <Pin
                  className={cn(tree.isPinned && "fill-blue-500 -rotate-45")}
                />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onClick={e => e.stopPropagation()}
                >
                  {tree.role !== "view" && (
                    <DropdownMenuItem
                      onClick={() => {
                        setNoteToRename({
                          id: tree._id,
                          title: tree.title,
                        });
                        setNewTitle(tree.title);
                        setRenameError(null);
                        setRenameDialogOpen(true);
                      }}
                    >
                      <Edit />
                      {t("actions.edit")}
                    </DropdownMenuItem>
                  )}
                  {tree.role !== "view" && (
                    <DropdownMenuItem
                      onClick={() => {
                        duplicateNote({ id: tree._id });
                      }}
                    >
                      <Copy />
                      {t("actions.duplicate")}
                    </DropdownMenuItem>
                  )}
                  {tree.role !== "view" && (
                    <DropdownMenuItem
                      onClick={() => {
                        togglePinNote({ id: tree._id });
                      }}
                    >
                      <Pin
                        className={cn(
                          tree.isPinned &&
                            "fill-blue-500 text-blue-500 -rotate-45",
                        )}
                      />
                      {tree.isPinned ? t("actions.unpin") : t("actions.pin")}
                    </DropdownMenuItem>
                  )}
                  {(tree.role === "owner" || tree.role === "admin") && (
                    <DropdownMenuItem
                      onClick={() => {
                        setIsShareOpen(true);
                      }}
                    >
                      <UserPlus />
                      {t("actions.share")}
                    </DropdownMenuItem>
                  )}
                  {tree.role !== "view" && <DropdownMenuSeparator />}
                  {tree.isShared ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        setNoteToDelete(tree._id);
                        setDeleteAlertDialogOpen(true);
                      }}
                    >
                      <LogOut />
                      {t("actions.leave")}
                    </DropdownMenuItem>
                  ) : (
                    tree.role !== "view" && (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                          setNoteToDelete(tree._id);
                          setDeleteAlertDialogOpen(true);
                        }}
                      >
                        <Trash />
                        {t("actions.delete")}
                      </DropdownMenuItem>
                    )
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {tree.role !== "view" && (
            <ContextMenuItem
              onClick={() => {
                setNoteToRename({ id: tree._id, title: tree.title });
                setNewTitle(tree.title);
                setRenameError(null);
                setRenameDialogOpen(true);
              }}
            >
              <Edit />
              {t("actions.edit")}
            </ContextMenuItem>
          )}
          {tree.role !== "view" && (
            <ContextMenuItem
              onClick={() => {
                duplicateNote({ id: tree._id });
              }}
            >
              <Copy />
              {t("actions.duplicate")}
            </ContextMenuItem>
          )}
          {tree.role !== "view" && (
            <ContextMenuItem
              onClick={() => {
                togglePinNote({ id: tree._id });
              }}
            >
              <Pin
                className={cn(
                  tree.isPinned && "fill-blue-500 text-blue-500 -rotate-45",
                )}
              />
              {tree.isPinned ? t("actions.unpin") : t("actions.pin")}
            </ContextMenuItem>
          )}
          {(tree.role === "owner" || tree.role === "admin") && (
            <ContextMenuItem
              onClick={() => {
                setIsShareOpen(true);
              }}
            >
              <UserPlus />
              {t("actions.share")}
            </ContextMenuItem>
          )}
          {tree.role !== "view" && <ContextMenuSeparator />}
          {tree.isShared ? (
            <ContextMenuItem
              variant="destructive"
              onClick={() => {
                setNoteToDelete(tree._id);
                setDeleteAlertDialogOpen(true);
              }}
            >
              <LogOut />
              {t("actions.leave")}
            </ContextMenuItem>
          ) : (
            tree.role !== "view" && (
              <ContextMenuItem
                variant="destructive"
                onClick={() => {
                  setNoteToDelete(tree._id);
                  setDeleteAlertDialogOpen(true);
                }}
              >
                <Trash />
                {t("actions.delete")}
              </ContextMenuItem>
            )
          )}
        </ContextMenuContent>
      </ContextMenu>
      {!isTemp && (
        <ShareDialog
          noteId={tree._id}
          open={isShareOpen}
          onOpenChange={setIsShareOpen}
        />
      )}
    </div>
  );
}

interface SearchableNote {
  title: string;
  childNotes?: (SearchableNote | string | unknown)[] | undefined;
}

const matchNote = (note: SearchableNote, query: string): boolean => {
  if (note.title.toLowerCase().includes(query.toLowerCase())) {
    return true;
  }
  if (note.childNotes && Array.isArray(note.childNotes)) {
    return note.childNotes.some(child => {
      if (typeof child === "object" && child !== null && "title" in child) {
        return matchNote(child as SearchableNote, query);
      }
      return false;
    });
  }
  return false;
};

export default function Notes() {
  const t = useTranslations("Notes");

  const newTreeFormSchema = z.object({
    title: z
      .string()
      .nonempty(t("validation.required"))
      .max(50, t("validation.tooLong"))
      .min(3, t("validation.tooShort")),
  });

  const [newTreeDialogOpen, setNewTreeDialogOpen] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [noteToRename, setNoteToRename] = useState<{
    id: Id<"notes">;
    title: string;
  } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deleteAlertDialogOpen, setDeleteAlertDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<Id<"notes"> | null>(null);

  const queryClient = useQueryClient();
  const queryKey = convexQuery(api.notes.getTreesByMe, { deep: 10 }).queryKey;

  const { data, isPending, error } = useQuery(
    convexQuery(api.notes.getTreesByMe, { deep: 10 }),
  );

  const filteredTrees = data?.filter(tree => matchNote(tree, searchQuery));

  const updateNoteTitleMutate = useConvexMutation(api.notes.updateNoteTitle);
  const { mutate: updateNoteTitle } = useMutation<
    unknown,
    Error,
    Parameters<typeof updateNoteTitleMutate>[0],
    { previousTrees: DashboardTreeItem[] | undefined }
  >({
    mutationFn: updateNoteTitleMutate,
    onMutate: async variables => {
      setRenameDialogOpen(false);
      setNoteToRename(null);
      setNewTitle("");
      setRenameError(null);

      await queryClient.cancelQueries({ queryKey });
      const previousTrees =
        queryClient.getQueryData<DashboardTreeItem[]>(queryKey);
      if (previousTrees) {
        queryClient.setQueryData(
          queryKey,
          renameTreeInList(previousTrees, variables.id, variables.title),
        );
      }
      return { previousTrees };
    },
    onError: (
      err,
      variables,
      context?: { previousTrees: DashboardTreeItem[] | undefined },
    ) => {
      if (context?.previousTrees) {
        queryClient.setQueryData(queryKey, context.previousTrees);
      }
    },
  });

  const { mutate: duplicateNote } = useMutation({
    mutationFn: useConvexMutation(api.notes.duplicateNote),
  });

  const deleteNoteMutate = useConvexMutation(api.notes.deleteNote);
  const { mutate: deleteNote } = useMutation<
    unknown,
    Error,
    Parameters<typeof deleteNoteMutate>[0],
    { previousTrees: DashboardTreeItem[] | undefined }
  >({
    mutationFn: deleteNoteMutate,
    onMutate: async variables => {
      setDeleteAlertDialogOpen(false);
      setNoteToDelete(null);

      await queryClient.cancelQueries({ queryKey });
      const previousTrees =
        queryClient.getQueryData<DashboardTreeItem[]>(queryKey);
      if (previousTrees) {
        queryClient.setQueryData(
          queryKey,
          removeTreeFromList(previousTrees, variables.id),
        );
      }
      return { previousTrees };
    },
    onError: (
      err,
      variables,
      context?: { previousTrees: DashboardTreeItem[] | undefined },
    ) => {
      if (context?.previousTrees) {
        queryClient.setQueryData(queryKey, context.previousTrees);
      }
    },
  });

  const leaveShareMutate = useConvexMutation(api.notes.removeShare);
  const { mutate: leaveShare } = useMutation({
    mutationFn: leaveShareMutate,
    onSuccess: () => {
      setNoteToDelete(null);
      setDeleteAlertDialogOpen(false);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const updateNoteIndexMutate = useConvexMutation(api.notes.updateNoteIndex);
  const { mutate: updateNoteIndex } = useMutation<
    unknown,
    Error,
    Parameters<typeof updateNoteIndexMutate>[0],
    { previousTrees: DashboardTreeItem[] | undefined }
  >({
    mutationFn: updateNoteIndexMutate,
    onMutate: async variables => {
      await queryClient.cancelQueries({ queryKey });
      const previousTrees =
        queryClient.getQueryData<DashboardTreeItem[]>(queryKey);
      if (previousTrees) {
        queryClient.setQueryData(
          queryKey,
          updateTreeIndexInList(previousTrees, variables.id, variables.index),
        );
      }
      return { previousTrees };
    },
    onError: (
      err,
      variables,
      context?: { previousTrees: DashboardTreeItem[] | undefined },
    ) => {
      if (context?.previousTrees) {
        queryClient.setQueryData(queryKey, context.previousTrees);
      }
    },
  });

  const togglePinNoteMutate = useConvexMutation(api.notes.togglePinNote);
  const { mutate: togglePinNote } = useMutation<
    unknown,
    Error,
    Parameters<typeof togglePinNoteMutate>[0],
    { previousTrees: DashboardTreeItem[] | undefined }
  >({
    mutationFn: togglePinNoteMutate,
    onMutate: async variables => {
      await queryClient.cancelQueries({ queryKey });
      const previousTrees =
        queryClient.getQueryData<DashboardTreeItem[]>(queryKey);
      if (previousTrees) {
        queryClient.setQueryData(
          queryKey,
          togglePinTreeInList(previousTrees, variables.id),
        );
      }
      return { previousTrees };
    },
    onError: (
      err,
      variables,
      context?: { previousTrees: DashboardTreeItem[] | undefined },
    ) => {
      if (context?.previousTrees) {
        queryClient.setQueryData(queryKey, context.previousTrees);
      }
    },
  });

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = newTitle.trim();
    if (!cleanTitle || cleanTitle.length < 3) {
      setRenameError(t("validation.tooShort"));
      return;
    }
    if (cleanTitle.length > 50) {
      setRenameError(t("validation.tooLong"));
      return;
    }

    const titleExists = data?.some(
      note =>
        note._id !== noteToRename?.id &&
        note.title.toLowerCase() === cleanTitle.toLowerCase(),
    );

    if (titleExists) {
      setRenameError(t("validation.exists"));
      return;
    }

    if (noteToRename) {
      updateNoteTitle({ id: noteToRename.id, title: cleanTitle });
    }
  };

  const newTreeForm = useForm<z.infer<typeof newTreeFormSchema>>({
    resolver: zodResolver(newTreeFormSchema),
    defaultValues: { title: "" },
  });

  const createNoteMutate = useConvexMutation(api.notes.createNote);
  const { mutate: createNote, isPending: isNotePending } = useMutation<
    unknown,
    Error,
    Parameters<typeof createNoteMutate>[0],
    { previousTrees: DashboardTreeItem[] | undefined }
  >({
    mutationFn: createNoteMutate,
    onMutate: async variables => {
      newTreeForm.reset();
      setNewTreeDialogOpen(false);
      setTitleError(null);

      await queryClient.cancelQueries({ queryKey });
      const previousTrees =
        queryClient.getQueryData<DashboardTreeItem[]>(queryKey);
      if (previousTrees) {
        const tempId = `temp-${Math.random()}` as unknown as Id<"notes">;
        queryClient.setQueryData(
          queryKey,
          addTreeToList(previousTrees, variables.title, tempId),
        );
      }
      return { previousTrees };
    },
    onError: (
      err,
      variables,
      context?: { previousTrees: DashboardTreeItem[] | undefined },
    ) => {
      if (context?.previousTrees) {
        queryClient.setQueryData(queryKey, context.previousTrees);
      }
    },
  });

  const handleSubmit = newTreeForm.handleSubmit(async formData => {
    const titleExists = data?.some(
      note => note.title.toLowerCase() === formData.title.toLowerCase(),
    );

    if (titleExists) {
      setTitleError(t("validation.exists"));
      return;
    }

    setTitleError(null);
    createNote(formData);
  });

  useHeaderConfig({
    title: t("title"),
    search:
      !isPending && !error && !!data && data.length > 0 ? (
        <div className="relative w-full max-w-50 xs:max-w-xs sm:max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-8 h-9 w-full bg-muted/40 focus:bg-background transition-colors"
          />
        </div>
      ) : null,
    action: (
      <Dialog open={newTreeDialogOpen} onOpenChange={setNewTreeDialogOpen}>
        <DialogTrigger asChild>
          <Button size="sm">
            <span className="hidden sm:inline">{t("createButton")}</span>
            <span className="sm:hidden text-lg font-bold">+</span>
          </Button>
        </DialogTrigger>
        <DialogContent>
          <Form {...newTreeForm}>
            <form onSubmit={handleSubmit} className="contents">
              <DialogHeader>
                <DialogTitle>{t("createTitle")}</DialogTitle>
                <DialogDescription>{t("createDesc")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-8">
                <FormField
                  control={newTreeForm.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("formTitleLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("formTitlePlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>{t("formTitleDesc")}</FormDescription>
                      <FormMessage />
                      {titleError && (
                        <p className="text-sm font-medium text-destructive mt-1">
                          {titleError}
                        </p>
                      )}
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    {t("close")}
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={isNotePending}>
                  <span>{t("create")}</span>
                  <ConditionChecker condition={isNotePending}>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 200 200"
                      className="w-4 h-4 animate-spin ml-2 inline-block"
                    >
                      <circle
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="15"
                        r="15"
                        cx="40"
                        cy="65"
                      />
                    </svg>
                  </ConditionChecker>
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    ),
  });

  return (
    <div className="flex flex-col justify-center items-center gap-8 p-6">
      <ConditionChecker condition={!!isPending}>
        <p>{t("loading")}</p>
      </ConditionChecker>

      <ConditionChecker condition={!isPending && !error && !!data}>
        <ConditionChecker condition={!!data && data.length === 0}>
          <p>{t("noTrees")}</p>
        </ConditionChecker>

        <ConditionChecker
          condition={
            !!data &&
            data.length > 0 &&
            !!filteredTrees &&
            filteredTrees.length === 0
          }
        >
          <p className="text-muted-foreground">{t("noMatch")}</p>
        </ConditionChecker>

        <ConditionChecker
          condition={!!filteredTrees && filteredTrees.length > 0}
        >
          <DragDropProvider
            sensors={customSensors}
            onDragOver={event => {
              const { operation } = event;
              const { source, target } = operation;
              if (isSortable(source) && isSortable(target) && filteredTrees) {
                const sourceItem = filteredTrees.find(t => t._id === source.id);
                const targetItem = filteredTrees.find(t => t._id === target.id);
                if (
                  sourceItem &&
                  targetItem &&
                  !!sourceItem.isPinned !== !!targetItem.isPinned
                ) {
                  event.preventDefault();
                }
              }
            }}
            onDragEnd={({ operation }) => {
              const { source } = operation;
              if (isSortable(source) && filteredTrees) {
                const { initialIndex, index: newIndex } = source.sortable;
                if (initialIndex !== newIndex) {
                  const itemToMove = filteredTrees[initialIndex];
                  const target = filteredTrees[newIndex];
                  if (!!itemToMove.isPinned !== !!target.isPinned) {
                    return;
                  }

                  const updated = [...filteredTrees];
                  const [moved] = updated.splice(initialIndex, 1);
                  updated.splice(newIndex, 0, moved);

                  // Calculate fractional index
                  const getNoteIndex = (note: typeof moved) =>
                    note.index ?? note._creationTime;
                  let newIndexValue: number;

                  if (newIndex === 0) {
                    newIndexValue = getNoteIndex(updated[1]) - 1000;
                  } else if (newIndex === updated.length - 1) {
                    newIndexValue =
                      getNoteIndex(updated[updated.length - 2]) + 1000;
                  } else {
                    newIndexValue =
                      (getNoteIndex(updated[newIndex - 1]) +
                        getNoteIndex(updated[newIndex + 1])) /
                      2;
                  }

                  updateNoteIndex({
                    id: moved._id,
                    index: newIndexValue,
                  });
                }
              }
            }}
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4 md:gap-6 w-full max-w-6xl">
              {filteredTrees?.map((tree, index) => (
                <DashboardSortableItem
                  key={tree._id}
                  tree={tree}
                  index={index}
                  duplicateNote={duplicateNote}
                  togglePinNote={togglePinNote}
                  setNoteToRename={setNoteToRename}
                  setNewTitle={setNewTitle}
                  setRenameError={setRenameError}
                  setRenameDialogOpen={setRenameDialogOpen}
                  setNoteToDelete={setNoteToDelete}
                  setDeleteAlertDialogOpen={setDeleteAlertDialogOpen}
                />
              ))}
            </div>
          </DragDropProvider>
        </ConditionChecker>
      </ConditionChecker>

      <ConditionChecker condition={!!error}>
        <p>{t("error")}</p>
      </ConditionChecker>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <form onSubmit={handleRenameSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("renameTitle")}</DialogTitle>
              <DialogDescription>
                {t("renameDesc", { title: noteToRename?.title || "" })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Input
                placeholder={t("renamePlaceholder")}
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
              />
              {renameError && (
                <p className="text-sm font-medium text-destructive mt-1">
                  {renameError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRenameDialogOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit">{t("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {(() => {
        const noteObj = filteredTrees?.find(x => x._id === noteToDelete);
        const isLeaving = !!noteObj?.isShared;

        return (
          <AlertDialog
            open={deleteAlertDialogOpen}
            onOpenChange={setDeleteAlertDialogOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isLeaving ? t("leaveConfirmTitle") : t("deleteConfirmTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isLeaving ? t("leaveConfirmDesc") : t("deleteConfirmDesc")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  onClick={() => {
                    setDeleteAlertDialogOpen(false);
                    setNoteToDelete(null);
                  }}
                >
                  {t("cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  onClick={() => {
                    if (noteToDelete && noteObj) {
                      if (isLeaving && noteObj.shareId) {
                        leaveShare({ shareId: noteObj.shareId });
                      } else {
                        deleteNote({ id: noteToDelete });
                      }
                    }
                  }}
                >
                  {isLeaving ? t("leave") : t("delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      })()}
    </div>
  );
}
