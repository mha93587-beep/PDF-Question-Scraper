import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InlineMath, BlockMath } from "react-katex";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronRight,
  Brain, Zap, BookOpen, RefreshCw, FileText, Upload, FileArchive,
  Clock, XCircle, ListChecks, ScanText, BrainCircuit,
} from "lucide-react";
import { getListPapersQueryKey, getGetPaperQuestionsQueryKey } from "@workspace/api-client-react";

const LS_SINGLE = "qb_ai_single_papers";
const LS_BATCH = "qb_ai_batch_job";

function lsGet<T>(key: string, def: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function lsSet(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function lsRemove(key: string) {
  try { localStorage.removeItem(key); } catch {}
}

function renderLatex(text: string) {
  if (!text) return null;
  const segments: { type: "text" | "block" | "inline"; content: string; index: number; len: number }[] = [];
  const blockRe = /\$\$([\s\S]+?)\$\$/g;
  const inlineRe = /\$([^$\n]+?)\$/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) segments.push({ type: "block", content: m[1], index: m.index, len: m[0].length });
  const blockRanges = segments.map((s) => [s.index, s.index + s.len] as [number, number]);
  while ((m = inlineRe.exec(text)) !== null) {
    const overlaps = blockRanges.some(([a, b]) => m!.index >= a && m!.index < b);
    if (!overlaps) segments.push({ type: "inline", content: m[1], index: m.index, len: m[0].length });
  }
  segments.sort((a, b) => a.index - b.index);
  const parts: React.ReactNode[] = [];
  let cur = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.index > cur) parts.push(<span key={`t${i}`}>{text.slice(cur, s.index)}</span>);
    if (s.type === "block") {
      parts.push(<span key={`b${i}`} className="block my-2"><BlockMath math={s.content} /></span>);
    } else {
      parts.push(<InlineMath key={`i${i}`} math={s.content} />);
    }
    cur = s.index + s.len;
  }
  if (cur < text.length) parts.push(<span key="tail">{text.slice(cur)}</span>);
  return <>{parts}</>;
}

type Question = {
  id: number; questionNumber: number; questionText: string;
  optionA: string | null; optionB: string | null; optionC: string | null; optionD: string | null;
  correctAnswer: string | null; subject: string | null; note: string | null; status: string | null;
};

