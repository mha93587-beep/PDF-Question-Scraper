import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useGetPaper,
  useGetPaperQuestions,
  useUpdatePaper,
  useDeletePaper,
  useUpdateQuestion,
  getGetPaperQueryKey,
  getGetPaperQuestionsQueryKey,
  getListPapersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  Loader2,
  ImageIcon,
  CheckCircle2,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import type { Question } from "@workspace/api-client-react";

export default function PaperDetailPage({ id }: { id: string }) {
  const paperId = parseInt(id, 10);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: paper, isLoading: paperLoading } = useGetPaper(paperId, {
    query: { enabled: !isNaN(paperId), queryKey: getGetPaperQueryKey(paperId) },
  });

  const { data: questions, isLoading: questionsLoading } = useGetPaperQuestions(paperId, {
    query: { enabled: !isNaN(paperId), queryKey: getGetPaperQuestionsQueryKey(paperId) },
  });

  const [editPaperOpen, setEditPaperOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editPaperForm, setEditPaperForm] = useState({ examName: "", year: "", shift: "" });

  const [editQuestionOpen, setEditQuestionOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [editQuestionForm, setEditQuestionForm] = useState({
    questionText: "",
    optionA: "",
    optionB: "",
    optionC: "",
    optionD: "",
    correctAnswer: "",
    subject: "",
    note: "",
    figureData: "",
  });
  const figureInputRef = useRef<HTMLInputElement>(null);

  const updatePaperMutation = useUpdatePaper({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPaperQueryKey(paperId) });
        queryClient.invalidateQueries({ queryKey: getListPapersQueryKey() });
        setEditPaperOpen(false);
      },
    },
  });

  const deletePaperMutation = useDeletePaper({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPapersQueryKey() });
        navigate("/papers");
      },
      onError: () => {
        toast({
          title: "Delete failed",
          description: "Could not delete this paper. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const updateQuestionMutation = useUpdateQuestion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPaperQuestionsQueryKey(paperId) });
        setEditQuestionOpen(false);
      },
    },
  });

  function openEditPaper() {
    setEditPaperForm({
      examName: paper?.examName || "",
      year: paper?.year || "",
      shift: paper?.shift || "",
    });
    setEditPaperOpen(true);
  }

  function openEditQuestion(q: Question) {
    setEditingQuestion(q);
    setEditQuestionForm({
      questionText: q.questionText || "",
      optionA: q.optionA || "",
      optionB: q.optionB || "",
      optionC: q.optionC || "",
      optionD: q.optionD || "",
      correctAnswer: q.correctAnswer || "",
      subject: q.subject || "",
      note: q.note || "",
      figureData: q.figureData || "",
    });
    setEditQuestionOpen(true);
  }

  function handleFigureUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setEditQuestionForm((f) => ({ ...f, figureData: ev.target?.result as string }));
    };
    reader.readAsDataURL(file);
  }

  if (paperLoading || questionsLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" asChild>
            <Link href="/papers">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{paper?.examName || "Paper"}</h1>
            <p className="text-muted-foreground">
              {paper?.year && `Year: ${paper.year}`}
              {paper?.shift && ` | ${paper.shift}`}
              {` | ${paper?.totalQuestions || 0} questions`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={openEditPaper}>
            <Pencil className="w-4 h-4 mr-1" /> Edit Paper
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="w-4 h-4 mr-1" /> Delete Paper
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {questions?.map((q) => (
          <Card key={q.id} className="shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono">Q.{q.questionNumber}</Badge>
                  {q.hasFigure && (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" /> Figure
                    </Badge>
                  )}
                  {q.subject && (
                    <Badge variant="outline" className="text-xs">{q.subject}</Badge>
                  )}
                  {q.questionIdOriginal && (
                    <span className="text-xs text-muted-foreground">ID: {q.questionIdOriginal}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {q.correctAnswer && (
                    <Badge className="bg-green-100 text-green-800 border-green-200 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {q.correctAnswer}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => openEditQuestion(q)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <p className="text-foreground mb-4 leading-relaxed whitespace-pre-wrap">{q.questionText}</p>

              {q.figureData && (
                <div className="mb-4 rounded-lg border bg-white p-2">
                  <img
                    src={q.figureData}
                    alt={`Question ${q.questionNumber} figure`}
                    className="max-h-[520px] w-full object-contain"
                    loading="lazy"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[
                  { label: "A", value: q.optionA },
                  { label: "B", value: q.optionB },
                  { label: "C", value: q.optionC },
                  { label: "D", value: q.optionD },
                ].map((opt) =>
                  opt.value ? (
                    <div
                      key={opt.label}
                      className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${
                        q.correctAnswer === opt.label
                          ? "border-green-300 bg-green-50 text-green-900"
                          : "border-border bg-card"
                      }`}
                    >
                      <span className="font-semibold shrink-0">{opt.label}.</span>
                      <span>{opt.value}</span>
                    </div>
                  ) : null
                )}
              </div>

              {q.note && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  Note: {q.note}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit Paper Dialog */}
      <Dialog open={editPaperOpen} onOpenChange={setEditPaperOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Paper Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ep-examName">Exam Name</Label>
              <Input
                id="ep-examName"
                value={editPaperForm.examName}
                onChange={(e) => setEditPaperForm((f) => ({ ...f, examName: e.target.value }))}
                placeholder="e.g. RRB NTPC"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-year">Year</Label>
              <Input
                id="ep-year"
                value={editPaperForm.year}
                onChange={(e) => setEditPaperForm((f) => ({ ...f, year: e.target.value }))}
                placeholder="e.g. 2025"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-shift">Shift</Label>
              <Input
                id="ep-shift"
                value={editPaperForm.shift}
                onChange={(e) => setEditPaperForm((f) => ({ ...f, shift: e.target.value }))}
                placeholder="e.g. Morning Shift"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPaperOpen(false)}>Cancel</Button>
            <Button
              onClick={() =>
                updatePaperMutation.mutate({
                  id: paperId,
                  data: {
                    examName: editPaperForm.examName || undefined,
                    year: editPaperForm.year || null,
                    shift: editPaperForm.shift || null,
                  },
                })
              }
              disabled={updatePaperMutation.isPending || !editPaperForm.examName}
            >
              {updatePaperMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Paper Confirm */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this paper?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{paper?.examName}</strong> and all{" "}
              {paper?.totalQuestions} questions inside it. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletePaperMutation.mutate({ id: paperId })}
              disabled={deletePaperMutation.isPending}
            >
              {deletePaperMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Yes, Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Question Dialog */}
      <Dialog open={editQuestionOpen} onOpenChange={setEditQuestionOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Edit Question {editingQuestion ? `Q.${editingQuestion.questionNumber}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="eq-text">Question Text</Label>
              <Textarea
                id="eq-text"
                value={editQuestionForm.questionText}
                onChange={(e) =>
                  setEditQuestionForm((f) => ({ ...f, questionText: e.target.value }))
                }
                rows={4}
                placeholder="Enter question text..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(["A", "B", "C", "D"] as const).map((letter) => {
                const key = `option${letter}` as "optionA" | "optionB" | "optionC" | "optionD";
                return (
                  <div key={letter} className="space-y-1.5">
                    <Label htmlFor={`eq-opt${letter}`}>Option {letter}</Label>
                    <Input
                      id={`eq-opt${letter}`}
                      value={editQuestionForm[key]}
                      onChange={(e) =>
                        setEditQuestionForm((f) => ({ ...f, [key]: e.target.value }))
                      }
                      placeholder={`Option ${letter}`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="eq-ans">Correct Answer</Label>
                <select
                  id="eq-ans"
                  value={editQuestionForm.correctAnswer}
                  onChange={(e) =>
                    setEditQuestionForm((f) => ({ ...f, correctAnswer: e.target.value }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">— None —</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eq-subject">Subject</Label>
                <Input
                  id="eq-subject"
                  value={editQuestionForm.subject}
                  onChange={(e) =>
                    setEditQuestionForm((f) => ({ ...f, subject: e.target.value }))
                  }
                  placeholder="e.g. Mathematics"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="eq-note">Note / Explanation</Label>
              <Textarea
                id="eq-note"
                value={editQuestionForm.note}
                onChange={(e) => setEditQuestionForm((f) => ({ ...f, note: e.target.value }))}
                rows={2}
                placeholder="Optional explanation or note..."
              />
            </div>

            <div className="space-y-2">
              <Label>Figure / Image</Label>
              {editQuestionForm.figureData && (
                <div className="rounded-lg border bg-white p-2 mb-2">
                  <img
                    src={editQuestionForm.figureData}
                    alt="Current figure"
                    className="max-h-48 w-full object-contain"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => figureInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4 mr-1.5" />
                  {editQuestionForm.figureData ? "Replace Image" : "Upload Image"}
                </Button>
                {editQuestionForm.figureData && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setEditQuestionForm((f) => ({ ...f, figureData: "" }))}
                  >
                    Remove Image
                  </Button>
                )}
              </div>
              <input
                ref={figureInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFigureUpload}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditQuestionOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editingQuestion) return;
                updateQuestionMutation.mutate({
                  id: editingQuestion.id,
                  data: {
                    questionText: editQuestionForm.questionText || undefined,
                    optionA: editQuestionForm.optionA || null,
                    optionB: editQuestionForm.optionB || null,
                    optionC: editQuestionForm.optionC || null,
                    optionD: editQuestionForm.optionD || null,
                    correctAnswer: editQuestionForm.correctAnswer || null,
                    figureData: editQuestionForm.figureData || null,
                    subject: editQuestionForm.subject || null,
                    note: editQuestionForm.note || null,
                  },
                });
              }}
              disabled={updateQuestionMutation.isPending || !editQuestionForm.questionText}
            >
              {updateQuestionMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Save Question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
