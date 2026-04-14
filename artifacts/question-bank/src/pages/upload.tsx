import { useState, useEffect, useRef } from "react";
import { useProcessAttachedPdf, getListPapersQueryKey, getGetQuestionStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, Clock, ScanText, FileSearch, BrainCircuit, ListChecks } from "lucide-react";

const STORAGE_KEY_UPLOAD = "qb_active_upload_paper";
const STORAGE_KEY_ATTACHED = "qb_active_attached_paper";

type Stage = "extracting_text" | "pdftotext" | "pdf_parse" | "ocr" | "parsing_questions" | "marker_uploading" | "marker_parsing_questions" | null;
type ExtractionProvider = "local" | "marker";

const STAGE_INFO: Record<NonNullable<Stage>, { label: string; description: string; icon: React.ElementType }> = {
  extracting_text: { label: "Reading PDF...", description: "Opening the PDF file and attempting text extraction.", icon: FileSearch },
  pdftotext:       { label: "Extracting Text (pdftotext)", description: "Using pdftotext to pull embedded text from the PDF. Fast for digital PDFs.", icon: FileSearch },
  pdf_parse:       { label: "Trying JS Parser (pdf-parse)", description: "pdftotext got little text — trying an alternate JS-based PDF parser.", icon: ScanText },
  ocr:             { label: "Running Full OCR (Tesseract)", description: "This is a scanned/image-based PDF. Rendering every page and running OCR. This takes 3–8 minutes for a 100-page paper.", icon: BrainCircuit },
  parsing_questions: { label: "Parsing Questions", description: "Text extracted! Now identifying questions, options, and answers from the text.", icon: ListChecks },
  marker_uploading: { label: "Sending PDF to Marker", description: "Uploading the document to Datalab Marker for high-quality conversion.", icon: BrainCircuit },
  marker_parsing_questions: { label: "Parsing Marker Output", description: "Marker returned markdown. Now identifying questions, options, and answers.", icon: ListChecks },
};

type ProcessingState = {
  paperId: number;
  status: "processing" | "done" | "error";
  stage: Stage;
  totalQuestions?: number;
  errorMessage?: string;
  elapsedSeconds: number;
};

function saveActivePaper(key: string, paperId: number) {
  try { localStorage.setItem(key, String(paperId)); } catch {}
}
function loadActivePaper(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    if (!v) return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  } catch { return null; }
}
function clearActivePaper(key: string) {
  try { localStorage.removeItem(key); } catch {}
}

