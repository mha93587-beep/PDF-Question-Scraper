import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getListPapersQueryKey, getGetQuestionStatsQueryKey } from "@workspace/api-client-react";
import {
  Upload, FileArchive, Loader2, CheckCircle2, AlertCircle, Clock,
  FileText, ScanText, BrainCircuit, ListChecks, XCircle, ChevronDown, ChevronUp,
} from "lucide-react";

const STORAGE_KEY_BATCH = "qb_active_batch_job";

type ItemStatus = "pending" | "processing" | "done" | "error";
type JobStatus = "pending" | "downloading" | "processing" | "done" | "error";
type ExtractionProvider = "local" | "marker";

type BatchItem = {
  id: number;
  fileName: string;
  status: ItemStatus;
  processingStage: string | null;
  questionsExtracted: number;
  error: string | null;
  paperId: number | null;
};

type BatchJob = {
  id: number;
  status: JobStatus;
  zipFileName: string | null;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  error: string | null;
  createdAt: string;
  items: BatchItem[];
};

const STAGE_LABELS: Record<string, string> = {
  extracting: "Reading ZIP",
  pdftotext: "pdftotext",
  pdf_parse: "pdf-parse",
  ocr: "OCR (slow)",
  parsing_questions: "Parsing Q's",
  marker_uploading: "Marker upload",
  marker_parsing_questions: "Parsing Marker",
};

const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: "Queued",
  downloading: "Downloading ZIP",
  processing: "Processing PDFs",
  done: "Complete",
  error: "Failed",
};

