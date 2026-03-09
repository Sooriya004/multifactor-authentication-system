import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollText, CheckCircle, XCircle, AlertTriangle, Filter, ChevronLeft, ChevronRight, Loader2, DoorOpen, Monitor, UserCog, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { logsApi, type ApiAccessLog } from '@/lib/api';
import { mockLogs } from '@/lib/mockData';

const ITEMS_PER_PAGE = 20;

const resultFilters = [
  { key: 'all', label: 'All', icon: Filter },
  { key: 'success', label: 'Successful', icon: CheckCircle },
  { key: 'failed', label: 'Failed', icon: XCircle },
  { key: 'alert', label: 'Alerts', icon: AlertTriangle },
] as const;

const logCategories = [
  { key: 'all', label: 'All Logs', icon: ScrollText },
  { key: 'unlock', label: 'Unlock', icon: DoorOpen },
  { key: 'system', label: 'System', icon: Monitor },
  { key: 'account', label: 'Account', icon: UserCog },
] as const;

// Categories that support result filtering (success/failed/alert)
const FILTERABLE_CATEGORIES = ['all', 'unlock'];

interface LogsPanelProps {
  userOnly?: boolean;
  userId?: string;
}

function toApiLog(m: typeof mockLogs[0]): ApiAccessLog {
  return { id: m.id, user_id: m.userId, user_name: m.userName, timestamp: m.timestamp, action: m.action, method: m.method, result: m.result, ip_address: m.ipAddress, device_id: m.deviceId || null, category: m.category };
}

const LogsPanel = ({ userOnly, userId }: LogsPanelProps) => {
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<ApiAccessLog[]>([]);
  const [loading, setLoading] = useState(true);

  const showResultFilters = FILTERABLE_CATEGORIES.includes(activeCategory);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const filterToSend = showResultFilters ? activeFilter : 'all';
      const data = await logsApi.getLogs(filterToSend, page, ITEMS_PER_PAGE, activeCategory !== 'all' ? activeCategory : undefined, searchQuery || undefined);
      setLogs(data);
    } catch {
      let filtered = userOnly && userId ? mockLogs.filter(l => l.userId === userId) : mockLogs;
      if (activeCategory !== 'all') filtered = filtered.filter(l => l.category === activeCategory);
      if (showResultFilters && activeFilter !== 'all') filtered = filtered.filter(l => l.result === activeFilter);
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(l =>
          l.action.toLowerCase().includes(q) ||
          l.userName.toLowerCase().includes(q) ||
          l.method.toLowerCase().includes(q)
        );
      }
      const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
      setLogs(paginated.map(toApiLog));
    } finally {
      setLoading(false);
    }
  }, [activeFilter, activeCategory, page, userOnly, userId, searchQuery, showResultFilters]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Real-time polling every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => { fetchLogs(); }, 5000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Reset filter when switching to a non-filterable category
  useEffect(() => {
    if (!showResultFilters && activeFilter !== 'all') {
      setActiveFilter('all');
    }
  }, [activeCategory, showResultFilters, activeFilter]);

  const resultColor = (r: string) => {
    if (r === 'success') return 'bg-success/10 text-success border-success/20';
    if (r === 'failed') return 'bg-destructive/10 text-destructive border-destructive/20';
    return 'bg-warning/10 text-warning border-warning/20';
  };

  const categoryIcon = (cat: string) => {
    if (cat === 'unlock') return <DoorOpen className="w-4 h-4 text-primary" />;
    if (cat === 'system') return <Monitor className="w-4 h-4 text-primary/70" />;
    if (cat === 'account') return <UserCog className="w-4 h-4 text-primary/50" />;
    return <ScrollText className="w-4 h-4 text-muted-foreground" />;
  };

  const renderLogs = () => (
    <>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No logs found.</div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {logs.map((log, i) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: i * 0.03 }}
                className="glass-card rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap"
              >
                <div className="flex items-center gap-4 min-w-0">
                  {categoryIcon(log.category || 'system')}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{log.action}</div>
                    <div className="text-xs text-muted-foreground">
                      {log.user_name}{log.method ? ` · ${log.method}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {/* Only show result badge for unlock logs */}
                  {(log.category === 'unlock' || (!log.category && log.result !== 'success')) && (
                    <Badge variant="outline" className={resultColor(log.result)}>
                      {log.result}
                    </Badge>
                  )}
                  <div className="text-right hidden sm:block">
                    <div className="text-xs font-mono text-muted-foreground">{log.ip_address || '—'}</div>
                    <div className="text-xs text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div className="flex items-center justify-center gap-4 mt-6">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm text-muted-foreground">Page {page}</span>
        <Button variant="ghost" size="sm" disabled={logs.length < ITEMS_PER_PAGE} onClick={() => setPage(p => p + 1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </>
  );

  return (
    <div>
      {/* Category tabs */}
      <Tabs defaultValue="all" onValueChange={(v) => { setActiveCategory(v); setPage(1); }} className="mb-4">
        <TabsList className="bg-secondary border border-border">
          {logCategories.map(cat => (
            <TabsTrigger key={cat.key} value={cat.key} className="gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <cat.icon className="w-4 h-4" />
              {cat.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by action, user, or method..."
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          className="pl-9 bg-secondary border-border"
        />
      </div>

      {/* Result filters — only for unlock & all categories */}
      {showResultFilters && (
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {resultFilters.map(f => (
            <Button key={f.key} variant="ghost" size="sm"
              onClick={() => { setActiveFilter(f.key); setPage(1); }}
              className={`gap-2 ${activeFilter === f.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              <f.icon className="w-4 h-4" />
              {f.label}
            </Button>
          ))}
        </div>
      )}

      {renderLogs()}
    </div>
  );
};

export default LogsPanel;
