import { useState } from "react";
import { useUploadPaper, useProcessAttachedPdf, getListPapersQueryKey, getGetQuestionStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Loader2, CheckCircle2 } from "lucide-react";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [examName, setExamName] = useState("");
  const [year, setYear] = useState("");
  const [shift, setShift] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useUploadPaper({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "PDF Processed Successfully",
          description: data.message,
        });
        setFile(null);
        setExamName("");
        setYear("");
        setShift("");
        queryClient.invalidateQueries({ queryKey: getListPapersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetQuestionStatsQueryKey() });
      },
      onError: () => {
        toast({
          title: "Upload Failed",
          description: "Failed to process the PDF. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const processAttachedMutation = useProcessAttachedPdf({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Attached PDF Processed",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: getListPapersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetQuestionStatsQueryKey() });
      },
      onError: () => {
        toast({
          title: "Processing Failed",
          description: "Failed to process the attached PDF.",
          variant: "destructive",
        });
      },
    },
  });

  const handleUpload = () => {
    if (!file || !examName) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("examName", examName);
    if (year) formData.append("year", year);
    if (shift) formData.append("shift", shift);
    uploadMutation.mutate({ data: formData as any });
  };

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
              />
              <label htmlFor="file" className="cursor-pointer flex flex-col items-center gap-3">
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                placeholder="e.g. 2025"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shift">Shift</Label>
              <Input
                id="shift"
                placeholder="e.g. Shift 1"
                value={shift}
                onChange={(e) => setShift(e.target.value)}
              />
            </div>
          </div>

          <Button
            onClick={handleUpload}
            disabled={!file || !examName || uploadMutation.isPending}
            className="w-full"
            size="lg"
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing PDF...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Upload and Extract Questions
              </>
            )}
          </Button>

          {uploadMutation.isSuccess && (
            <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
              <CheckCircle2 className="w-5 h-5" />
              <span>{uploadMutation.data.message}</span>
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
                  disabled={processAttachedMutation.isPending}
                  onClick={() => {
                    processAttachedMutation.mutate({
                      id: 0,
                      data: { filePath: pdf.path },
                    });
                  }}
                >
                  {processAttachedMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Process"
                  )}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
