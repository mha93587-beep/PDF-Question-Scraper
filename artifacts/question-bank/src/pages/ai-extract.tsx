import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InlineMath, BlockMath } from "react-katex";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Brain,
  Zap,
  BookOpen,
  Clock,
  RefreshCw,
  FileText,
} from "lucide-react";
import { getListPapersQueryKey, getGetPaperQuestionsQueryKey } from "@workspace/api-client-react";

type Paper = {
  id: number;
  examName: string;
  year: string | null;
  shift: string | null;
  totalQuestions: number;
  fullPdfText: string | null;
  processingStatus: string | null;
  aiExtractionStatus: string | null;
  aiExtractionError: string | null;
  aiExtractionModel: string | null;
};

type SseEvent = {
  stage: string;
  message: string;
  totalQuestions?: number;
  proCount?: number;
  proRefined?: number;
  model?: string;
  questionNumber?: number;
};

type ExtractionState = {
  paperId: number;
  events: SseEvent[];
  stage: "idle" | "running" | "done" | "error";
  totalQuestions?: number;
  model?: string;
};

function renderLatex(text: string) {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  const blockRegex = /\$\$([\s\S]+?)\$\$/g;
  const inlineRegex = /\$((?!\$)[^$]+?)\$/g;

  let lastIndex = 0;
  let fullText = text;

  const segments: { type: "text" | "block" | "inline"; content: string; index: number }[] = [];

  let match: RegExpExecArray | null;
  const blockRe = /\$\$([\s\S]+?)\$\$/g;
  while ((match = blockRe.exec(fullText)) !== null) {
    segments.push({ type: "block", content: match[1], index: match.index });
  }
  const inlineRe = /(?<!\$)\$(?!\$)((?:[^$]|\\\$)+?)(?<!\$)\$(?!\$)/g;
  while ((match = inlineRe.exec(fullText)) !== null) {
    const overlaps = segments.some(
      (s) => s.type === "block" && match!.index >= s.index && match!.index < s.index + s.content.length + 4
    );
    if (!overlaps) {
      segments.push({ type: "inline", content: match[1], index: match.index });
    }
  }

  segments.sort((a, b) => a.index - b.index);

  let cur = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.index > cur) {
      parts.push(<span key={`t-${i}`}>{fullText.slice(cur, seg.index)}</span>);
    }
    const delimLen = seg.type === "block" ? 4 : 2;
    const fullMatchLen = seg.content.length + delimLen;
    if (seg.type === "block") {
      parts.push(
        <span key={`b-${i}`} className="block my-2">
          <BlockMath math={seg.content} />
        </span>
      );
    } else {
      parts.push(
        <InlineMath key={`i-${i}`} math={seg.content} />
      );
    }
    cur = seg.index + fullMatchLen;
  }

  if (cur < fullText.length) {
    parts.push(<span key="tail">{fullText.slice(cur)}</span>);
  }

  return <>{parts}</>;
}

type Question = {
  id: number;
  questionNumber: number;
  questionText: string;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  correctAnswer: string | null;
  subject: string | null;
  note: string | null;
  status: string | null;
};

