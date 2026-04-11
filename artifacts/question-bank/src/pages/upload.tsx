import { useState, useEffect, useRef } from "react";
import { useUploadPaper, useProcessAttachedPdf, getListPapersQueryKey, getGetQuestionStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";

type ProcessingState = {
  paperId: number;
  status: "processing" | "done" | "error";
  totalQuestions?: number;
  errorMessage?: string;
  elapsedSeconds: number;
};

function useProcessingPoller(
  paperId: number | null,
  onDone: (totalQuestions: number) => void,
  onError: (msg: string) => void
) {
  const [state, setState] = useState<ProcessingState | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!paperId) {
      setState(null);
      return;
    }

    startTimeRef.current = Date.now();
    setState({ paperId, status: "processing", elapsedSeconds: 0 });

    const poll = async () => {
      try {
        const res = await fetch(`/api/papers/${paperId}`);
        if (!res.ok) return;
        const paper = await res.json();
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);

        if (paper.processingStatus === "done") {
          setState({ paperId, status: "done", totalQuestions: paper.totalQuestions, elapsedSeconds: elapsed });
          if (intervalRef.current) clearInterval(intervalRef.current);
          onDone(paper.totalQuestions);
        } else if (paper.processingStatus === "error") {
          setState({ paperId, status: "error", errorMessage: paper.processingError, elapsedSeconds: elapsed });
          if (intervalRef.current) clearInterval(intervalRef.current);
          onError(paper.processingError || "Processing failed");
        } else {
          setState((prev) => prev ? { ...prev, elapsedSeconds: elapsed } : null);
        }
      } catch {
        // network error, keep polling
      }
    };

    intervalRef.current = setInterval(poll, 2000);
    poll();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paperId]);

  return state;
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [examName, setExamName] = useState("");
  const [year, setYear] = useState("");
  const [shift, setShift] = useState("");
  const [activePaperId, setActivePaperId] = useState<number | null>(null);
  const [attachedPaperId, setAttachedPaperId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListPapersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetQuestionStatsQueryKey() });
  };

  const uploadState = useProcessingPoller(
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

  const uploadMutation = useUploadPaper({
    mutation: {
      onSuccess: (data) => {
        setActivePaperId(data.paperId);
      },
      onError: () => {
        toast({
          title: "Upload Failed",
          description: "Failed to upload the PDF. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const processAttachedMutation = useProcessAttachedPdf({
    mutation: {
      onSuccess: (data) => {
        setAttachedPaperId(data.paperId);
      },
      onError: () => {
        toast({
          title: "Processing Failed",
          description: "Failed to start processing the attached PDF.",
          variant: "destructive",
        });
      },
    },
  });

  const handleUpload = () => {
    if (!file || !examName) return;
    uploadMutation.mutate({
      data: {
        file,
        examName,
        ...(year ? { year } : {}),
        ...(shift ? { shift } : {}),
      },
    });
  };

  const isUploadBusy = uploadMutation.isPending || uploadState?.status === "processing";
  const isAttachedBusy = processAttachedMutation.isPending || attachedState?.status === "processing";

  const attachedPdfs = [
    {
      name: "RRB NTPC CBT-I 2016 Shift 3",
      path: "attached_assets/RRB-NTPC-CBT-I-PYP-Held-on-30-Mar-2016-S3-Paper_1775882437052.pdf",
    },
    {
      name: "RRB NTPC Graduate CBT-I 2025 Shift 1",
      path: "attached_assets/RRB-NTPC-Graduate-2025-CBT-I-Question-Paper-\u201316-03-2026\u2013S1-1-1_1775882437102.pdf",
    },
  ];

  function formatTime(secs: number) {
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

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
              <input
                id="file"
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                disabled={isUploadBusy}
              />
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
              <Input
                id="examName"
                placeholder="e.g. RRB NTPC CBT-I 2025"
                value={examName}
                onChange={(e) => setExamName(e.target.value)}
                disabled={isUploadBusy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                placeholder="e.g. 2025"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                disabled={isUploadBusy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shift">Shift</Label>
              <Input
                id="shift"
                placeholder="e.g. Shift 1"
                value={shift}
                onChange={(e) => setShift(e.target.value)}
                disabled={isUploadBusy}
              />
            </div>
          </div>

          <Button
            onClick={handleUpload}
            disabled={!file || !examName || isUploadBusy}
            className="w-full"
            size="lg"
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : uploadState?.status === "processing" ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Extracting questions... ({formatTime(uploadState.elapsedSeconds)})
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Upload and Extract Questions
              </>
            )}
          </Button>

          {uploadState?.status === "processing" && (
            <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-800">
              <Clock className="w-5 h-5 mt-0.5 shrink-0 animate-pulse" />
              <div>
                <p className="font-medium">Extracting questions in background</p>
                <p className="text-sm mt-0.5 text-blue-700">
                  PDF parsing, figure detection, and OCR are running on the server. This typically takes 1–3 minutes for a 100-question paper. Please wait...
                </p>
              </div>
            </div>
          )}

          {uploadState?.status === "done" && (
            <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
              <CheckCircle2 className="w-5 h-5" />
              <span>Successfully extracted {uploadState.totalQuestions} questions in {formatTime(uploadState.elapsedSeconds)}!</span>
            </div>
          )}

          {uploadState?.status === "error" && (
            <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
              <AlertCircle className="w-5 h-5" />
              <span>Extraction failed: {uploadState.errorMessage}</span>
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
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isAttachedBusy}
                  onClick={() => {
                    processAttachedMutation.mutate({
                      id: 0,
                      data: { filePath: pdf.path },
                    });
                  }}
                >
                  {isAttachedBusy ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {attachedState?.status === "processing" ? formatTime(attachedState.elapsedSeconds) : "Starting..."}
                    </span>
                  ) : (
                    "Process"
                  )}
                </Button>
              </div>
            ))}

            {attachedState?.status === "processing" && (
              <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-800">
                <Clock className="w-5 h-5 mt-0.5 shrink-0 animate-pulse" />
                <div>
                  <p className="font-medium">Processing attached PDF...</p>
                  <p className="text-sm mt-0.5 text-blue-700">Extraction running in background. Elapsed: {formatTime(attachedState.elapsedSeconds)}</p>
                </div>
              </div>
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