function formatTime(secs: number) {
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function ItemRow({ item }: { item: BatchItem }) {
  const statusIcons: Record<ItemStatus, React.ReactNode> = {
    pending: <Clock className="w-4 h-4 text-muted-foreground" />,
    processing: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
    done: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    error: <XCircle className="w-4 h-4 text-red-500" />,
  };

  const isOcr = item.processingStage === "ocr";
  const isMarker = item.processingStage?.startsWith("marker") ?? false;
  const stageLabel = item.processingStage ? STAGE_LABELS[item.processingStage] ?? item.processingStage : null;

  return (
    <div className={`flex items-center gap-3 py-2.5 px-3 rounded-md text-sm border ${
      item.status === "processing" ? "bg-blue-50/50 border-blue-100" :
      item.status === "done" ? "bg-green-50/30 border-green-100" :
      item.status === "error" ? "bg-red-50/30 border-red-100" :
      "bg-background border-border"
    }`}>
      <div className="shrink-0">{statusIcons[item.status]}</div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate text-foreground">{item.fileName}</p>
        {item.status === "processing" && stageLabel && (
          <p className={`text-xs mt-0.5 ${isOcr ? "text-amber-600 font-medium" : isMarker ? "text-indigo-600" : "text-blue-600"}`}>
            {isOcr ? "⏳ " : ""}{stageLabel}{isOcr ? " — may take 3–8 min" : "..."}
          </p>
        )}
        {item.status === "error" && item.error && (
          <p className="text-xs mt-0.5 text-red-600 truncate">{item.error}</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        {item.status === "done" && (
          <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 border-green-200">
            {item.questionsExtracted} Qs
          </Badge>
        )}
        {item.status === "pending" && (
          <span className="text-xs text-muted-foreground">Waiting</span>
        )}
      </div>
    </div>
  );
}

function JobCard({ job, elapsed }: { job: BatchJob; elapsed: number }) {
  const [expanded, setExpanded] = useState(true);
  const totalDone = job.items.filter((i) => i.status === "done").length;
  const totalError = job.items.filter((i) => i.status === "error").length;
  const totalProcessing = job.items.filter((i) => i.status === "processing").length;
  const totalPending = job.items.filter((i) => i.status === "pending").length;
  const totalQs = job.items.reduce((sum, i) => sum + (i.questionsExtracted ?? 0), 0);

  const pct = job.totalFiles > 0 ? Math.round(((job.processedFiles + job.failedFiles) / job.totalFiles) * 100) : 0;
  const isActive = job.status === "processing" || job.status === "downloading";

  return (
    <Card className={`shadow-sm transition-all ${isActive ? "border-blue-200" : job.status === "done" ? "border-green-200" : job.status === "error" ? "border-red-200" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileArchive className={`w-5 h-5 shrink-0 ${isActive ? "text-blue-500" : job.status === "done" ? "text-green-500" : job.status === "error" ? "text-red-500" : "text-muted-foreground"}`} />
            <div className="min-w-0">
              <p className="font-semibold truncate">{job.zipFileName || `Batch #${job.id}`}</p>
              <p className="text-xs text-muted-foreground">{job.items.length} PDFs · Started {new Date(job.createdAt).toLocaleTimeString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={
              job.status === "done" ? "bg-green-100 text-green-700 border-green-200" :
              job.status === "error" ? "bg-red-100 text-red-700 border-red-200" :
              job.status === "processing" || job.status === "downloading" ? "bg-blue-100 text-blue-700 border-blue-200 animate-pulse" :
              "bg-muted text-muted-foreground"
            } variant="outline">
              {isActive && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              {job.status === "done" && <CheckCircle2 className="w-3 h-3 mr-1" />}
              {job.status === "error" && <AlertCircle className="w-3 h-3 mr-1" />}
              {JOB_STATUS_LABEL[job.status]}
            </Badge>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {isActive && (
          <div className="space-y-1.5 mt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{job.processedFiles + job.failedFiles} / {job.totalFiles} files done</span>
              <span>{formatTime(elapsed)}</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
        )}

        {job.status === "done" && (
          <div className="flex gap-4 mt-2 text-sm">
            <span className="text-green-700 font-medium">{totalDone} succeeded</span>
            {totalError > 0 && <span className="text-red-600">{totalError} failed</span>}
            <span className="text-muted-foreground">{totalQs} questions total</span>
          </div>
        )}

        {job.status === "error" && job.error && (
          <p className="text-xs text-red-600 mt-1">{job.error}</p>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {job.items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Reading ZIP file...</p>
            ) : (
              job.items.map((item) => <ItemRow key={item.id} item={item} />)
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function BatchUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [extractionProvider, setExtractionProvider] = useState<ExtractionProvider>("marker");
  const [activeJobId, setActiveJobId] = useState<number | null>(() => {
    try { const v = localStorage.getItem(STORAGE_KEY_BATCH); return v ? parseInt(v) : null; } catch { return null; }
  });
  const [job, setJob] = useState<BatchJob | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!activeJobId) {
      setJob(null);
      return;
    }
    try { localStorage.setItem(STORAGE_KEY_BATCH, String(activeJobId)); } catch {}
    startTimeRef.current = Date.now();

    const poll = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/batch/${activeJobId}`);
        if (!res.ok) return;
        const data: BatchJob = await res.json();
        setJob(data);

        if (data.status === "done" || data.status === "error") {
          clearInterval(intervalRef.current!);
          clearInterval(timerRef.current!);
          try { localStorage.removeItem(STORAGE_KEY_BATCH); } catch {}
          setActiveJobId(null);

          if (data.status === "done") {
            const totalQs = data.items.reduce((s, i) => s + i.questionsExtracted, 0);
            toast({ title: "Batch Complete!", description: `Processed ${data.processedFiles} PDFs, extracted ${totalQs} questions.` });
            queryClient.invalidateQueries({ queryKey: getListPapersQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetQuestionStatsQueryKey() });
          } else {
            toast({ title: "Batch Failed", description: data.error || "An error occurred", variant: "destructive" });
          }
        }
      } catch { }
    };

    intervalRef.current = setInterval(poll, 2500);
    timerRef.current = setInterval(() => setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000);
    poll();

    return () => {
      clearInterval(intervalRef.current!);
      clearInterval(timerRef.current!);
    };
  }, [activeJobId]);

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const urlRes = await fetch(`${import.meta.env.BASE_URL}api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: "application/zip" }),
      });
      if (!urlRes.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await urlRes.json();

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.open("PUT", uploadURL);
        xhr.setRequestHeader("Content-Type", "application/zip");
        xhr.send(file);
      });

      const batchRes = await fetch(`${import.meta.env.BASE_URL}api/batch/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zipObjectPath: objectPath, zipFileName: file.name, provider: extractionProvider }),
      });
      if (!batchRes.ok) throw new Error("Failed to start batch job");
      const { jobId } = await batchRes.json();

      setFile(null);
      setUploadProgress(0);
      setActiveJobId(jobId);
      toast({ title: "Batch Job Started!", description: `Processing ${file.name} with ${extractionProvider === "marker" ? "Marker" : "Local OCR"} in the background.` });
    } catch (err: any) {
      toast({ title: "Upload Failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const isActive = !!activeJobId || isUploading;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Batch ZIP Upload</h1>
        <p className="text-muted-foreground text-lg">
          Upload a ZIP file containing multiple PDFs. Each PDF is extracted automatically in the background.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Upload ZIP Archive</CardTitle>
          <CardDescription>
            Pack all your question paper PDFs into a single ZIP file and upload it here. Works with 100s of PDFs up to 1 GB.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="border-2 border-dashed border-border rounded-lg p-10 text-center hover:border-primary/50 transition-colors">
            <input id="zip-file" type="file" accept=".zip" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={isActive} />
            <label htmlFor="zip-file" className={`cursor-pointer flex flex-col items-center gap-3 ${isActive ? "opacity-50 cursor-not-allowed" : ""}`}>
              {file ? (
                <>
                  <FileArchive className="w-12 h-12 text-primary" />
                  <span className="font-semibold text-foreground text-lg">{file.name}</span>
                  <span className="text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  <Badge variant="secondary">ZIP file ready</Badge>
                </>
              ) : (
                <>
                  <FileArchive className="w-12 h-12 text-muted-foreground" />
                  <span className="font-medium text-muted-foreground text-lg">Click to select a ZIP file</span>
                  <span className="text-sm text-muted-foreground">Supports ZIP archives up to 1 GB containing multiple PDFs</span>
                </>
              )}
            </label>
          </div>

          {isUploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Uploading to Backblaze B2...</span>
                <span className="font-medium">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-3" />
              <p className="text-xs text-muted-foreground">
                The file is uploading directly to Backblaze B2 — your server won't crash no matter how big the ZIP is.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Extraction Engine</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Button
                type="button"
                variant={extractionProvider === "marker" ? "default" : "outline"}
                className="h-auto justify-start p-4"
                disabled={isActive}
                onClick={() => setExtractionProvider("marker")}
              >
                <div className="text-left">
                  <div className="font-semibold">Marker API</div>
                  <div className="text-xs opacity-80">Recommended for scanned papers, math, tables, and diagrams.</div>
                </div>
              </Button>
              <Button
                type="button"
                variant={extractionProvider === "local" ? "default" : "outline"}
                className="h-auto justify-start p-4"
                disabled={isActive}
                onClick={() => setExtractionProvider("local")}
              >
                <div className="text-left">
                  <div className="font-semibold">Local OCR</div>
                  <div className="text-xs opacity-80">Runs pdftotext, pdf-parse, and Tesseract one by one.</div>
                </div>
              </Button>
            </div>
          </div>

          <Button onClick={handleUpload} disabled={!file || isActive} className="w-full" size="lg">
            {isUploading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading... {uploadProgress}%</>
            ) : activeJobId ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing in background...</>
            ) : (
              <><Upload className="w-4 h-4 mr-2" />Upload ZIP and Extract with {extractionProvider === "marker" ? "Marker" : "Local OCR"}</>
            )}
          </Button>

          <div className="grid grid-cols-3 gap-4 text-center text-sm pt-2">
            {[
              { icon: FileArchive, label: "Upload ZIP", desc: "Direct to Backblaze B2\nServer never overloads" },
              { icon: FileText, label: "Auto-extract PDFs", desc: "Each PDF detected\nautomatically from ZIP" },
              { icon: BrainCircuit, label: extractionProvider === "marker" ? "Marker extraction" : "Sequential OCR", desc: extractionProvider === "marker" ? "One-by-one Marker conversion\nBetter layout + math support" : "One-by-one processing\nScanned PDFs supported" },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex flex-col items-center gap-2 p-3 rounded-lg bg-muted/40">
                <Icon className="w-6 h-6 text-primary" />
                <p className="font-medium">{label}</p>
                <p className="text-xs text-muted-foreground whitespace-pre-line">{desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {job && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Batch Progress</h2>
          <JobCard job={job} elapsed={elapsedSecs} />
        </div>
      )}
    </div>
  );
}