function QuestionCard({ q }: { q: Question }) {
  const [open, setOpen] = useState(false);
  const opts = [
    { k: "A", v: q.optionA }, { k: "B", v: q.optionB },
    { k: "C", v: q.optionC }, { k: "D", v: q.optionD },
  ].filter((o) => o.v);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button onClick={() => setOpen((p) => !p)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-secondary/30 transition-colors">
        <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">{q.questionNumber}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-relaxed line-clamp-2">{renderLatex(q.questionText)}</p>
          <div className="flex gap-1.5 mt-1 flex-wrap">
            {q.subject && <Badge variant="secondary" className="text-xs">{q.subject}</Badge>}
            {q.correctAnswer && <Badge className="text-xs bg-green-100 text-green-800 border-green-200">Ans: {q.correctAnswer}</Badge>}
            {q.status === "ai_extracted" && <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-200"><Sparkles className="w-2.5 h-2.5 mr-1" />AI</Badge>}
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border bg-secondary/10">
          <div className="pt-2 text-sm leading-relaxed">{renderLatex(q.questionText)}</div>
          {opts.length > 0 && (
            <div className="space-y-1">
              {opts.map((opt) => (
                <div key={opt.k} className={`flex gap-2 px-2.5 py-1.5 rounded text-sm ${q.correctAnswer === opt.k ? "bg-green-50 border border-green-200 text-green-900" : "bg-background border border-border"}`}>
                  <span className={`font-bold shrink-0 ${q.correctAnswer === opt.k ? "text-green-700" : "text-muted-foreground"}`}>{opt.k}.</span>
                  <span>{renderLatex(opt.v!)}</span>
                  {q.correctAnswer === opt.k && <CheckCircle2 className="w-3.5 h-3.5 text-green-600 ml-auto shrink-0 mt-0.5" />}
                </div>
              ))}
            </div>
          )}
          {q.note && (
            <div className="bg-blue-50 border border-blue-200 rounded p-2.5">
              <p className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1"><BookOpen className="w-3 h-3" />Explanation</p>
              <p className="text-sm text-blue-900 leading-relaxed">{renderLatex(q.note)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type SseEvent = { stage: string; message: string; totalQuestions?: number; model?: string; proCount?: number; proRefined?: number; questionNumber?: number };
type SingleState = {
  paperId: number; examName: string;
  phase: "standard" | "ai" | "done" | "error";
  standardStage?: string; standardDone?: boolean;
  aiEvents: SseEvent[]; aiStage?: string;
  totalQuestions?: number; model?: string; error?: string;
};

type BatchItemType = {
  id: number; fileName: string; status: string;
  processingStage: string | null; questionsExtracted: number;
  aiExtractionStatus: string | null; error: string | null; paperId: number | null;
};
type BatchJob = {
  id: number; status: string; zipFileName: string | null;
  totalFiles: number; processedFiles: number; failedFiles: number;
  error: string | null; createdAt: string; items: BatchItemType[];
};

const STD_STAGE_LABELS: Record<string, string> = {
  extracting_text: "Reading PDF",
  pdftotext: "pdftotext",
  pdf_parse: "pdf-parse",
  ocr: "OCR (slow)",
  parsing_questions: "Parsing Q's",
  uploading_figures: "Uploading figures",
  extracting: "Reading ZIP",
  ai_extracting: "AI Extraction",
};

function formatTime(s: number) { return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; }

function SingleStatusRow({ state, onRetryAi, onRemove }: {
  state: SingleState;
  onRetryAi: (paperId: number) => void;
  onRemove: (paperId: number) => void;
}) {
  const [showQs, setShowQs] = useState(false);
  const { data: questions } = useQuery<Question[]>({
    queryKey: getGetPaperQuestionsQueryKey(state.paperId),
    queryFn: () => fetch(`/api/papers/${state.paperId}/questions`).then((r) => r.json()),
    enabled: showQs,
  });

  const latestAiEvent = state.aiEvents[state.aiEvents.length - 1];

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          {state.phase === "done" ? <CheckCircle2 className="w-5 h-5 text-green-600" /> :
           state.phase === "error" ? <AlertCircle className="w-5 h-5 text-red-500" /> :
           <Loader2 className="w-5 h-5 text-primary animate-spin" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate">{state.examName}</p>
          <div className="flex gap-2 mt-0.5 flex-wrap items-center text-xs text-muted-foreground">
            {state.phase === "standard" && (
              <span className="text-blue-600 flex items-center gap-0.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Standard extraction: {STD_STAGE_LABELS[state.standardStage ?? ""] ?? state.standardStage ?? "Processing..."}
              </span>
            )}
            {state.phase === "ai" && (
              <span className="text-purple-600 flex items-center gap-0.5">
                <Sparkles className="w-3 h-3" />
                AI: {latestAiEvent?.message ?? "Processing..."}
              </span>
            )}
            {state.phase === "done" && <span className="text-green-700">{state.totalQuestions} questions extracted • {state.model}</span>}
            {state.phase === "error" && <span className="text-red-600 truncate">{state.error}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {state.phase === "done" && (
            <Button variant="ghost" size="sm" onClick={() => setShowQs((p) => !p)} className="text-xs">
              {showQs ? "Hide" : "Preview"}
            </Button>
          )}
          {state.phase === "error" && (
            <Button variant="outline" size="sm" onClick={() => onRetryAi(state.paperId)} className="text-xs gap-1">
              <RefreshCw className="w-3 h-3" />Retry AI
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onRemove(state.paperId)} className="text-xs text-muted-foreground">✕</Button>
        </div>
      </div>

      {state.phase === "ai" && state.aiEvents.length > 0 && (
        <div className="border-t border-border bg-purple-50/50 px-4 py-2 space-y-0.5">
          {state.aiEvents.slice(-3).map((e, i) => (
            <p key={i} className="text-xs text-purple-800">
              {e.stage === "pro_refine" && <Brain className="w-3 h-3 inline mr-1 text-purple-500" />}
              {e.stage === "flash_extract" && <Zap className="w-3 h-3 inline mr-1 text-yellow-500" />}
              {e.message}
            </p>
          ))}
        </div>
      )}

      {showQs && questions && questions.length > 0 && (
        <div className="border-t border-border p-4 space-y-2">
          <p className="text-sm font-semibold">{questions.length} Questions</p>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {questions.map((q) => <QuestionCard key={q.id} q={q} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function BatchItemRow({ item }: { item: BatchItemType }) {
  const getIcon = () => {
    if (item.status === "processing" || item.aiExtractionStatus === "processing") return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    if (item.status === "done" && item.aiExtractionStatus === "done") return <Sparkles className="w-4 h-4 text-purple-500" />;
    if (item.status === "done") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (item.status === "error") return <XCircle className="w-4 h-4 text-red-500" />;
    return <Clock className="w-4 h-4 text-muted-foreground" />;
  };
  const stage = item.processingStage ? STD_STAGE_LABELS[item.processingStage] ?? item.processingStage : null;
  const isOcr = item.processingStage === "ocr";

  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm border ${
      item.status === "processing" ? "bg-blue-50/50 border-blue-100" :
      item.status === "done" && item.aiExtractionStatus === "done" ? "bg-purple-50/30 border-purple-100" :
      item.status === "done" ? "bg-green-50/30 border-green-100" :
      item.status === "error" ? "bg-red-50/30 border-red-100" : "bg-background border-border"
    }`}>
      <div className="shrink-0">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{item.fileName}</p>
        {item.status === "processing" && stage && (
          <p className={`text-xs mt-0.5 ${isOcr ? "text-amber-600" : "text-blue-600"}`}>
            {isOcr ? "⏳ " : ""}{stage}{isOcr ? " — 3–8 min" : "..."}
          </p>
        )}
        {item.status === "error" && item.error && <p className="text-xs text-red-600 truncate">{item.error}</p>}
      </div>
      <div className="shrink-0">
        {item.status === "done" && (
          <Badge variant="secondary" className={`text-xs ${item.aiExtractionStatus === "done" ? "bg-purple-100 text-purple-700 border-purple-200" : "bg-green-100 text-green-700 border-green-200"}`}>
            {item.questionsExtracted} Qs{item.aiExtractionStatus === "done" ? " ✦AI" : ""}
          </Badge>
        )}
        {item.status === "pending" && <span className="text-xs text-muted-foreground">Waiting</span>}
      </div>
    </div>
  );
}

function BatchStatusCard({ job, elapsed }: { job: BatchJob; elapsed: number }) {
  const [expanded, setExpanded] = useState(true);
  const isActive = job.status === "processing" || job.status === "downloading";
  const pct = job.totalFiles > 0 ? Math.round(((job.processedFiles + job.failedFiles) / job.totalFiles) * 100) : 0;
  const totalQs = job.items.reduce((s, i) => s + i.questionsExtracted, 0);
  const aiDone = job.items.filter((i) => i.aiExtractionStatus === "done").length;

  return (
    <Card className={`${isActive ? "border-blue-200" : job.status === "done" ? "border-green-200" : job.status === "error" ? "border-red-200" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <FileArchive className={`w-5 h-5 shrink-0 ${isActive ? "text-blue-500" : job.status === "done" ? "text-green-500" : job.status === "error" ? "text-red-500" : "text-muted-foreground"}`} />
            <div className="min-w-0">
              <p className="font-semibold truncate">{job.zipFileName || `AI Batch #${job.id}`}</p>
              <p className="text-xs text-muted-foreground">{job.items.length || job.totalFiles} PDFs</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className={`${isActive ? "bg-blue-100 text-blue-700 border-blue-200 animate-pulse" : job.status === "done" ? "bg-green-100 text-green-700" : job.status === "error" ? "bg-red-100 text-red-700" : ""}`}>
              {isActive && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              {job.status === "done" && <CheckCircle2 className="w-3 h-3 mr-1" />}
              {job.status === "done" ? "Complete" : job.status === "downloading" ? "Downloading" : job.status === "processing" ? "Processing" : job.status === "error" ? "Failed" : "Pending"}
            </Badge>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpanded((p) => !p)}>
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {isActive && (
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{job.processedFiles + job.failedFiles} / {job.totalFiles} files</span>
              <span>{formatTime(elapsed)}</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
        )}

        {job.status === "done" && (
          <div className="flex gap-4 text-sm mt-1">
            <span className="text-green-700">{job.processedFiles} succeeded</span>
            {job.failedFiles > 0 && <span className="text-red-600">{job.failedFiles} failed</span>}
            <span className="text-muted-foreground">{totalQs} questions</span>
            {aiDone > 0 && <span className="text-purple-700 flex items-center gap-0.5"><Sparkles className="w-3 h-3" />{aiDone} AI extracted</span>}
          </div>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {job.items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Reading ZIP...</p>
            ) : (
              job.items.map((item) => <BatchItemRow key={item.id} item={item} />)
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

type TabType = "single" | "zip";

export default function AiExtractPage() {
  const [tab, setTab] = useState<TabType>("single");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [examName, setExamName] = useState("");
  const [year, setYear] = useState("");
  const [shift, setShift] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const [zipFile, setZipFile] = useState<File | null>(null);
  const [isZipUploading, setIsZipUploading] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  const [singleStates, setSingleStates] = useState<SingleState[]>(() =>
    lsGet<SingleState[]>(LS_SINGLE, []).map((s) => ({ ...s, aiEvents: [] }))
  );
  const [activeBatchJobId, setActiveBatchJobId] = useState<number | null>(() => lsGet<number | null>(LS_BATCH, null));
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null);
  const [batchElapsed, setBatchElapsed] = useState(0);

  const sseRefs = useRef<Map<number, EventSource>>(new Map());
  const pollRefs = useRef<Map<number, ReturnType<typeof setInterval>>>(new Map());
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: allPapers } = useQuery<any[]>({
    queryKey: getListPapersQueryKey(),
    queryFn: () => fetch("/api/papers").then((r) => r.json()),
  });

  const persistSingle = useCallback((states: SingleState[]) => {
    const toSave = states.filter((s) => s.phase !== "done" || s.totalQuestions).map(({ aiEvents: _, ...rest }) => rest);
    lsSet(LS_SINGLE, toSave);
  }, []);

  const updateSingle = useCallback((paperId: number, updater: (s: SingleState) => SingleState) => {
    setSingleStates((prev) => {
      const next = prev.map((s) => s.paperId === paperId ? updater(s) : s);
      persistSingle(next);
      return next;
    });
  }, [persistSingle]);

  const startSseAi = useCallback((paperId: number) => {
    if (sseRefs.current.has(paperId)) {
      sseRefs.current.get(paperId)!.close();
      sseRefs.current.delete(paperId);
    }
    updateSingle(paperId, (s) => ({ ...s, phase: "ai", aiEvents: [] }));

    const es = new EventSource(`/api/ai-extract/papers/${paperId}`);
    sseRefs.current.set(paperId, es);

    es.onmessage = (e) => {
      try {
        const event: SseEvent = JSON.parse(e.data);
        updateSingle(paperId, (s) => {
          const aiEvents = [...s.aiEvents, event];
          if (event.stage === "done") {
            es.close();
            sseRefs.current.delete(paperId);
            queryClient.invalidateQueries({ queryKey: getListPapersQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetPaperQuestionsQueryKey(paperId) });
            toast({ title: "AI Extraction Complete!", description: `${event.totalQuestions} questions extract ho gaye.` });
            return { ...s, phase: "done", aiEvents, totalQuestions: event.totalQuestions, model: event.model };
          }
          if (event.stage === "error") {
            es.close();
            sseRefs.current.delete(paperId);
            toast({ title: "AI Extraction Failed", description: event.message, variant: "destructive" });
            return { ...s, phase: "error", aiEvents, error: event.message };
          }
          return { ...s, aiEvents };
        });
      } catch {}
    };

    es.onerror = () => {
      es.close();
      sseRefs.current.delete(paperId);
      updateSingle(paperId, (s) =>
        s.phase === "ai" ? { ...s, phase: "error", error: "Connection lost. Click retry to re-run." } : s
      );
    };
  }, [updateSingle, queryClient, toast]);

  const startStandardPoll = useCallback((paperId: number) => {
    if (pollRefs.current.has(paperId)) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/papers/${paperId}`);
        if (!res.ok) return;
        const paper = await res.json();
        if (paper.processingStatus === "done") {
          clearInterval(pollRefs.current.get(paperId)!);
          pollRefs.current.delete(paperId);
          updateSingle(paperId, (s) => ({ ...s, standardDone: true }));
          startSseAi(paperId);
        } else if (paper.processingStatus === "error") {
          clearInterval(pollRefs.current.get(paperId)!);
          pollRefs.current.delete(paperId);
          updateSingle(paperId, (s) => ({ ...s, phase: "error", error: paper.processingError ?? "Standard extraction failed." }));
        } else {
          updateSingle(paperId, (s) => ({ ...s, standardStage: paper.processingStage ?? s.standardStage }));
        }
      } catch {}
    };
    const iv = setInterval(poll, 2500);
    pollRefs.current.set(paperId, iv);
    poll();
  }, [updateSingle, startSseAi]);

  useEffect(() => {
    for (const state of singleStates) {
      if (state.phase === "standard" && !pollRefs.current.has(state.paperId)) {
        startStandardPoll(state.paperId);
      }
      if (state.phase === "ai" && !sseRefs.current.has(state.paperId)) {
        const checkAi = async () => {
          try {
            const res = await fetch(`/api/papers/${state.paperId}`);
            const paper = await res.json();
            if (paper.aiExtractionStatus === "done") {
              updateSingle(state.paperId, (s) => ({
                ...s, phase: "done", totalQuestions: paper.totalQuestions, model: paper.aiExtractionModel,
              }));
            } else if (paper.aiExtractionStatus === "error") {
              updateSingle(state.paperId, (s) => ({ ...s, phase: "error", error: paper.aiExtractionError }));
            } else if (paper.aiExtractionStatus === "processing") {
              startSseAi(state.paperId);
            } else {
              startSseAi(state.paperId);
            }
          } catch {}
        };
        checkAi();
      }
    }
    return () => {
      sseRefs.current.forEach((es) => es.close());
      pollRefs.current.forEach((iv) => clearInterval(iv));
    };
  }, []);

  useEffect(() => {
    if (!activeBatchJobId) { setBatchJob(null); return; }
    lsSet(LS_BATCH, activeBatchJobId);
    const startTime = Date.now();
    const poll = async () => {
      try {
        const res = await fetch(`/api/batch/${activeBatchJobId}`);
        if (!res.ok) return;
        const data: BatchJob = await res.json();
        setBatchJob(data);
        if (data.status === "done" || data.status === "error") {
          clearInterval(batchPollRef.current!);
          clearInterval(batchTimerRef.current!);
          lsRemove(LS_BATCH);
          setActiveBatchJobId(null);
          if (data.status === "done") {
            const totalQs = data.items.reduce((s, i) => s + i.questionsExtracted, 0);
            toast({ title: "AI Batch Complete!", description: `${data.processedFiles} PDFs processed, ${totalQs} questions extracted.` });
            queryClient.invalidateQueries({ queryKey: getListPapersQueryKey() });
          } else {
            toast({ title: "Batch Failed", description: data.error ?? "Unknown error", variant: "destructive" });
          }
        }
      } catch {}
    };
    batchPollRef.current = setInterval(poll, 2500);
    batchTimerRef.current = setInterval(() => setBatchElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    poll();
    return () => {
      clearInterval(batchPollRef.current!);
      clearInterval(batchTimerRef.current!);
    };
  }, [activeBatchJobId]);

  const handleSingleUpload = async () => {
    if (!file || !examName) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("examName", examName);
      if (year) fd.append("year", year);
      if (shift) fd.append("shift", shift);

      const res = await fetch("/api/ai-extract/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const { paperId } = await res.json();

      const newState: SingleState = {
        paperId, examName: `${examName}${year ? ` ${year}` : ""}${shift ? ` ${shift}` : ""}`,
        phase: "standard", aiEvents: [],
      };
      setSingleStates((prev) => {
        const next = [newState, ...prev.filter((s) => s.paperId !== paperId)];
        persistSingle(next);
        return next;
      });

      setFile(null); setExamName(""); setYear(""); setShift("");
      toast({ title: "PDF Uploaded!", description: "Standard extraction shuru ho gayi, phir AI extraction automatic chalegi." });
      startStandardPoll(paperId);
    } catch (err: any) {
      toast({ title: "Upload Failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleZipUpload = async () => {
    if (!zipFile) return;
    setIsZipUploading(true);
    setZipProgress(0);
    try {
      const urlRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: zipFile.name, size: zipFile.size, contentType: "application/zip" }),
      });
      if (!urlRes.ok) throw new Error("Failed to get upload URL. Check B2 storage configuration.");
      const { uploadURL, objectPath } = await urlRes.json();

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setZipProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.open("PUT", uploadURL);
        xhr.setRequestHeader("Content-Type", "application/zip");
        xhr.send(zipFile);
      });

      const batchRes = await fetch("/api/ai-extract/batch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zipObjectPath: objectPath, zipFileName: zipFile.name }),
      });
      if (!batchRes.ok) throw new Error("Failed to start AI batch job");
      const { jobId } = await batchRes.json();

      setZipFile(null); setZipProgress(0);
      setActiveBatchJobId(jobId);
      toast({ title: "AI Batch Started!", description: `Processing ${zipFile.name} with AI extraction.` });
    } catch (err: any) {
      toast({ title: "ZIP Upload Failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsZipUploading(false);
    }
  };

  const removeSingle = (paperId: number) => {
    sseRefs.current.get(paperId)?.close();
    pollRefs.current.get(paperId) && clearInterval(pollRefs.current.get(paperId)!);
    setSingleStates((prev) => {
      const next = prev.filter((s) => s.paperId !== paperId);
      persistSingle(next);
      return next;
    });
  };

  const existingPapers = allPapers?.filter((p) =>
    !singleStates.some((s) => s.paperId === p.id)
  ) ?? [];

  const isZipBusy = isZipUploading || !!activeBatchJobId;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="w-7 h-7 text-primary" /> AI Extract
        </h1>
        <p className="text-muted-foreground mt-1">
          PDF upload karein — Gemini AI automatically standard extraction ke baad LaTeX math, clean text aur detailed explanations ke saath questions extract karega.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Zap, label: "Gemini 2.5 Flash", desc: "Saare questions ke liye", color: "yellow" },
          { icon: Brain, label: "Gemini 2.5 Pro", desc: "Complex math/diagrams ke liye", color: "purple" },
          { icon: BookOpen, label: "LaTeX Rendering", desc: "Math perfectly rendered", color: "blue" },
        ].map(({ icon: Icon, label, desc, color }) => (
          <Card key={label} className={`border-${color}-200 bg-${color}-50`}>
            <CardContent className="pt-4 flex items-start gap-2.5">
              <Icon className={`w-6 h-6 text-${color}-600 shrink-0`} />
              <div>
                <p className={`font-semibold text-${color}-900 text-sm`}>{label}</p>
                <p className={`text-xs text-${color}-700 mt-0.5`}>{desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-0">
          <div className="flex gap-1 border-b border-border">
            <button
              onClick={() => setTab("single")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === "single" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <FileText className="w-4 h-4" /> Single PDF
            </button>
            <button
              onClick={() => setTab("zip")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === "zip" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <FileArchive className="w-4 h-4" /> ZIP Batch <Badge variant="secondary" className="text-xs ml-1">100+ PDFs</Badge>
            </button>
          </div>
        </CardHeader>

        <CardContent className="pt-5">
          {tab === "single" && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                <input id="ai-single-file" type="file" accept=".pdf" className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={isUploading} />
                <label htmlFor="ai-single-file" className={`cursor-pointer flex flex-col items-center gap-2 ${isUploading ? "opacity-50 cursor-not-allowed" : ""}`}>
                  {file ? (
                    <><FileText className="w-10 h-10 text-primary" /><span className="font-medium">{file.name}</span><span className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</span></>
                  ) : (
                    <><Upload className="w-10 h-10 text-muted-foreground" /><span className="text-muted-foreground">Click to select a PDF</span><span className="text-xs text-muted-foreground">Max 50 MB</span></>
                  )}
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="ai-exam">Exam Name *</Label>
                  <Input id="ai-exam" placeholder="e.g. RRB NTPC CBT-I 2025" value={examName}
                    onChange={(e) => setExamName(e.target.value)} disabled={isUploading} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ai-year">Year</Label>
                  <Input id="ai-year" placeholder="e.g. 2025" value={year}
                    onChange={(e) => setYear(e.target.value)} disabled={isUploading} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ai-shift">Shift</Label>
                  <Input id="ai-shift" placeholder="e.g. Shift 1" value={shift}
                    onChange={(e) => setShift(e.target.value)} disabled={isUploading} />
                </div>
              </div>
              <Button onClick={handleSingleUpload} disabled={!file || !examName || isUploading} className="w-full" size="lg">
                {isUploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading...</> : <><Sparkles className="w-4 h-4 mr-2" />Upload aur AI Extract Karein</>}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                PDF upload hogi → standard text extraction → phir automatic AI extraction with LaTeX
              </p>
            </div>
          )}

          {tab === "zip" && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                <input id="ai-zip-file" type="file" accept=".zip" className="hidden"
                  onChange={(e) => setZipFile(e.target.files?.[0] || null)} disabled={isZipBusy} />
                <label htmlFor="ai-zip-file" className={`cursor-pointer flex flex-col items-center gap-2 ${isZipBusy ? "opacity-50 cursor-not-allowed" : ""}`}>
                  {zipFile ? (
                    <><FileArchive className="w-10 h-10 text-primary" /><span className="font-medium">{zipFile.name}</span><span className="text-xs text-muted-foreground">{(zipFile.size / 1024 / 1024).toFixed(1)} MB</span><Badge variant="secondary">ZIP ready</Badge></>
                  ) : (
                    <><FileArchive className="w-10 h-10 text-muted-foreground" /><span className="text-muted-foreground font-medium">Click to select a ZIP file</span><span className="text-xs text-muted-foreground">Up to 100 PDFs, 1 GB ZIP — Direct B2 upload (server overload nahi hogi)</span></>
                  )}
                </label>
              </div>

              {isZipUploading && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Backblaze B2 par upload ho raha hai...</span>
                    <span className="font-medium">{zipProgress}%</span>
                  </div>
                  <Progress value={zipProgress} className="h-2.5" />
                </div>
              )}

              <Button onClick={handleZipUpload} disabled={!zipFile || isZipBusy} className="w-full" size="lg">
                {isZipUploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading... {zipProgress}%</> :
                 isZipBusy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing in background...</> :
                 <><Upload className="w-4 h-4 mr-2" />ZIP Upload aur AI Batch Karein</>}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                ZIP → B2 → har PDF: standard extraction + Gemini AI extraction with LaTeX
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {(singleStates.length > 0 || batchJob) && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Active &amp; Recent Extractions</h2>
          <p className="text-sm text-muted-foreground -mt-2">Browser refresh ke baad bhi status yahan dikhega.</p>

          {batchJob && <BatchStatusCard job={batchJob} elapsed={batchElapsed} />}

          {singleStates.length > 0 && (
            <div className="space-y-3">
              {singleStates.map((state) => (
                <SingleStatusRow
                  key={state.paperId}
                  state={state}
                  onRetryAi={startSseAi}
                  onRemove={removeSingle}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {existingPapers.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Existing Papers — Re-Extract</h2>
            <Badge variant="secondary">{existingPapers.length} papers</Badge>
          </div>
          <div className="space-y-2">
            {existingPapers.map((paper) => (
              <ExistingPaperRow
                key={paper.id}
                paper={paper}
                onExtract={(id) => startSseAi(id)}
                onExtractWithStatus={(id, examName) => {
                  const newState: SingleState = { paperId: id, examName, phase: "ai", aiEvents: [] };
                  setSingleStates((prev) => {
                    const next = [newState, ...prev.filter((s) => s.paperId !== id)];
                    persistSingle(next);
                    return next;
                  });
                  startSseAi(id);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ExistingPaperRow({ paper, onExtract, onExtractWithStatus }: {
  paper: any;
  onExtract: (id: number) => void;
  onExtractWithStatus: (id: number, name: string) => void;
}) {
  const hasText = paper.fullPdfText && paper.fullPdfText.trim().length > 100;
  const displayName = `${paper.examName}${paper.year ? ` ${paper.year}` : ""}${paper.shift ? ` ${paper.shift}` : ""}`;

  return (
    <div className="flex items-center gap-3 p-4 border border-border rounded-xl">
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <FileText className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground truncate">{displayName}</p>
        <div className="flex gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
          <span>{paper.totalQuestions} questions</span>
          {paper.aiExtractionModel && <span className="text-purple-600 flex items-center gap-0.5"><Sparkles className="w-3 h-3" />{paper.aiExtractionModel}</span>}
          {!hasText && <span className="text-amber-600">⚠ No text — standard extraction pehle karein</span>}
        </div>
      </div>
      <Button
        size="sm" disabled={!hasText}
        variant={paper.aiExtractionStatus === "done" ? "outline" : "default"}
        onClick={() => onExtractWithStatus(paper.id, displayName)}
        className="gap-1.5 shrink-0"
      >
        {paper.aiExtractionStatus === "done" ? <><RefreshCw className="w-3 h-3" />Re-extract</> : <><Sparkles className="w-3 h-3" />AI Extract</>}
      </Button>
    </div>
  );
}
