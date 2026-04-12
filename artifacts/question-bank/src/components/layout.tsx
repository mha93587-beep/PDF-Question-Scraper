import { Link, useLocation } from "wouter";
import { LayoutDashboard, FileUp, Files, ListTodo, GraduationCap, FolderArchive } from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Upload Paper", href: "/upload", icon: FileUp },
  { name: "Batch ZIP Upload", href: "/batch", icon: FolderArchive },
  { name: "All Papers", href: "/papers", icon: Files },
  { name: "Question Bank", href: "/questions", icon: ListTodo },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-sidebar flex flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-2 text-primary">
            <GraduationCap className="w-6 h-6" />
            <span className="font-bold text-lg tracking-tight text-foreground">QuestionBank</span>
          </div>
        </div>
        
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          <div className="mb-4 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Menu
          </div>
          {navigation.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.name} href={item.href} className="block">
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors hover-elevate",
                    isActive
                      ? "bg-primary text-primary-foreground no-default-hover-elevate shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  )}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.name}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
