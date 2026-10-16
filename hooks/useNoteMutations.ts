import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConvexMutation, convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  NoteTree,
  addChildNoteToTree,
  moveNoteInTree,
  updateChildOrderInTree,
  removeNoteFromTree,
  updateTitleInTree,
} from "@/lib/treeUtils";

export function useNoteMutations(
  noteId: Id<"notes">,
  setSelectedNoteId?: (id: Id<"notes">) => void,
) {
  const queryClient = useQueryClient();
  const queryKey = convexQuery(api.notes.getTreeById, {
    id: noteId,
    deep: 10,
  }).queryKey;

  const updateNoteTitleMutate = useConvexMutation(api.notes.updateNoteTitle);
  const updateNoteTitle = useMutation<
    unknown,
    Error,
    Parameters<typeof updateNoteTitleMutate>[0],
    { previousTree: NoteTree | undefined }
  >({
    mutationFn: updateNoteTitleMutate,
    onMutate: async variables => {
      await queryClient.cancelQueries({ queryKey });
      const previousTree = queryClient.getQueryData<NoteTree>(queryKey);
      if (previousTree) {
        const newTree = updateTitleInTree(
          previousTree,
          variables.id,
          variables.title,
        );
        queryClient.setQueryData(queryKey, newTree);
      }
      return { previousTree };
    },
    onError: (err, variables, context) => {
      if (context?.previousTree) {
        queryClient.setQueryData(queryKey, context.previousTree);
      }
    },
  });

  const createNoteMutate = useConvexMutation(api.notes.createNote);
  const createNote = useMutation<
    Id<"notes">,
    Error,
    Parameters<typeof createNoteMutate>[0],
    { previousTree: NoteTree | undefined }
  >({
    mutationFn: createNoteMutate,
    onMutate: async variables => {
      await queryClient.cancelQueries({ queryKey });
      const previousTree = queryClient.getQueryData<NoteTree>(queryKey);
      const tempId = `temp-${Math.random()}`;
      if (previousTree && variables.parentNote) {
        const newTree = addChildNoteToTree(
          previousTree,
          variables.parentNote,
          variables.title,
          tempId,
        );
        queryClient.setQueryData(queryKey, newTree);
      }
      return { previousTree };
    },
    onError: (err, variables, context) => {
      if (context?.previousTree) {
        queryClient.setQueryData(queryKey, context.previousTree);
      }
    },
    onSuccess: (newNoteId: Id<"notes">) => {
      if (setSelectedNoteId) {
        setSelectedNoteId(newNoteId);
      }
    },
  });

  const deleteNoteMutate = useConvexMutation(api.notes.deleteNote);
  const deleteNote = useMutation<
    unknown,
    Error,
    Parameters<typeof deleteNoteMutate>[0],
    { previousTree: NoteTree | undefined }
  >({
    mutationFn: deleteNoteMutate,
    onMutate: async variables => {
      await queryClient.cancelQueries({ queryKey });
      const previousTree = queryClient.getQueryData<NoteTree>(queryKey);
      if (previousTree) {
        const newTree = removeNoteFromTree(previousTree, variables.id);
        queryClient.setQueryData(queryKey, newTree);
      }
      return { previousTree };
    },
    onError: (err, variables, context) => {
      if (context?.previousTree) {
        queryClient.setQueryData(queryKey, context.previousTree);
      }
    },
  });

  const updateChildNotesMutate = useConvexMutation(api.notes.updateChildNotes);
  const updateChildNotes = useMutation<
    unknown,
    Error,
    Parameters<typeof updateChildNotesMutate>[0],
    { previousTree: NoteTree | undefined }
  >({
    mutationFn: updateChildNotesMutate,
    onMutate: async variables => {
      await queryClient.cancelQueries({ queryKey });
      const previousTree = queryClient.getQueryData<NoteTree>(queryKey);
      if (previousTree) {
        const newTree = updateChildOrderInTree(
          previousTree,
          variables.id,
          variables.childNotes || [],
        );
        queryClient.setQueryData(queryKey, newTree);
      }
      return { previousTree };
    },
    onError: (err, variables, context) => {
      if (context?.previousTree) {
        queryClient.setQueryData(queryKey, context.previousTree);
      }
    },
  });

  const moveNoteMutate = useConvexMutation(api.notes.moveNote);
  const moveNote = useMutation<
    unknown,
    Error,
    Parameters<typeof moveNoteMutate>[0],
    { previousTree: NoteTree | undefined }
  >({
    mutationFn: moveNoteMutate,
    onMutate: async variables => {
      await queryClient.cancelQueries({ queryKey });
      const previousTree = queryClient.getQueryData<NoteTree>(queryKey);
      if (previousTree) {
        const newTree = moveNoteInTree(
          previousTree,
          variables.id,
          variables.from,
          variables.to,
          variables.index,
        );
        queryClient.setQueryData(queryKey, newTree);
      }
      return { previousTree };
    },
    onError: (err, variables, context) => {
      if (context?.previousTree) {
        queryClient.setQueryData(queryKey, context.previousTree);
      }
    },
  });

  return {
    updateNoteTitle: updateNoteTitle.mutate,
    createNote: createNote.mutate,
    deleteNote: deleteNote.mutate,
    updateChildNotes: updateChildNotes.mutate,
    moveNote: moveNote.mutate,
  };
}
