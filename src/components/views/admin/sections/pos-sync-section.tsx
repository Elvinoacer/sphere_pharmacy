// src/components/views/admin/sections/pos-sync-section.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  RefreshCw, 
  UploadCloud, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Clock, 
  Server, 
  Package, 
  ShieldAlert 
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { SectionProps } from '../admin-shared';

interface PosSyncStats {
  totalSyncedProducts: number;
  totalBatches: number;
  nearExpiryCount: number;
  lastSyncTimestamp: string | null;
  recentLogs: Array<{
    id: string;
    trigger: string;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    itemsReceived: number;
    itemsUpserted: number;
    durationMs: number;
    startedAt: string;
  }>;
}

export function PosSyncSection({ refreshKey }: Partial<SectionProps> = {}) {
  const [stats, setStats] = useState<PosSyncStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/pos-status');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load POS telemetry', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // 30s auto-refresh
    return () => clearInterval(interval);
  }, [refreshKey]);

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);

      const headers: Record<string, string> = {};
      if (process.env.NEXT_PUBLIC_POS_SYNC_SECRET) {
        headers['Authorization'] = `Bearer ${process.env.NEXT_PUBLIC_POS_SYNC_SECRET}`;
      }

      const res = await fetch('/api/integrations/bandago/csv-import', {
        method: 'POST',
        headers,
        body: formData,
      });

      const result = await res.json();
      if (res.ok) {
        toast({
          title: 'CSV Import Completed',
          description: `Successfully upserted ${result.upsertedCount ?? 0} medications from BandaGo export.`,
        });
        fetchStats();
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (err: any) {
      toast({
        title: 'CSV Import Failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      // Reset input value so same file can be re-uploaded if desired
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">BandaGo POS Integration Hub</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Real-time telemetry, stock sync ledger, and lot/expiry compliance.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh Status
          </Button>
          <label className="cursor-pointer">
            <Input 
              type="file" 
              accept=".csv" 
              className="hidden" 
              onChange={handleCsvUpload} 
              disabled={uploading} 
            />
            <Button size="sm" variant="default" asChild disabled={uploading}>
              <span>
                <UploadCloud className="w-4 h-4 mr-2" />
                {uploading ? 'Processing CSV...' : 'Manual CSV Import'}
              </span>
            </Button>
          </label>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">POS Products Mapped</CardTitle>
            <Package className="w-4 h-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {stats?.totalSyncedProducts ?? '---'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Linked via externalPosId</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Active Batches (Lots)</CardTitle>
            <Server className="w-4 h-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {stats?.totalBatches ?? '---'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Managed under FEFO</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Near-Expiry Flags (&lt;90d)</CardTitle>
            <ShieldAlert className="w-4 h-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-500">
              {stats?.nearExpiryCount ?? '---'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Kenya PPB audit alert</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Last Live Signal</CardTitle>
            <Clock className="w-4 h-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {stats?.lastSyncTimestamp ? new Date(stats.lastSyncTimestamp).toLocaleTimeString() : 'No Sync Yet'}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {stats?.lastSyncTimestamp ? new Date(stats.lastSyncTimestamp).toLocaleDateString() : 'Awaiting extension'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sync Ledger Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Synchronization Audit Trail</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Trigger</th>
                  <th className="py-3 px-4">Items Received</th>
                  <th className="py-3 px-4">Upserted</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-xs">
                {stats?.recentLogs && stats.recentLogs.length > 0 ? (
                  stats.recentLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-sans">
                        {log.status === 'SUCCESS' && (
                          <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Success
                          </Badge>
                        )}
                        {log.status === 'PARTIAL' && (
                          <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400">
                            <AlertTriangle className="w-3 h-3 mr-1" /> Partial
                          </Badge>
                        )}
                        {log.status === 'FAILED' && (
                          <Badge variant="outline" className="border-rose-300 text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400">
                            <XCircle className="w-3 h-3 mr-1" /> Failed
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{log.trigger}</td>
                      <td className="py-3 px-4">{log.itemsReceived}</td>
                      <td className="py-3 px-4 text-emerald-600 dark:text-emerald-400 font-semibold">{log.itemsUpserted}</td>
                      <td className="py-3 px-4">{log.durationMs}ms</td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{new Date(log.startedAt).toLocaleString()}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400 font-sans">
                      No synchronization events recorded yet. Connect api_data_transformer to begin.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
