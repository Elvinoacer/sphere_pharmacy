// src/components/views/admin/sections/pos-sync-section.tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  Package,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  ExportGroupBy,
  OutboundSyncMode,
  PosBridgeHeartbeat,
  PosSyncPolicy,
  PreferredExportFormat,
} from '@/lib/pos-reconciliation-core';
import { DEFAULT_POS_SYNC_POLICY } from '@/lib/pos-reconciliation-core';
import { useAuthStore } from '@/store/use-auth-store';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AdminSectionHeader,
  KpiCard,
  KpiSkeletonGrid,
  SectionError,
  type SectionProps,
} from '../admin-shared';

interface PosSyncLogErrorItem {
  externalPosId?: string;
  name?: string;
  error?: string;
  code?: string;
}

interface PosSyncLogDetails {
  message?: string;
  fatalError?: string;
  errors?: PosSyncLogErrorItem[];
  note?: string | null;
  exportBatchId?: string | null;
}

interface PosSyncLogItem {
  id: string;
  direction?: 'INBOUND' | 'OUTBOUND';
  trigger: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  itemsReceived: number;
  itemsUpserted: number;
  itemsFailed?: number;
  details?: PosSyncLogDetails | null;
  durationMs: number;
  startedAt: string;
}

interface PosSyncStatusResponse {
  totalSyncedProducts: number;
  totalBatches: number;
  nearExpiryCount: number;
  lastSyncTimestamp: string | null;
  recentLogs: PosSyncLogItem[];
  policy: PosSyncPolicy;
  bridgeHeartbeat: PosBridgeHeartbeat | null;
  pendingOutboundCount: number;
  exportedAwaitingConfirmCount: number;
  failedOutboundCount: number;
  syncedOutboundTodayCount: number;
  unreconciledUnitsTotal: number;
  openIncidentsCount: number;
  criticalIncidentsCount: number;
  apiKeyConfigured: boolean;
  usingDefaultKeyWarning: boolean;
}

interface OutboundJobRow {
  id: string;
  idempotencyKey: string;
  eventType:
    | 'ONLINE_SALE'
    | 'ADMIN_STOCK_ADJUST'
    | 'REFUND_RESTOCK'
    | 'ADMIN_PRICE_UPDATE';
  status:
    | 'PENDING'
    | 'PROCESSING'
    | 'SYNCED'
    | 'EXPORTED'
    | 'RECONCILED_MANUAL'
    | 'FAILED'
    | 'CANCELLED'
    | 'SKIPPED_UNMAPPED';
  orderId: string | null;
  orderReference: string | null;
  productId: string;
  externalPosId: string | null;
  productName: string;
  sku: string | null;
  qtyDelta: number;
  targetStock: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  paymentMethod: string | null;
  posStockSnapshot: number | null;
  attempts: number;
  maxAttempts: number;
  externalDocumentNo: string | null;
  reconciledBy: string | null;
  reconciledNote: string | null;
  exportBatchId: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  createdAt: string;
  syncedAt: string | null;
  product?: {
    stock: number;
    stockQty: number;
    lastPosStock: number | null;
    externalPosId: string | null;
  };
}

interface StockVarianceRow {
  productId: string;
  name: string;
  sku: string;
  externalPosId: string | null;
  lastPosStock: number | null;
  lastPosSellableStock: number | null;
  sphereStock: number;
  sphereStockQty: number;
  pendingOutboundNetDelta: number;
  pendingOutboundSalesQty: number;
  unpaidOrderHoldQty: number;
  virtualReservedStock: number;
  lastSyncedAt: string | null;
  status: 'MATCHED' | 'DRIFT_PROTECTED' | 'VARIANCE';
}

