import { useGetQuestionStats, useListPapers, getGetQuestionStatsQueryKey, getListPapersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "wouter";
import { FileText, Database, Image as ImageIcon, ArrowRight, Loader2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetQuestionStats({
    query: { queryKey: getGetQuestionStatsQueryKey() }
  });
  
  const { data: papers, isLoading: papersLoading } = useListPapers({
    query: { queryKey: getListPapersQueryKey() }
  });

  const recentPapers = papers?.slice(0, 5) || [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-lg">Welcome back. Here's an overview of your study materials.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="shadow-sm border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Papers</CardTitle>
            <FileText className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <div className="text-3xl font-bold font-mono">{stats?.totalPapers || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Processed and stored</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Questions</CardTitle>
            <Database className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <div className="text-3xl font-bold font-mono">{stats?.totalQuestions || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Ready for practice</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Questions with Figures</CardTitle>
            <ImageIcon className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <div className="text-3xl font-bold font-mono">{stats?.withFigures || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Visual reasoning tasks</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <Card className="shadow-sm border-border flex flex-col">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Papers</CardTitle>
                <CardDescription>The latest exam papers you've added.</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/papers">View All</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            {papersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : recentPapers.length > 0 ? (
              <div className="space-y-4">
                {recentPapers.map((paper) => (
                  <Link key={paper.id} href={`/papers/${paper.id}`} className="block">
                    <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-primary/50 bg-card hover:bg-accent/50 transition-colors group">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium group-hover:text-primary transition-colors">{paper.examName}</span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {paper.year || "Unknown Year"}</span>
                          {paper.shift && <span>Shift: {paper.shift}</span>}
                          <span className="px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-mono">
                            {paper.totalQuestions} Qs
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                <FileText className="w-12 h-12 mb-3 opacity-20" />
                <p>No papers uploaded yet.</p>
                <Button variant="link" asChild className="mt-2 text-primary">
                  <Link href="/upload">Upload your first paper</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border flex flex-col bg-primary/5 border-primary/20">
          <CardHeader>
            <CardTitle>Subject Breakdown</CardTitle>
            <CardDescription>Questions available by category.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            {statsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : stats?.bySubject && stats.bySubject.length > 0 ? (
              <div className="space-y-4">
                {stats.bySubject.map((item) => (
                  <div key={item.subject || 'Uncategorized'} className="flex items-center justify-between">
                    <span className="font-medium">{item.subject || 'Uncategorized'}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-2 bg-secondary rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary" 
                          style={{ width: `${Math.min(100, Math.max(2, (item.count / stats.totalQuestions) * 100))}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-sm text-muted-foreground font-mono">{item.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full py-12 text-muted-foreground">
                <p>Not enough data to show breakdown.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