function useProcessingPoller(
  key: string,
  paperId: number | null,
  onDone: (totalQuestions: number) => void,
  onError: (msg: string) => void
) {
  const [state, setState] = useState<ProcessingState | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  function stopPolling() {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }

  useEffect(() => {
    if (!paperId) {
      setState(null);
      return;
    }

    startTimeRef.current = Date.now();
    saveActivePaper(key, paperId);
    setState({ paperId, status: "processing", stage: null, elapsedSeconds: 0 });

    const poll = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/papers/${paperId}`);
        if (!res.ok) return;
        const paper = await res.json();
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        const stage = (paper.processingStage as Stage) ?? null;

        if (paper.processingStatus === "done") {
          setState({ paperId, status: "done", stage: null, totalQuestions: paper.totalQuestions, elapsedSeconds: elapsed });
          stopPolling();
          clearActivePaper(key);
          onDone(paper.totalQuestions);
        } else if (paper.processingStatus === "error") {
          setState({ paperId, status: "error", stage: null, errorMessage: paper.processingError, elapsedSeconds: elapsed });
          stopPolling();
          clearActivePaper(key);
          onError(paper.processingError || "Processing failed");
        } else {
          setState((prev) => prev ? { ...prev, stage, elapsedSeconds: elapsed } : null);
        }
      } catch {
        // network error — keep polling
      }
    };

    intervalRef.current = setInterval(poll, 2500);
    poll();
    return stopPolling;
  }, [paperId]);

  return state;
}

function formatTime(secs: number) {
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function StageIndicator({ stage, elapsed }: { stage: Stage; elapsed: number }) {
  const isMarker = stage?.startsWith("marker") ?? false;
  const stages: Array<{ key: NonNullable<Stage>; shortLabel: string }> = isMarker ? [
    { key: "marker_uploading", shortLabel: "Marker" },
    { key: "marker_parsing_questions", shortLabel: "Parsing" },
  ] : [
    { key: "pdftotext", shortLabel: "pdftotext" },
    { key: "pdf_parse", shortLabel: "pdf-parse" },
    { key: "ocr", shortLabel: "OCR" },
    { key: "parsing_questions", shortLabel: "Parsing" },
  ];

  const activeStage = stage && STAGE_INFO[stage] ? STAGE_INFO[stage] : null;
  const Icon = activeStage?.icon ?? Clock;

  const isOcr = stage === "ocr";

  return (
    <div className="space-y-4">
      {/* Stage steps row */}
      <div className="flex items-center gap-1">
        {stages.map((s, i) => {
          const stageKeys = stages.map((x) => x.key);
          const currentIndex = stage ? stageKeys.indexOf(stage) : -1;
          const thisIndex = i;
          const isDone = currentIndex > thisIndex;
          const isActive = currentIndex === thisIndex;
          return (
            <div key={s.key} className="flex items-center gap-1 flex-1">
              <div
                className={`flex-1 text-center rounded-full px-2 py-1 text-xs font-medium transition-all ${
                  isDone
                    ? "bg-green-100 text-green-700"
                    : isActive
                    ? "bg-blue-600 text-white animate-pulse"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {isDone ? "✓ " : ""}{s.shortLabel}
              </div>
              {i < stages.length - 1 && (
                <div className={`h-0.5 w-3 shrink-0 ${isDone ? "bg-green-300" : "bg-muted"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Current stage detail */}
      <div className={`flex items-start gap-3 p-4 rounded-lg border ${isOcr ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200"}`}>
        <Icon className={`w-5 h-5 mt-0.5 shrink-0 animate-spin ${isOcr ? "text-amber-600" : "text-blue-600"}`} />
        <div>
          <p className={`font-semibold text-sm ${isOcr ? "text-amber-800" : "text-blue-800"}`}>
            {activeStage?.label ?? "Starting up..."} — {formatTime(elapsed)}
          </p>
          <p className={`text-xs mt-0.5 ${isOcr ? "text-amber-700" : "text-blue-700"}`}>
            {activeStage?.description ?? "Preparing to process the PDF..."}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [examName, setExamName] = useState("");
  const [year, setYear] = useState("");
  const [shift, setShift] = useState("");
  const [extractionProvider, setExtractionProvider] = useState<ExtractionProvider>("marker");
  const [uploadPending, setUploadPending] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Restore persisted paper IDs from localStorage on mount
  const [activePaperId, setActivePaperId] = useState<number | null>(() => loadActivePaper(STORAGE_KEY_UPLOAD));
  const [attachedPaperId, setAttachedPaperId] = useState<number | null>(() => loadActivePaper(STORAGE_KEY_ATTACHED));

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListPapersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetQuestionStatsQueryKey() });
  };

  const uploadState = useProcessingPoller(
    STORAGE_KEY_UPLOAD,
    activePaperId,
    (totalQuestions) => {
      toast({ title: "PDF Extracted!", description: `Successfully extracted ${totalQuestions} questions.` });
      setFile(null);
      setExamName("");
      setYear("");
      setShift("");
      setActivePaperId(null);
      invalidateAll();
    },
    (msg) => {
      toast({ title: "Extraction Failed", description: msg, variant: "destructive" });
      setActivePaperId(null);
    }
  );

  const attachedState = useProcessingPoller(
    STORAGE_KEY_ATTACHED,
    attachedPaperId,
    (totalQuestions) => {
      toast({ title: "Attached PDF Extracted!", description: `Successfully extracted ${totalQuestions} questions.` });
      setAttachedPaperId(null);
      invalidateAll();
    },
    (msg) => {
      toast({ title: "Processing Failed", description: msg, variant: "destructive" });
      setAttachedPaperId(null);
    }
  );

  const processAttachedMutation = useProcessAttachedPdf({
    mutation: {
      onSuccess: (data) => setAttachedPaperId(data.paperId),
      onError: () => toast({ title: "Processing Failed", description: "Failed to start processing the attached PDF.", variant: "destructive" }),
    },
  });

  const handleUpload = async () => {
    if (!file || !examName) return;
    setUploadPending(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("examName", examName);
      formData.append("provider", extractionProvider);
      if (year) formData.append("year", year);
      if (shift) formData.append("shift", shift);

      const response = await fetch(`${import.meta.env.BASE_URL}api/papers/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to upload the PDF. Please try again.");
      }
      setActivePaperId(data.paperId);
    } catch (err) {
      toast({
        title: "Upload Failed",
        description: err instanceof Error ? err.message : "Failed to upload the PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadPending(false);
    }
  };

  const isUploadBusy = uploadPending || uploadState?.status === "processing";
  const isAttachedBusy = processAttachedMutation.isPending || attachedState?.status === "processing";

  const attachedPdfs = [
    { name: "RRB NTPC CBT-I 2016 Shift 3", path: "attached_assets/RRB-NTPC-CBT-I-PYP-Held-on-30-Mar-2016-S3-Paper_1775882437052.pdf" },
    { name: "RRB NTPC Graduate CBT-I 2025 Shift 1", path: "attached_assets/RRB-NTPC-Graduate-2025-CBT-I-Question-Paper-\u201316-03-2026\u2013S1-1-1_1775882437102.pdf" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Upload Paper</h1>
        <p className="text-muted-foreground text-lg">Upload a PDF question paper to extract and store questions.</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Upload PDF</CardTitle>
          <CardDescription>Select a question paper PDF and provide exam details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="file">PDF File</Label>
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
              <input id="file" type="file" accept=".pdf" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={isUploadBusy} />
              <label htmlFor="file" className={`cursor-pointer flex flex-col items-center gap-3 ${isUploadBusy ? "opacity-50 cursor-not-allowed" : ""}`}>
                {file ? (
                  <>
                    <FileText className="w-10 h-10 text-primary" />
                    <span className="font-medium text-foreground">{file.name}</span>
                    <span className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-muted-foreground" />
                    <span className="text-muted-foreground">Click to select a PDF file</span>
                    <span className="text-xs text-muted-foreground">Maximum file size: 50 MB</span>
                  </>
                )}
              </label>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="examName">Exam Name *</Label>
              <Input id="examName" placeholder="e.g. RRB NTPC CBT-I 2025" value={examName}
                onChange={(e) => setExamName(e.target.value)} disabled={isUploadBusy} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="year">Year</Label>
              <Input id="year" placeholder="e.g. 2025" value={year}
                onChange={(e) => setYear(e.target.value)} disabled={isUploadBusy} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shift">Shift</Label>
              <Input id="shift" placeholder="e.g. Shift 1" value={shift}
                onChange={(e) => setShift(e.target.value)} disabled={isUploadBusy} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Extraction Engine</Label>
            <div className="grid gap-3 md:grid-cols-2">
              <Button
                type="button"
                variant={extractionProvider === "marker" ? "default" : "outline"}
                className="h-auto justify-start p-4"
                disabled={isUploadBusy}
                onClick={() => setExtractionProvider("marker")}
              >
                <div className="text-left">
                  <div className="font-semibold">Marker API</div>
                  <div className="text-xs opacity-80">Best for scanned PDFs, math, tables, and complex layouts.</div>
                </div>
              </Button>
              <Button
                type="button"
                variant={extractionProvider === "local" ? "default" : "outline"}
                className="h-auto justify-start p-4"
                disabled={isUploadBusy}
                onClick={() => setExtractionProvider("local")}
              >
                <div className="text-left">
                  <div className="font-semibold">Local OCR</div>
                  <div className="text-xs opacity-80">Runs inside Railway using pdftotext, pdf-parse, and OCR.</div>
                </div>
              </Button>
            </div>
          </div>

          <Button onClick={handleUpload} disabled={!file || !examName || isUploadBusy} className="w-full" size="lg">
            {uploadPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading...</>
            ) : uploadState?.status === "processing" ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing... ({formatTime(uploadState.elapsedSeconds)})</>
            ) : (
              <><Upload className="w-4 h-4 mr-2" />Upload and Extract with {extractionProvider === "marker" ? "Marker" : "Local OCR"}</>
            )}
          </Button>

          {uploadState?.status === "processing" && (
            <StageIndicator stage={uploadState.stage} elapsed={uploadState.elapsedSeconds} />
          )}

          {uploadState?.status === "done" && (
            <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
              <CheckCircle2 className="w-5 h-5" />
              <span>Successfully extracted {uploadState.totalQuestions} questions in {formatTime(uploadState.elapsedSeconds)}!</span>
            </div>
          )}

          {uploadState?.status === "error" && (
            <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <span className="text-sm">{uploadState.errorMessage}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Process Attached PDFs</CardTitle>
          <CardDescription>Process pre-attached PDF files that are already in the system.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {attachedPdfs.map((pdf) => (
              <div key={pdf.path} className="flex items-center justify-between p-4 rounded-lg border border-border">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-primary" />
                  <span className="font-medium">{pdf.name}</span>
                </div>
                <Button variant="outline" size="sm" disabled={isAttachedBusy}
                  onClick={() => processAttachedMutation.mutate({ id: 0, data: { filePath: pdf.path, provider: extractionProvider } })}>
                  {isAttachedBusy ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {attachedState?.status === "processing" ? formatTime(attachedState.elapsedSeconds) : "Starting..."}
                    </span>
                  ) : "Process"}
                </Button>
              </div>
            ))}

            {attachedState?.status === "processing" && (
              <StageIndicator stage={attachedState.stage} elapsed={attachedState.elapsedSeconds} />
            )}

            {attachedState?.status === "done" && (
              <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
                <CheckCircle2 className="w-5 h-5" />
                <span>Done! Extracted {attachedState.totalQuestions} questions in {formatTime(attachedState.elapsedSeconds)}.</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