interface PosIncidentRow {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  source: string;
  severity: 'CRITICAL' | 'ERROR' | 'WARNING' | string;
  code: string;
  message: string;
  remediation: string | null;
  externalPosId: string | null;
  productName: string | null;
  orderReference: string | null;
  occurrences: number;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface ReconcilePayload {
  jobs: OutboundJobRow[];
  varianceItems: StockVarianceRow[];
  incidents: PosIncidentRow[];
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (Number.isNaN(diffSec)) return 'Unknown';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function getJobStatusBadge(status: OutboundJobRow['status']) {
  switch (status) {
    case 'SYNCED':
      return <Badge className="bg-emerald-600 text-white">Synced to POS</Badge>;
    case 'RECONCILED_MANUAL':
      return <Badge className="bg-teal-600 text-white">Entered in POS</Badge>;
    case 'EXPORTED':
      return <Badge className="bg-sky-600 text-white">Exported</Badge>;
    case 'PROCESSING':
      return <Badge className="bg-amber-600 text-white">In Flight</Badge>;
    case 'FAILED':
      return <Badge variant="destructive">Failed</Badge>;
    case 'CANCELLED':
      return <Badge variant="outline">Cancelled</Badge>;
    case 'SKIPPED_UNMAPPED':
      return <Badge variant="secondary">Unmapped</Badge>;
    default:
      return (
        <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
          Pending
        </Badge>
      );
  }
}

export function PosSyncSection({ refreshKey, onRefresh }: Partial<SectionProps> = {}) {
  const session = useAuthStore((s) => s.session);
  const isAdmin = (session?.staff?.role || session?.role) === 'ADMIN';

  const [activeTab, setActiveTab] = useState<'overview' | 'reconciliation' | 'incidents' | 'audit'>(
    'overview'
  );
  const [statusData, setStatusData] = useState<PosSyncStatusResponse | null>(null);
  const [reconcileData, setReconcileData] = useState<ReconcilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Policy draft form state
  const [policyDraft, setPolicyDraft] = useState<PosSyncPolicy>(DEFAULT_POS_SYNC_POLICY);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [confirmAutoSyncOpen, setConfirmAutoSyncOpen] = useState(false);
  const [confirmBaselineOpen, setConfirmBaselineOpen] = useState(false);
  const [markOpenOnBaseline, setMarkOpenOnBaseline] = useState(true);

  // Sales export state
  const [exportFormat, setExportFormat] = useState<PreferredExportFormat>('PDF');
  const [exportScope, setExportScope] = useState<'unreconciled' | 'today' | 'range'>('unreconciled');
  const [exportGroupBy, setExportGroupBy] = useState<ExportGroupBy>('PRODUCT_SUMMARY');
  const [exportFrom, setExportFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [exportTo, setExportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [markExported, setMarkExported] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Reconciliation & incident controls
  const [jobFilter, setJobFilter] = useState<'OPEN' | 'EXPORTED' | 'FAILED' | 'ALL'>('OPEN');
  const [incidentFilter, setIncidentFilter] = useState<'OPEN' | 'CRITICAL' | 'ALL'>('OPEN');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // CSV manual import state
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoadError(null);
      const [statusRes, recRes] = await Promise.all([
        fetch('/api/admin/pos-status', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/admin/pos-sync/reconcile', { credentials: 'include', cache: 'no-store' }),
      ]);

      if (!statusRes.ok) {
        const errBody = await statusRes.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to load POS status (HTTP ${statusRes.status})`);
      }

      const statusJson = (await statusRes.json()) as PosSyncStatusResponse;
      setStatusData(statusJson);
      setPolicyDraft(statusJson.policy);
      setExportFormat(statusJson.policy.preferredExportFormat);
      setExportGroupBy(statusJson.policy.exportGroupBy);

      if (recRes.ok) {
        const recJson = (await recRes.json()) as ReconcilePayload;
        setReconcileData(recJson);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to fetch POS synchronization state.';
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll, refreshKey]);

  const handleSavePolicy = async (patch: Partial<PosSyncPolicy>, label?: string) => {
    try {
      setSavingPolicy(true);
      const res = await fetch('/api/admin/pos-sync/policy', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Could not update POS sync policy');
      }
      setPolicyDraft(json.policy);
      toast.success(label || 'POS synchronization policy saved');
      await fetchAll();
      onRefresh?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed updating policy');
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleModeSelection = (mode: OutboundSyncMode) => {
    if (mode === 'AUTO_SYNC' && policyDraft.outboundSyncMode !== 'AUTO_SYNC') {
      setConfirmAutoSyncOpen(true);
      return;
    }
    if (mode === 'MANUAL_EXPORT' && policyDraft.outboundSyncMode !== 'MANUAL_EXPORT') {
      void handleSavePolicy({ outboundSyncMode: 'MANUAL_EXPORT' }, 'Switched to Manual Daily Sales Export');
    }
  };

  const runReconcileAction = async (
    body: Record<string, unknown>,
    successMsg: string,
    loadingKey: string
  ) => {
    try {
      setActionLoadingId(loadingKey);
      const res = await fetch('/api/admin/pos-sync/reconcile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Action failed');
      }
      toast.success(successMsg);
      await fetchAll();
      onRefresh?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Reconciliation command failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDownloadSalesExport = async () => {
    try {
      setExporting(true);
      const params = new URLSearchParams({
        format: exportFormat.toLowerCase(),
        scope: exportScope,
        groupBy: exportGroupBy,
        markExported: markExported ? '1' : '0',
      });
      if (exportScope === 'range') {
        params.set('from', exportFrom);
        params.set('to', exportTo);
      }

      const res = await fetch(`/api/admin/pos-sync/sales-export?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Export failed (HTTP ${res.status})`);
      }

      const batchId = res.headers.get('X-Export-Batch-Id') || 'sales-sheet';
      const markedCount = res.headers.get('X-Marked-Exported-Count') || '0';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const ext = exportFormat.toLowerCase();
      const link = document.createElement('a');
      link.href = url;
      link.download = `sphere-pos-sales-${batchId.toLowerCase()}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success(
        markExported && Number(markedCount) > 0
          ? `Downloaded ${exportFormat} (${batchId}) and marked ${markedCount} sale(s) Exported`
          : `Downloaded ${exportFormat} daily sales sheet (${batchId})`
      );
      await fetchAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not export sales report');
    } finally {
      setExporting(false);
    }
  };

  const handleCsvUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      toast.error('Please select a BandaGo catalog CSV file first.');
      return;
    }

    try {
      setUploadingCsv(true);
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('trigger', 'CSV_IMPORT');

      const res = await fetch('/api/integrations/bandago/csv-import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const result = await res.json().catch(() => ({}));

      if (res.ok && result.success !== false) {
        toast.success(`Imported ${result.upserted ?? 0} product(s) from BandaGo CSV`);
        setSelectedFile(null);
        await fetchAll();
        onRefresh?.();
      } else {
        throw new Error(result.error || 'CSV import failed');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Network error during CSV import');
    } finally {
      setUploadingCsv(false);
    }
  };

  const hb = statusData?.bridgeHeartbeat;
  const heartbeatFresh =
    hb?.reportedAt && Date.now() - Date.parse(hb.reportedAt) < 15 * 60 * 1000;

  const jobs = reconcileData?.jobs ?? [];
  const filteredJobs = jobs.filter((j) => {
    if (jobFilter === 'OPEN') {
      return ['PENDING', 'PROCESSING', 'EXPORTED', 'FAILED', 'SKIPPED_UNMAPPED'].includes(j.status);
    }
    if (jobFilter === 'EXPORTED') return j.status === 'EXPORTED';
    if (jobFilter === 'FAILED') return j.status === 'FAILED' || j.status === 'SKIPPED_UNMAPPED';
    return true;
  });

  const incidents = reconcileData?.incidents ?? [];
  const filteredIncidents = incidents.filter((inc) => {
    if (incidentFilter === 'OPEN') return !inc.resolved;
    if (incidentFilter === 'CRITICAL') return !inc.resolved && inc.severity === 'CRITICAL';
    return true;
  });

  const varianceItems = reconcileData?.varianceItems ?? [];

  if (loading && !statusData) {
    return (
      <div className="space-y-6">
        <AdminSectionHeader
          title="BandaGo POS Integration Hub"
          subtitle="Two-way inventory sync, stagnant-POS drift protection, daily sales export, and error telemetry."
        />
        <KpiSkeletonGrid count={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminSectionHeader
        title="BandaGo POS Integration Hub"
        subtitle="Bi-directional Chrome bridge monitor, stagnant-POS drift protection, daily sales export (PDF/CSV), and structured error remediation."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setActiveTab('reconciliation');
              }}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Export Daily Sales
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchAll()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {loadError && <SectionError message={loadError} onRetry={() => void fetchAll()} />}

      {/* Key Hygiene Warnings */}
      {statusData && (!statusData.apiKeyConfigured || statusData.usingDefaultKeyWarning) && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>
            {!statusData.apiKeyConfigured
              ? 'BANDAGO_SYNC_API_KEY Is Not Configured'
              : 'Insecure Placeholder Sync API Key Detected'}
          </AlertTitle>
          <AlertDescription>
            {!statusData.apiKeyConfigured
              ? 'Automated Chrome extension sync routes fail closed until BANDAGO_SYNC_API_KEY is set on the server (e.g., via env-ops gen-secret).'
              : 'The active BANDAGO_SYNC_API_KEY matches the old example placeholder. Rotate it immediately with env-ops rotate and update your Chrome extension settings.'}
          </AlertDescription>
        </Alert>
      )}

      {/* Critical Incident Alert Banner */}
      {(statusData?.criticalIncidentsCount ?? 0) > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {statusData?.criticalIncidentsCount} Critical POS Sync Incident(s) Require Attention
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Check the Error Console tab for exact BandaGo session, permission, or tenant remediation steps.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveTab('incidents')}
            >
              Open Error Console
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Top KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard
          label="Mapped Products"
          value={statusData?.totalSyncedProducts ?? 0}
          icon={Package}
          tone="teal"
          hint={
            statusData?.lastSyncTimestamp
              ? `Last sync ${formatRelativeTime(statusData.lastSyncTimestamp)}`
              : 'Awaiting first sync'
          }
        />
        <KpiCard
          label="FEFO Batches"
          value={statusData?.totalBatches ?? 0}
          icon={Layers}
          tone="default"
          hint="Lot-tracked warehouse lots"
        />
        <KpiCard
          label="Near-Expiry (<90d)"
          value={statusData?.nearExpiryCount ?? 0}
          icon={AlertTriangle}
          tone={(statusData?.nearExpiryCount ?? 0) > 0 ? 'amber' : 'emerald'}
          hint="FEFO watch items in stock"
        />
        <KpiCard
          label="Pending Outbound"
          value={statusData?.pendingOutboundCount ?? 0}
          icon={ArrowUpRight}
          tone={(statusData?.pendingOutboundCount ?? 0) > 0 ? 'amber' : 'emerald'}
          hint={
            (statusData?.exportedAwaitingConfirmCount ?? 0) > 0
              ? `${statusData?.exportedAwaitingConfirmCount} exported awaiting confirm`
              : `${statusData?.syncedOutboundTodayCount ?? 0} synced today`
          }
          onClick={() => setActiveTab('reconciliation')}
        />
        <KpiCard
          label="Drift-Protected Units"
          value={statusData?.unreconciledUnitsTotal ?? 0}
          icon={ShieldCheck}
          tone="violet"
          hint={
            policyDraft.protectUnreconciledSales
              ? 'Guarded against stagnant POS'
              : 'Drift guard paused'
          }
          onClick={() => setActiveTab('reconciliation')}
        />
        <KpiCard
          label="Open Incidents"
          value={statusData?.openIncidentsCount ?? 0}
          icon={XCircle}
          tone={(statusData?.openIncidentsCount ?? 0) > 0 ? 'rose' : 'emerald'}
          hint={
            (statusData?.failedOutboundCount ?? 0) > 0
              ? `${statusData?.failedOutboundCount} failed writeback(s)`
              : 'Error console healthy'
          }
          onClick={() => setActiveTab('incidents')}
        />
      </div>

      {/* Main 4-Tab Workspace */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        className="space-y-4"
      >
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto">
          <TabsTrigger value="overview">Overview & Policy</TabsTrigger>
          <TabsTrigger value="reconciliation">
            Sales Export & Reconciliation
            {((statusData?.pendingOutboundCount ?? 0) + (statusData?.exportedAwaitingConfirmCount ?? 0)) > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {(statusData?.pendingOutboundCount ?? 0) +
                  (statusData?.exportedAwaitingConfirmCount ?? 0)}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="incidents">
            Error Console
            {(statusData?.openIncidentsCount ?? 0) > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-[10px]">
                {statusData?.openIncidentsCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="audit">Synchronization Audit Trail</TabsTrigger>
        </TabsList>

        {/* ================= TAB 1: OVERVIEW & POLICY ================= */}
        <TabsContent value="overview" className="space-y-4">
          {/* Bridge Heartbeat Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-emerald-600" />
                  <div>
                    <CardTitle className="text-base">
                      Chrome Extension Bridge Health
                    </CardTitle>
                    <CardDescription>
                      Live Zero-PHI heartbeat from dispensary Chrome workstation
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={heartbeatFresh ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}>
                    {heartbeatFresh ? 'Bridge Online' : hb ? 'Heartbeat Stale' : 'No Heartbeat Yet'}
                  </Badge>
                  {hb && (
                    <Badge variant={hb.bandagoTabOpen ? 'outline' : 'secondary'}>
                      {hb.bandagoTabOpen ? 'BandaGo Tab Open' : 'No BandaGo Tab Open'}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg border bg-muted/30">
                <span className="text-muted-foreground block">Last Heartbeat</span>
                <span className="font-semibold text-sm">
                  {hb?.reportedAt ? formatRelativeTime(hb.reportedAt) : 'Awaiting extension'}
                </span>
              </div>
              <div className="p-3 rounded-lg border bg-muted/30">
                <span className="text-muted-foreground block">Tenant Pin (AD_Client_UU)</span>
                <span className="font-mono font-semibold text-xs truncate block">
                  {hb?.tenantUU || policyDraft.expectedTenantUU || 'Auto (Unpinned)'}
                </span>
              </div>
              <div className="p-3 rounded-lg border bg-muted/30">
                <span className="text-muted-foreground block">Last POS → Web Poll</span>
                <span className="font-semibold text-sm">
                  {hb?.lastInboundPollAt
                    ? `${formatRelativeTime(hb.lastInboundPollAt)} (${hb.lastInboundPollOk ? 'OK' : 'Attention'})`
                    : 'Not reported'}
                </span>
              </div>
              <div className="p-3 rounded-lg border bg-muted/30">
                <span className="text-muted-foreground block">Last Web → POS Push</span>
                <span className="font-semibold text-sm">
                  {hb?.lastOutboundRunAt
                    ? `${formatRelativeTime(hb.lastOutboundRunAt)} (${hb.lastOutboundOk ? 'OK' : 'Attention'})`
                    : policyDraft.outboundSyncMode === 'AUTO_SYNC'
                      ? 'Awaiting run'
                      : 'Manual Export Mode'}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Outbound Sync Policy Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowLeftRight className="h-4 w-4 text-primary" />
                  Website → BandaGo POS Outbound Strategy
                </CardTitle>
                <CardDescription>
                  Choose between daily signed sales exports or automatic Physical Inventory writebacks into BandaGo.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <RadioGroup
                  value={policyDraft.outboundSyncMode}
                  onValueChange={(val) => handleModeSelection(val as OutboundSyncMode)}
                  disabled={!isAdmin || savingPolicy}
                  className="space-y-3"
                >
                  <label
                    htmlFor="mode-manual"
                    className="flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer hover:bg-muted/40 transition"
                  >
                    <RadioGroupItem value="MANUAL_EXPORT" id="mode-manual" className="mt-1" />
                    <div className="space-y-1">
                      <div className="font-semibold text-sm flex items-center gap-2">
                        Manual Daily Sales Export (Default)
                        <Badge variant="outline">Recommended Starting Mode</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Online sales accumulate cleanly in the Reconciliation Ledger. Export daily PDF/CSV sheets at closing, record them in BandaGo, and click Confirm Entered.
                      </p>
                    </div>
                  </label>

                  <label
                    htmlFor="mode-auto"
                    className="flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer hover:bg-muted/40 transition"
                  >
                    <RadioGroupItem value="AUTO_SYNC" id="mode-auto" className="mt-1" />
                    <div className="space-y-1">
                      <div className="font-semibold text-sm flex items-center gap-2">
                        Automatic Two-Way POS Sync
                        <Badge className="bg-emerald-600 text-white">Live Writeback</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Chrome extension automatically executes idempotent BandaGo Physical Inventory documents (M_InventorySave → M_InventoryProcess Complete) via the dispensary tab.
                      </p>
                    </div>
                  </label>
                </RadioGroup>

                {policyDraft.outboundSyncMode === 'AUTO_SYNC' && (
                  <div className="space-y-3 pt-2 border-t text-sm">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="auto-sales" className="text-xs font-medium">
                        Auto-deduct Paid / Fulfilled Online Orders in BandaGo
                      </Label>
                      <Switch
                        id="auto-sales"
                        checked={policyDraft.autoSyncOnlineSales}
                        disabled={!isAdmin || savingPolicy}
                        onCheckedChange={(checked) =>
                          void handleSavePolicy({ autoSyncOnlineSales: checked })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="auto-edits" className="text-xs font-medium">
                        Auto-push Admin Stock Count Edits to BandaGo
                      </Label>
                      <Switch
                        id="auto-edits"
                        checked={policyDraft.autoSyncStockEdits}
                        disabled={!isAdmin || savingPolicy}
                        onCheckedChange={(checked) =>
                          void handleSavePolicy({ autoSyncStockEdits: checked })
                        }
                      />
                    </div>
                  </div>
                )}

                {!isAdmin && (
                  <p className="text-xs text-muted-foreground">
                    Policy switches are locked to <strong>ADMIN</strong> role. Pharmacists may still export daily sales and reconcile counts.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Inbound Drift Protection & Safety Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Stagnant-POS Drift Protection & Inbound Guards
                </CardTitle>
                <CardDescription>
                  Prevents stale BandaGo stock counts from resurrecting items sold online before POS entry.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-emerald-50/40 dark:bg-emerald-950/20">
                  <div>
                    <Label htmlFor="drift-guard" className="font-semibold text-sm">
                      Protect Unreconciled Online Sales
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Subtracts open/unreconciled sales and unpaid checkout holds from incoming BandaGo snapshots automatically.
                    </p>
                  </div>
                  <Switch
                    id="drift-guard"
                    checked={policyDraft.protectUnreconciledSales}
                    disabled={!isAdmin || savingPolicy}
                    onCheckedChange={(checked) =>
                      void handleSavePolicy(
                        { protectUnreconciledSales: checked },
                        checked ? 'Stagnant-POS drift protection enabled' : 'Drift protection paused'
                      )
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-4 p-3 rounded-lg border">
                  <div>
                    <Label htmlFor="inbound-enabled" className="font-semibold text-sm">
                      Accept BandaGo → Website Inbound Sync
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Uncheck to temporarily pause catalog/stock updates arriving from the extension.
                    </p>
                  </div>
                  <Switch
                    id="inbound-enabled"
                    checked={policyDraft.inboundEnabled}
                    disabled={!isAdmin || savingPolicy}
                    onCheckedChange={(checked) =>
                      void handleSavePolicy(
                        { inboundEnabled: checked },
                        checked ? 'Inbound POS sync resumed' : 'Inbound POS sync paused'
                      )
                    }
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="tenant-uu" className="text-xs">
                      Expected Tenant UU (AD_Client_UU)
                    </Label>
                    <Input
                      id="tenant-uu"
                      value={policyDraft.expectedTenantUU ?? ''}
                      disabled={!isAdmin || savingPolicy}
                      placeholder="Optional single-clinic UU pin"
                      onChange={(e) =>
                        setPolicyDraft((prev) => ({
                          ...prev,
                          expectedTenantUU: e.target.value || null,
                        }))
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="min-shelf" className="text-xs">
                      FEFO Minimum Shelf Life (Days)
                    </Label>
                    <Input
                      id="min-shelf"
                      type="number"
                      min={0}
                      max={365}
                      disabled={!isAdmin || savingPolicy}
                      value={policyDraft.minShelfLifeDays}
                      onChange={(e) =>
                        setPolicyDraft((prev) => ({
                          ...prev,
                          minShelfLifeDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)),
                        }))
                      }
                      className="text-xs"
                    />
                  </div>
                </div>

                {isAdmin && (
                  <Button
                    size="sm"
                    disabled={savingPolicy}
                    onClick={() =>
                      void handleSavePolicy({
                        expectedTenantUU: policyDraft.expectedTenantUU,
                        minShelfLifeDays: policyDraft.minShelfLifeDays,
                      })
                    }
                  >
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    Save Tenant & FEFO Settings
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ================= TAB 2: SALES EXPORT & RECONCILIATION ================= */}
        <TabsContent value="reconciliation" className="space-y-4">
          {/* Exported Awaiting Confirmation Banner */}
          {(statusData?.exportedAwaitingConfirmCount ?? 0) > 0 && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-sky-600" />
              <AlertTitle>
                {statusData?.exportedAwaitingConfirmCount} Exported Sales Line(s) Awaiting BandaGo Confirmation
              </AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2 mt-1">
                <span>
                  Once you finish punching the downloaded sales sheet into BandaGo POS, mark them reconciled so inbound drift protection clears cleanly.
                </span>
                <Button
                  size="sm"
                  disabled={actionLoadingId === 'confirm-exported'}
                  onClick={() =>
                    void runReconcileAction(
                      { action: 'MARK_RECONCILED' },
                      'Confirmed exported sales entered in BandaGo POS',
                      'confirm-exported'
                    )
                  }
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Confirm Entered in BandaGo POS
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Daily Sales Export Generator */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Daily Online Sales & POS Deduction Export (Zero-PHI)
              </CardTitle>
              <CardDescription>
                Download printable pharmacist reconciliation sheets (PDF) or spreadsheet CSV/JSON batches without patient PII.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Export Format</Label>
                  <Select
                    value={exportFormat}
                    onValueChange={(v) => setExportFormat(v as PreferredExportFormat)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PDF">PDF Reconciliation Sheet</SelectItem>
                      <SelectItem value="CSV">CSV Spreadsheet (BOM Safe)</SelectItem>
                      <SelectItem value="JSON">JSON Structured Batch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Scope</Label>
                  <Select
                    value={exportScope}
                    onValueChange={(v) => setExportScope(v as typeof exportScope)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unreconciled">Unreconciled Since Last Export</SelectItem>
                      <SelectItem value="today">Today (Nairobi EAT)</SelectItem>
                      <SelectItem value="range">Custom Date Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Grouping</Label>
                  <Select
                    value={exportGroupBy}
                    onValueChange={(v) => setExportGroupBy(v as ExportGroupBy)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRODUCT_SUMMARY">Grouped by Medication</SelectItem>
                      <SelectItem value="ITEMIZED_ORDERS">Itemized Order Lines</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-end">
                  <Button
                    className="w-full"
                    disabled={exporting}
                    onClick={() => void handleDownloadSalesExport()}
                  >
                    {exportFormat === 'PDF' ? (
                      <FileText className="h-4 w-4 mr-1.5" />
                    ) : (
                      <FileSpreadsheet className="h-4 w-4 mr-1.5" />
                    )}
                    {exporting ? 'Preparing...' : `Download ${exportFormat} Sheet`}
                  </Button>
                </div>
              </div>

              {exportScope === 'range' && (
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="exp-from" className="text-xs">From:</Label>
                    <Input
                      id="exp-from"
                      type="date"
                      value={exportFrom}
                      onChange={(e) => setExportFrom(e.target.value)}
                      className="w-40 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="exp-to" className="text-xs">To:</Label>
                    <Input
                      id="exp-to"
                      type="date"
                      value={exportTo}
                      onChange={(e) => setExportTo(e.target.value)}
                      className="w-40 text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="mark-exported"
                  checked={markExported}
                  onCheckedChange={(checked) => setMarkExported(checked === true)}
                />
                <Label htmlFor="mark-exported" className="text-xs text-muted-foreground cursor-pointer">
                  Mark pending deductions as <strong>Exported</strong> in this batch so they aren&apos;t double-counted tomorrow.
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Outbound Reconciliation Queue */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Outbound Sales & Stock Edit Queue</CardTitle>
                  <CardDescription>
                    Every online sale, refund restock, or manual Sphere stock change tracked for POS reconciliation.
                  </CardDescription>
                </div>
                <Select
                  value={jobFilter}
                  onValueChange={(v) => setJobFilter(v as typeof jobFilter)}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Open / Active</SelectItem>
                    <SelectItem value="EXPORTED">Exported Only</SelectItem>
                    <SelectItem value="FAILED">Failed / Unmapped</SelectItem>
                    <SelectItem value="ALL">All Recent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {filteredJobs.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No outbound jobs match this filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Event / Ref</TableHead>
                        <TableHead>Medication</TableHead>
                        <TableHead className="text-right">Delta</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>POS Doc / Error</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredJobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatRelativeTime(job.createdAt)}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="font-medium">{job.eventType}</div>
                            {job.orderReference && (
                              <div className="font-mono text-[11px] text-muted-foreground">
                                {job.orderReference}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs max-w-[220px]">
                            <div className="font-medium truncate">{job.productName}</div>
                            <div className="font-mono text-[11px] text-muted-foreground truncate">
                              {job.sku || 'No SKU'} {job.externalPosId ? `· ${job.externalPosId.slice(0, 8)}` : '· Unmapped'}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-xs">
                            <span className={job.qtyDelta < 0 ? 'text-rose-600' : 'text-emerald-600'}>
                              {job.qtyDelta > 0 ? `+${job.qtyDelta}` : job.qtyDelta}
                            </span>
                          </TableCell>
                          <TableCell>{getJobStatusBadge(job.status)}</TableCell>
                          <TableCell className="text-xs max-w-[220px]">
                            {job.externalDocumentNo ? (
                              <span className="font-mono text-emerald-700 dark:text-emerald-400">
                                Doc #{job.externalDocumentNo}
                              </span>
                            ) : job.lastError ? (
                              <span className="text-rose-600 break-words line-clamp-2" title={job.lastError}>
                                {job.lastErrorCode ? `[${job.lastErrorCode}] ` : ''}
                                {job.lastError}
                              </span>
                            ) : job.exportBatchId ? (
                              <span className="font-mono text-muted-foreground">{job.exportBatchId}</span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap space-x-1">
                            {['PENDING', 'EXPORTED', 'FAILED', 'SKIPPED_UNMAPPED'].includes(job.status) && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={actionLoadingId === job.id}
                                onClick={() =>
                                  void runReconcileAction(
                                    { action: 'MARK_RECONCILED', jobIds: [job.id] },
                                    `Marked ${job.productName} reconciled`,
                                    job.id
                                  )
                                }
                              >
                                Confirm
                              </Button>
                            )}
                            {['FAILED', 'SKIPPED_UNMAPPED'].includes(job.status) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={actionLoadingId === job.id}
                                onClick={() =>
                                  void runReconcileAction(
                                    { action: 'RETRY_JOBS', jobIds: [job.id] },
                                    `Re-queued ${job.productName} for writeback`,
                                    job.id
                                  )
                                }
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Live Stock Variance & Drift Protection Inspector */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Live Stock Variance & Drift Protection Inspector</CardTitle>
                  <CardDescription>
                    Products where BandaGo POS snapshot differs from Sphere stock or carries protected online offsets.
                  </CardDescription>
                </div>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmBaselineOpen(true)}
                  >
                    Set Baseline Cutover Now
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {varianceItems.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground flex flex-col items-center gap-2">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                  <span>All BandaGo-mapped medications match between Sphere and POS.</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Last POS Snapshot</TableHead>
                        <TableHead className="text-right">Sphere Stock</TableHead>
                        <TableHead className="text-right">Pending Offset</TableHead>
                        <TableHead className="text-right">Unpaid Holds</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {varianceItems.map((row) => (
                        <TableRow key={row.productId}>
                          <TableCell className="text-xs">
                            <div className="font-medium">{row.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">{row.sku}</div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {row.lastPosStock ?? '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-xs">
                            {row.sphereStockQty}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {row.pendingOutboundNetDelta}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {row.unpaidOrderHoldQty + row.virtualReservedStock}
                          </TableCell>
                          <TableCell>
                            {row.status === 'DRIFT_PROTECTED' ? (
                              <Badge className="bg-violet-600 text-white">Drift Protected</Badge>
                            ) : (
                              <Badge variant="outline" className="border-amber-500 text-amber-700">
                                Variance
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={actionLoadingId === row.productId}
                              onClick={() =>
                                void runReconcileAction(
                                  { action: 'QUEUE_STOCK_PUSH', productId: row.productId },
                                  `Queued push of ${row.sphereStockQty} unit(s) for ${row.name}`,
                                  row.productId
                                )
                              }
                            >
                              Queue Push to POS
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= TAB 3: ERROR CONSOLE ================= */}
        <TabsContent value="incidents" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Error Console & Remediation Center</CardTitle>
                  <CardDescription>
                    Deduplicated Zero-PHI integration incidents with exact troubleshooting instructions.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={incidentFilter}
                    onValueChange={(v) => setIncidentFilter(v as typeof incidentFilter)}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPEN">Open Incidents</SelectItem>
                      <SelectItem value="CRITICAL">Critical Only</SelectItem>
                      <SelectItem value="ALL">All History</SelectItem>
                    </SelectContent>
                  </Select>
                  {(statusData?.openIncidentsCount ?? 0) > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionLoadingId === 'resolve-all'}
                      onClick={() =>
                        void runReconcileAction(
                          { action: 'RESOLVE_ALL_INCIDENTS' },
                          'Resolved all open incidents',
                          'resolve-all'
                        )
                      }
                    >
                      Resolve All Open
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {filteredIncidents.length === 0 ? (
                <div className="text-center py-10 text-sm text-muted-foreground flex flex-col items-center gap-2">
                  <CheckCircle2 className="h-7 w-7 text-emerald-600" />
                  <span>No matching incidents reported.</span>
                </div>
              ) : (
                filteredIncidents.map((inc) => (
                  <div
                    key={inc.id}
                    className={`p-4 rounded-lg border space-y-2 ${
                      inc.resolved
                        ? 'bg-muted/30 opacity-75'
                        : inc.severity === 'CRITICAL'
                          ? 'border-destructive/50 bg-destructive/5'
                          : 'bg-card'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            inc.severity === 'CRITICAL' || inc.severity === 'ERROR'
                              ? 'destructive'
                              : 'secondary'
                          }
                        >
                          {inc.severity}
                        </Badge>
                        <Badge variant="outline">{inc.direction}</Badge>
                        <span className="font-mono text-xs font-semibold">{inc.code}</span>
                        <span className="text-xs text-muted-foreground">
                          ×{inc.occurrences} · last seen {formatRelativeTime(inc.lastSeenAt)}
                        </span>
                      </div>
                      {!inc.resolved ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionLoadingId === inc.id}
                          onClick={() =>
                            void runReconcileAction(
                              { action: 'RESOLVE_INCIDENT', incidentId: inc.id },
                              `Resolved ${inc.code}`,
                              inc.id
                            )
                          }
                        >
                          Mark Resolved
                        </Button>
                      ) : (
                        <Badge variant="outline" className="text-emerald-700">
                          Resolved {inc.resolvedBy ? `by ${inc.resolvedBy}` : ''}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium">{inc.message}</p>
                    {(inc.productName || inc.orderReference) && (
                      <p className="text-xs text-muted-foreground font-mono">
                        {inc.productName ? `Product: ${inc.productName}` : ''}
                        {inc.productName && inc.orderReference ? ' · ' : ''}
                        {inc.orderReference ? `Order: ${inc.orderReference}` : ''}
                      </p>
                    )}
                    {inc.remediation && (
                      <div className="text-xs p-2.5 rounded bg-muted/60 border text-muted-foreground">
                        <strong className="text-foreground">Remediation: </strong>
                        {inc.remediation}
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= TAB 4: AUDIT TRAIL & CSV IMPORT ================= */}
        <TabsContent value="audit" className="space-y-4">
          {/* Manual CSV Import Fallback */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle className="text-base">Manual CSV Catalog Sync Fallback</CardTitle>
                  <CardDescription>
                    Upload exported BandaGo product/inventory CSV directly via your authenticated staff session.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void handleCsvUpload(e)} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="max-w-md cursor-pointer"
                />
                <Button type="submit" disabled={!selectedFile || uploadingCsv}>
                  <UploadCloud className="h-4 w-4 mr-1.5" />
                  {uploadingCsv ? 'Processing CSV...' : 'Import & Sync Stock'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Synchronization Audit Trail Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Synchronization Audit Trail</CardTitle>
                  <CardDescription>
                    Most recent 25 inbound & outbound sync transactions processed by Sphere Pharmacy.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!statusData || statusData.recentLogs.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground flex flex-col items-center gap-2">
                  <Clock className="h-7 w-7 opacity-40" />
                  <span>No synchronization logs recorded yet.</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Direction</TableHead>
                        <TableHead>Trigger</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Processed</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statusData.recentLogs.map((log) => {
                        const firstErr = log.details?.errors?.[0];
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(log.startedAt).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              {log.direction === 'OUTBOUND' ? (
                                <Badge variant="outline" className="gap-1">
                                  <ArrowUpRight className="h-3 w-3 text-sky-600" />
                                  OUTBOUND
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="gap-1">
                                  <ArrowDownLeft className="h-3 w-3 text-emerald-600" />
                                  INBOUND
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{log.trigger}</TableCell>
                            <TableCell>
                              {log.status === 'SUCCESS' ? (
                                <Badge className="bg-emerald-600 text-white">SUCCESS</Badge>
                              ) : log.status === 'PARTIAL' ? (
                                <Badge className="bg-amber-600 text-white">PARTIAL</Badge>
                              ) : (
                                <Badge variant="destructive">FAILED</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs font-mono">
                              {log.itemsUpserted}/{log.itemsReceived}
                              {(log.itemsFailed ?? 0) > 0 && (
                                <span className="text-rose-600 ml-1">({log.itemsFailed} err)</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground font-mono">
                              {log.durationMs}ms
                            </TableCell>
                            <TableCell className="text-xs max-w-[260px]">
                              {log.details?.fatalError ? (
                                <span className="text-rose-600 break-words">{log.details.fatalError}</span>
                              ) : firstErr ? (
                                <span className="text-amber-700 break-words">
                                  {firstErr.name || firstErr.externalPosId}: {firstErr.error}
                                </span>
                              ) : log.details?.message ? (
                                <span className="text-muted-foreground">{log.details.message}</span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialog: Enable Auto Two-Way Sync */}
      <AlertDialog open={confirmAutoSyncOpen} onOpenChange={setConfirmAutoSyncOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable Automatic Website → BandaGo Sync?</AlertDialogTitle>
            <AlertDialogDescription>
              When enabled, Sphere Pharmacy will automatically dispatch pending online order deductions and admin stock edits into BandaGo as Completed Physical Inventory adjustments whenever an authenticated go.bandahealth.org Chrome tab is open.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Manual Export</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmAutoSyncOpen(false);
                void handleSavePolicy(
                  { outboundSyncMode: 'AUTO_SYNC' },
                  'Enabled Automatic Two-Way POS Sync'
                );
              }}
            >
              Enable Automatic Two-Way Sync
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation Dialog: Set Reconciliation Baseline Now */}
      <AlertDialog open={confirmBaselineOpen} onOpenChange={setConfirmBaselineOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set Reconciliation Baseline Cutover Now?</AlertDialogTitle>
            <AlertDialogDescription>
              Use this after completing a full physical shelf count in BandaGo so historical unpaid holds do not skew future inbound stock syncs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 py-2">
            <Checkbox
              id="clear-open-baseline"
              checked={markOpenOnBaseline}
              onCheckedChange={(checked) => setMarkOpenOnBaseline(checked === true)}
            />
            <Label htmlFor="clear-open-baseline" className="text-xs cursor-pointer">
              Also mark all open pre-cutover outbound jobs as manually reconciled
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmBaselineOpen(false);
                void runReconcileAction(
                  { action: 'SET_BASELINE_NOW', markOpenAsReconciled: markOpenOnBaseline },
                  'Reconciliation baseline cutover saved',
                  'baseline'
                );
              }}
            >
              Confirm Baseline Cutover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
