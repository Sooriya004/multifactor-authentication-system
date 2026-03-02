import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollText, CheckCircle, XCircle, AlertTriangle, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { mockLogs, type AccessLog } from '@/lib/mockData';

const ITEMS_PER_PAGE = 10;

const filters = [
  { key: 'all', label: 'All', icon: Filter },
  { key: 'success', label: 'Successful', icon: CheckCircle },
  { key: 'failed', label: 'Failed', icon: XCircle },
  { key: 'alert', label: 'Alerts', icon: AlertTriangle },
] as const;

interface LogsPanelProps {
  userOnly?: boolean;
  userId?: string;
}

const LogsPanel = ({ userOnly, userId }: LogsPanelProps) => {
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const logs = useMemo(() => {
    let filtered = userOnly && userId ? mockLogs.filter(l => l.userId === userId) : mockLogs;
    if (activeFilter !== 'all') filtered = filtered.filter(l => l.result === activeFilter);
    return filtered;
  }, [activeFilter, userOnly, userId]);

  const totalPages = Math.ceil(logs.length / ITEMS_PER_PAGE);
  const paginatedLogs = logs.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const resultColor = (r: AccessLog['result']) => {
    if (r === 'success') return 'bg-success/10 text-success border-success/20';
    if (r === 'failed') return 'bg-destructive/10 text-destructive border-destructive/20';
    return 'bg-warning/10 text-warning border-warning/20';
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {filters.map(f => (
          <Button key={f.key} variant="ghost" size="sm"
            onClick={() => { setActiveFilter(f.key); setPage(1); }}
            className={`gap-2 ${activeFilter === f.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            <f.icon className="w-4 h-4" />
            {f.label}
          </Button>
        ))}
      </div>

      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {paginatedLogs.map((log, i) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ delay: i * 0.03 }}
              className="glass-card rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap"
            >
              <div className="flex items-center gap-4 min-w-0">
                <ScrollText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{log.action}</div>
                  <div className="text-xs text-muted-foreground">{log.userName} · {log.method}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <Badge variant="outline" className={resultColor(log.result)}>
                  {log.result}
                </Badge>
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-mono text-muted-foreground">{log.ipAddress}</div>
                  <div className="text-xs text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default LogsPanel;