function QuestionCard({ q }: { q: Question }) {
  const [expanded, setExpanded] = useState(false);
  const options = [
    { key: "A", text: q.optionA },
    { key: "B", text: q.optionB },
    { key: "C", text: q.optionC },
    { key: "D", text: q.optionD },
  ].filter((o) => o.text);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-secondary/30 transition-colors"
      >
        <span className="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
          {q.questionNumber}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-relaxed line-clamp-2">
            {renderLatex(q.questionText)}
          </p>
          <div className="flex gap-2 mt-1.5 flex-wrap">
            {q.subject && (
              <Badge variant="secondary" className="text-xs">{q.subject}</Badge>
            )}
            {q.correctAnswer && (
              <Badge className="text-xs bg-green-100 text-green-800 border-green-200">
                Ans: {q.correctAnswer}
              </Badge>
            )}
            {q.status === "ai_extracted" && (
              <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-200">
                <Sparkles className="w-2.5 h-2.5 mr-1" />AI
              </Badge>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border bg-secondary/10">
          <div className="pt-3 text-sm leading-relaxed">
            {renderLatex(q.questionText)}
          </div>

          {options.length > 0 && (
            <div className="grid grid-cols-1 gap-1.5">
              {options.map((opt) => (
                <div
                  key={opt.key}
                  className={`flex items-start gap-2 px-3 py-2 rounded-md text-sm ${
                    q.correctAnswer === opt.key
                      ? "bg-green-50 border border-green-200 text-green-900"
                      : "bg-background border border-border"
                  }`}
                >
                  <span className={`font-bold shrink-0 ${q.correctAnswer === opt.key ? "text-green-700" : "text-muted-foreground"}`}>
                    {opt.key}.
                  </span>
                  <span className="leading-relaxed">{renderLatex(opt.text!)}</span>
                  {q.correctAnswer === opt.key && (
                    <CheckCircle2 className="w-4 h-4 text-green-600 ml-auto shrink-0 mt-0.5" />
                  )}
                </div>
              ))}
            </div>
          )}

          {q.note && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
              <p className="text-xs font-semibold text-blue-700 mb-1.5 flex items-center gap-1">
                <BookOpen className="w-3 h-3" /> Explanation
              </p>
              <p className="text-sm text-blue-900 leading-relaxed">
                {renderLatex(q.note)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaperExtractionRow({
  paper,
  onExtract,
  extractionState,
}: {
  paper: Paper;
  onExtract: (paperId: number) => void;
  extractionState: ExtractionState | null;
}) {
  const isRunning = extractionState?.stage === "running";
  const isDone = extractionState?.stage === "done" || paper.aiExtractionStatus === "done";
  const isError = extractionState?.stage === "error" || paper.aiExtractionStatus === "error";

  const [showQuestions, setShowQuestions] = useState(false);
  const { data: questions } = useQuery<Question[]>({
    queryKey: getGetPaperQuestionsQueryKey(paper.id),
    queryFn: () => fetch(`/api/papers/${paper.id}/questions`).then((r) => r.json()),
    enabled: showQuestions,
  });

  const hasText = paper.fullPdfText && paper.fullPdfText.trim().length > 100;
  const latestEvent = extractionState?.events[extractionState.events.length - 1];
  const aiExtractedCount = questions?.filter((q) => q.status === "ai_extracted").length ?? 0;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-4 p-5">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{paper.examName}</span>
            {paper.year && <span className="text-muted-foreground text-sm">({paper.year})</span>}
            {paper.shift && <Badge variant="outline" className="text-xs">{paper.shift}</Badge>}
          </div>
          <div className="flex gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span>{paper.totalQuestions} questions</span>
            {paper.aiExtractionModel && (
              <span className="text-purple-600 flex items-center gap-0.5">
                <Sparkles className="w-3 h-3" />{paper.aiExtractionModel}
              </span>
            )}
            {!hasText && (
              <span className="text-amber-600">⚠ Text not available — run standard extraction first</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(isDone || paper.aiExtractionStatus === "done") && !isRunning && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowQuestions((p) => !p)}
              className="text-xs"
            >
              {showQuestions ? "Hide" : "Preview"} Questions
            </Button>
          )}
          <Button
            size="sm"
            disabled={!hasText || isRunning}
            onClick={() => onExtract(paper.id)}
            className={`gap-1.5 ${isDone || paper.aiExtractionStatus === "done" ? "variant-outline" : ""}`}
            variant={isDone || paper.aiExtractionStatus === "done" ? "outline" : "default"}
          >
            {isRunning ? (
              <><Loader2 className="w-3 h-3 animate-spin" />Processing...</>
            ) : isDone || paper.aiExtractionStatus === "done" ? (
              <><RefreshCw className="w-3 h-3" />Re-extract</>
            ) : (
              <><Sparkles className="w-3 h-3" />AI Extract</>
            )}
          </Button>
        </div>
      </div>

      {isRunning && extractionState && (
        <div className="border-t border-border bg-secondary/10 px-5 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground">
              {latestEvent?.message ?? "Processing..."}
            </span>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {extractionState.events.slice(-5).map((e, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {e.stage === "pro_refine" && <Brain className="w-3 h-3 inline mr-1 text-purple-500" />}
                {e.stage === "flash_extract" && <Zap className="w-3 h-3 inline mr-1 text-yellow-500" />}
                {e.message}
              </p>
            ))}
          </div>
        </div>
      )}

      {(extractionState?.stage === "done") && (
        <div className="border-t border-border bg-green-50 px-5 py-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-800">
            {extractionState.totalQuestions} questions extracted
            {extractionState.model && ` using ${extractionState.model}`}
          </span>
        </div>
      )}

      {(extractionState?.stage === "error" || (isError && !extractionState)) && (
        <div className="border-t border-border bg-red-50 px-5 py-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span className="text-sm text-red-800">
            {extractionState?.events.find((e) => e.stage === "error")?.message ??
              paper.aiExtractionError ??
              "Extraction failed"}
          </span>
        </div>
      )}

      {showQuestions && questions && questions.length > 0 && (
        <div className="border-t border-border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">
              AI Extracted Questions ({aiExtractedCount > 0 ? `${aiExtractedCount} AI` : questions.length} shown)
            </h3>
            <Badge variant="secondary" className="text-xs">
              {questions.length} total
            </Badge>
          </div>
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {questions.map((q) => (
              <QuestionCard key={q.id} q={q} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AiExtractPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [extractionStates, setExtractionStates] = useState<Map<number, ExtractionState>>(new Map());
  const sseRefs = useRef<Map<number, EventSource>>(new Map());

  const { data: papers, isLoading } = useQuery<Paper[]>({
    queryKey: getListPapersQueryKey(),
    queryFn: () => fetch("/api/papers").then((r) => r.json()),
  });

  useEffect(() => {
    return () => {
      sseRefs.current.forEach((es) => es.close());
    };
  }, []);

  function startExtraction(paperId: number) {
    if (sseRefs.current.has(paperId)) {
      sseRefs.current.get(paperId)!.close();
      sseRefs.current.delete(paperId);
    }

    setExtractionStates((prev) => {
      const next = new Map(prev);
      next.set(paperId, { paperId, events: [], stage: "running" });
      return next;
    });

    const eventSource = new EventSource(`/api/ai-extract/papers/${paperId}`);
    sseRefs.current.set(paperId, eventSource);

    eventSource.onmessage = (e) => {
      try {
        const event: SseEvent = JSON.parse(e.data);
        setExtractionStates((prev) => {
          const next = new Map(prev);
          const cur = next.get(paperId) ?? { paperId, events: [], stage: "running" as const };
          const newEvents = [...cur.events, event];

          if (event.stage === "done") {
            next.set(paperId, {
              ...cur,
              events: newEvents,
              stage: "done",
              totalQuestions: event.totalQuestions,
              model: event.model,
            });
            eventSource.close();
            sseRefs.current.delete(paperId);
            queryClient.invalidateQueries({ queryKey: getListPapersQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetPaperQuestionsQueryKey(paperId) });
            toast({
              title: "AI Extraction Complete!",
              description: `${event.totalQuestions} questions extract ho gaye.`,
            });
          } else if (event.stage === "error") {
            next.set(paperId, { ...cur, events: newEvents, stage: "error" });
            eventSource.close();
            sseRefs.current.delete(paperId);
            toast({
              title: "AI Extraction Failed",
              description: event.message,
              variant: "destructive",
            });
          } else {
            next.set(paperId, { ...cur, events: newEvents, stage: "running" });
          }

          return next;
        });
      } catch {}
    };

    eventSource.onerror = () => {
      setExtractionStates((prev) => {
        const next = new Map(prev);
        const cur = next.get(paperId);
        if (cur && cur.stage === "running") {
          next.set(paperId, { ...cur, stage: "error" });
        }
        return next;
      });
      eventSource.close();
      sseRefs.current.delete(paperId);
    };
  }

  const papersWithText = papers?.filter((p) => p.fullPdfText && p.fullPdfText.trim().length > 100) ?? [];
  const papersWithoutText = papers?.filter((p) => !p.fullPdfText || p.fullPdfText.trim().length <= 100) ?? [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="w-7 h-7 text-primary" />
          AI Extract
        </h1>
        <p className="text-muted-foreground text-lg">
          Gemini AI se questions extract karein — LaTeX math, clean text, aur detailed explanations ke saath.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-5 flex items-start gap-3">
            <Zap className="w-8 h-8 text-yellow-600 shrink-0" />
            <div>
              <p className="font-semibold text-yellow-900">Gemini 2.5 Flash</p>
              <p className="text-xs text-yellow-700 mt-0.5">Saare questions ke liye — fast aur accurate</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50">
          <CardContent className="pt-5 flex items-start gap-3">
            <Brain className="w-8 h-8 text-purple-600 shrink-0" />
            <div>
              <p className="font-semibold text-purple-900">Gemini 2.5 Pro</p>
              <p className="text-xs text-purple-700 mt-0.5">Complex math / diagrams wale questions ke liye</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-5 flex items-start gap-3">
            <BookOpen className="w-8 h-8 text-blue-600 shrink-0" />
            <div>
              <p className="font-semibold text-blue-900">LaTeX Rendering</p>
              <p className="text-xs text-blue-700 mt-0.5">Math formulas perfectly rendered</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {papersWithText.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Ready for AI Extraction</h2>
                <Badge className="bg-green-100 text-green-800 border-green-200">
                  {papersWithText.length} papers
                </Badge>
              </div>
              <div className="space-y-3">
                {papersWithText.map((paper) => (
                  <PaperExtractionRow
                    key={paper.id}
                    paper={paper}
                    onExtract={startExtraction}
                    extractionState={extractionStates.get(paper.id) ?? null}
                  />
                ))}
              </div>
            </div>
          )}

          {papersWithoutText.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-muted-foreground">Need Standard Extraction First</h2>
                <Badge variant="outline">{papersWithoutText.length} papers</Badge>
              </div>
              <div className="space-y-3">
                {papersWithoutText.map((paper) => (
                  <PaperExtractionRow
                    key={paper.id}
                    paper={paper}
                    onExtract={startExtraction}
                    extractionState={extractionStates.get(paper.id) ?? null}
                  />
                ))}
              </div>
            </div>
          )}

          {(!papers || papers.length === 0) && (
            <Card className="text-center py-16">
              <CardContent>
                <Sparkles className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-lg font-semibold">Koi paper nahi mila</p>
                <p className="text-muted-foreground text-sm mt-1">
                  Pehle "Upload Paper" se ek PDF upload karein.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
