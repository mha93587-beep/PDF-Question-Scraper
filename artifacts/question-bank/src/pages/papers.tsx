import { useState } from "react";
import {
  useListPapers,
  useGetPaper,
  useGetPaperQuestions,
  useDeletePaper,
  getListPapersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Link } from "wouter";
import {
  FileText,
  Calendar,
  ArrowRight,
  Loader2,
  Hash,
  FileSearch,
  Images,
  Trash2,
  CheckSquare,
  Square,
  X,
  ImageOff,
} from "lucide-react";
import type { Question } from "@workspace/api-client-react";

type ExtendedQuestion = Question & { figureObjectPath?: string | null };

function PdfTextSheet({
  paperId,
  open,
  onClose,
}: {
  paperId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: paper, isLoading } = useGetPaper(paperId!, {
    query: { enabled: open && paperId !== null },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <FileSearch className="w-5 h-5" />
            Full Extracted PDF Text
          </SheetTitle>
          {paper && (
            <p className="text-sm text-muted-foreground mt-1">
              {paper.examName}
              {paper.year && ` · ${paper.year}`}
              {paper.shift && ` · ${paper.shift}`}
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-hidden px-6 py-4">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !paper?.fullPdfText ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="w-12 h-12 mb-3 opacity-20" />
              <p className="font-medium">No extracted text available</p>
              <p className="text-sm mt-1">
                This paper was uploaded before this feature was added. Re-upload the PDF to extract text.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/80 pr-2">
                {paper.fullPdfText}
              </pre>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SnapshotsDialog({
  paperId,
  paperName,
  open,
  onClose,
}: {
  paperId: number | null;
  paperName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: questions, isLoading } = useGetPaperQuestions(paperId!, {
    query: { enabled: open && paperId !== null },
  });

  const extQuestions = (questions as ExtendedQuestion[] | undefined) ?? [];
  const withSnapshots = extQuestions.filter((q) => q.figureObjectPath);
  const figureQuestions = extQuestions.filter((q) => q.hasFigure);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl w-full max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Images className="w-5 h-5" />
            All Question Snapshots
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {paperName}
            {!isLoading && (
              <span className="ml-2">
                · {withSnapshots.length} snapshots
                {figureQuestions.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {figureQuestions.length} with figures
                  </Badge>
                )}
              </span>
            )}
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : withSnapshots.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ImageOff className="w-12 h-12 mb-3 opacity-20" />
              <p className="font-medium">No snapshots available</p>
              <p className="text-sm mt-1">
                Snapshots are captured for newly processed papers. Re-upload the PDF to generate them.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {withSnapshots.map((q) => (
                <div key={q.id} className="rounded-lg border bg-card overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        Q.{q.questionNumber}
                      </Badge>
                      {q.hasFigure && (
                        <Badge variant="secondary" className="text-xs">Figure</Badge>
                      )}
                    </div>
                  </div>
                  <div className="bg-white p-2">
                    <img
                      src={`/api/figure?path=${encodeURIComponent(q.figureObjectPath!)}`}
                      alt={`Question ${q.questionNumber} snapshot`}
                      className="w-full object-contain max-h-52"
                      loading="lazy"
                    />
                  </div>
                  {q.questionText && (
                    <div className="px-3 py-2 text-xs text-muted-foreground line-clamp-2 border-t">
                      {q.questionText}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export default function PapersPage() {
  const queryClient = useQueryClient();
  const { data: papers, isLoading } = useListPapers({
    query: { queryKey: getListPapersQueryKey() },
  });

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [pdfTextPaperId, setPdfTextPaperId] = useState<number | null>(null);
  const [pdfTextOpen, setPdfTextOpen] = useState(false);

  const [snapshotsPaperId, setSnapshotsPaperId] = useState<number | null>(null);
  const [snapshotsPaperName, setSnapshotsPaperName] = useState("");
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);

  const deletePaperMutation = useDeletePaper();

  function toggleSelection(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!papers) return;
    if (selectedIds.size === papers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(papers.map((p) => p.id)));
    }
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  async function handleBulkDelete() {
    setIsBulkDeleting(true);
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      try {
        await deletePaperMutation.mutateAsync({ id });
      } catch {
        // continue with remaining
      }
    }
    await queryClient.invalidateQueries({ queryKey: getListPapersQueryKey() });
    setIsBulkDeleting(false);
    setBulkDeleteOpen(false);
    exitSelectionMode();
  }

  function openPdfText(e: React.MouseEvent, paperId: number) {
    e.preventDefault();
    e.stopPropagation();
    setPdfTextPaperId(paperId);
    setPdfTextOpen(true);
  }

  function openSnapshots(e: React.MouseEvent, paperId: number, paperName: string) {
    e.preventDefault();
    e.stopPropagation();
    setSnapshotsPaperId(paperId);
    setSnapshotsPaperName(paperName);
    setSnapshotsOpen(true);
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">All Papers</h1>
        <p className="text-muted-foreground text-lg">Browse all uploaded question papers.</p>
      </div>

      {papers && papers.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          {!selectionMode ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectionMode(true)}
            >
              <CheckSquare className="w-4 h-4 mr-1.5" />
              Select Papers
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                {selectedIds.size === papers.length ? (
                  <><Square className="w-4 h-4 mr-1.5" />Deselect All</>
                ) : (
                  <><CheckSquare className="w-4 h-4 mr-1.5" />Select All</>
                )}
              </Button>
              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Delete {selectedIds.size} Paper{selectedIds.size > 1 ? "s" : ""}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={exitSelectionMode}>
                <X className="w-4 h-4 mr-1.5" />
                Cancel
              </Button>
              {selectedIds.size > 0 && (
                <span className="text-sm text-muted-foreground">
                  {selectedIds.size} of {papers.length} selected
                </span>
              )}
            </>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : papers && papers.length > 0 ? (
        <div className="space-y-3">
          {papers.map((paper) => {
            const isSelected = selectedIds.has(paper.id);
            const cardContent = (
              <Card
                key={paper.id}
                className={`shadow-sm transition-colors ${
                  selectionMode
                    ? isSelected
                      ? "border-primary bg-primary/5"
                      : "hover:border-muted-foreground/30 cursor-pointer"
                    : "hover:border-primary/50 group cursor-pointer"
                }`}
                onClick={selectionMode ? () => toggleSelection(paper.id) : undefined}
              >
                <CardContent className="flex items-center justify-between p-5 gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    {selectionMode && (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelection(paper.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0"
                      />
                    )}
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="font-semibold text-lg group-hover:text-primary transition-colors truncate">
                        {paper.examName}
                      </span>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        {paper.year && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" /> {paper.year}
                          </span>
                        )}
                        {paper.shift && <span>{paper.shift}</span>}
                        <span className="flex items-center gap-1">
                          <Hash className="w-3.5 h-3.5" /> {paper.totalQuestions} questions
                        </span>
                        {paper.fullPdfText && (
                          <Badge variant="outline" className="text-xs py-0">
                            Text extracted
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!selectionMode && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="hidden sm:flex"
                          onClick={(e) => openPdfText(e, paper.id)}
                          title="View full extracted PDF text"
                        >
                          <FileSearch className="w-4 h-4 mr-1.5" />
                          PDF Text
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="hidden sm:flex"
                          onClick={(e) => openSnapshots(e, paper.id, paper.examName)}
                          title="View all question snapshots"
                        >
                          <Images className="w-4 h-4 mr-1.5" />
                          Snapshots
                        </Button>
                        <Link href={`/papers/${paper.id}`} onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                          </Button>
                        </Link>
                      </>
                    )}
                    {selectionMode && (
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/30"
                        }`}
                      >
                        {isSelected && (
                          <div className="w-2 h-2 rounded-full bg-white" />
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>

                {!selectionMode && (
                  <div className="flex sm:hidden border-t px-5 py-2 gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={(e) => openPdfText(e, paper.id)}
                    >
                      <FileSearch className="w-3.5 h-3.5 mr-1" />
                      PDF Text
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={(e) => openSnapshots(e, paper.id, paper.examName)}
                    >
                      <Images className="w-3.5 h-3.5 mr-1" />
                      Snapshots
                    </Button>
                  </div>
                )}
              </Card>
            );

            return selectionMode ? (
              <div key={paper.id}>{cardContent}</div>
            ) : (
              <div key={paper.id}>{cardContent}</div>
            );
          })}
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FileText className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">No papers uploaded yet</p>
            <p className="text-sm">Upload a PDF to get started.</p>
          </CardContent>
        </Card>
      )}

      <PdfTextSheet
        paperId={pdfTextPaperId}
        open={pdfTextOpen}
        onClose={() => setPdfTextOpen(false)}
      />

      <SnapshotsDialog
        paperId={snapshotsPaperId}
        paperName={snapshotsPaperName}
        open={snapshotsOpen}
        onClose={() => setSnapshotsOpen(false)}
      />

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} paper{selectedIds.size > 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <strong>{selectedIds.size} selected paper{selectedIds.size > 1 ? "s" : ""}</strong>{" "}
              and all their questions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deleting...</>
              ) : (
                <>Yes, Delete All</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
