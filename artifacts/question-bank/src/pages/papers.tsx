import { useListPapers, getListPapersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "wouter";
import { FileText, Calendar, ArrowRight, Loader2, Hash } from "lucide-react";

export default function PapersPage() {
  const { data: papers, isLoading } = useListPapers({
    query: { queryKey: getListPapersQueryKey() },
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">All Papers</h1>
        <p className="text-muted-foreground text-lg">Browse all uploaded question papers.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : papers && papers.length > 0 ? (
        <div className="space-y-3">
          {papers.map((paper) => (
            <Link key={paper.id} href={`/papers/${paper.id}`}>
              <Card className="shadow-sm hover:border-primary/50 transition-colors cursor-pointer group">
                <CardContent className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileText className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-lg group-hover:text-primary transition-colors">{paper.examName}</span>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {paper.year && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" /> {paper.year}
                          </span>
                        )}
                        {paper.shift && <span>{paper.shift}</span>}
                        <span className="flex items-center gap-1">
                          <Hash className="w-3.5 h-3.5" /> {paper.totalQuestions} questions
                        </span>
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </CardContent>
              </Card>
            </Link>
          ))}
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
    </div>
  );
}
