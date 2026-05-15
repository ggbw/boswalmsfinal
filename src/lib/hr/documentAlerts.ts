/**
 * Document expiry alerts (ported from motho2/src/lib/documentAlerts.ts).
 *
 * Two entry points:
 *
 *   scanExpiringDocuments({ today? })
 *     Pure read — returns the list of expiring/expired employee documents
 *     with a classification and a human-readable message. NO writes. Safe to
 *     call from a dashboard widget or report.
 *
 *   checkDocumentExpiry(adminUserId)
 *     Full motho2 behavior: writes per-user notification rows (to the
 *     `hr_notifications` table — see migration 20260514000001_hr_notifications.sql)
 *     and marks alert_sent_30 / alert_sent_7 flags on employee_documents so
 *     the same doc isn't re-alerted on the next scan.
 */

import { supabase } from '@/integrations/supabase/client';
import { differenceInDays, format } from 'date-fns';
import { writeNotifications, type NotificationType } from '@/lib/hr/notificationService';

export type DocumentExpiryClass = 'expired' | '7_day_warning' | '30_day_warning';

export interface ExpiringDocument {
  id: string;
  employee_id: string | null;
  employee_name: string;
  document_type: string;
  expiry_date: string;
  days_left: number;
  expiry_class: DocumentExpiryClass;
  message: string;
  alert_sent_30: boolean | null;
  alert_sent_7: boolean | null;
}

function classify(daysLeft: number): DocumentExpiryClass | null {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 7) return '7_day_warning';
  if (daysLeft <= 30) return '30_day_warning';
  return null;
}

function buildMessage(cls: DocumentExpiryClass, empName: string, docType: string, daysLeft: number, expiryStr: string): string {
  switch (cls) {
    case 'expired':
      return `EXPIRED: ${empName}'s ${docType} expired on ${expiryStr}`;
    case '7_day_warning':
      return `URGENT: ${empName}'s ${docType} expires in ${daysLeft} day(s) — ${expiryStr}`;
    case '30_day_warning':
      return `EXPIRING SOON: ${empName}'s ${docType} expires in ${daysLeft} days — ${expiryStr}`;
  }
}

/**
 * Pure read. Returns expired/expiring active employee documents with
 * classification and a human-readable message. Already-acknowledged alerts
 * (alert_sent_7 set for the 7-day or expired class, alert_sent_30 for the
 * 30-day class) are excluded so the caller only sees fresh items.
 */
export async function scanExpiringDocuments(opts?: { today?: Date }): Promise<ExpiringDocument[]> {
  const today = opts?.today ?? new Date();

  const { data: docs } = await supabase
    .from('employee_documents')
    .select('id,employee_id,expiry_date,alert_sent_30,alert_sent_7,employees(employee_name),document_types(name)')
    .not('expiry_date', 'is', null)
    .eq('is_active', true);

  const out: ExpiringDocument[] = [];
  for (const doc of (docs ?? []) as Array<Record<string, unknown>>) {
    const expiryRaw = doc.expiry_date as string | null;
    if (!expiryRaw) continue;
    const expiry = new Date(expiryRaw);
    const daysLeft = differenceInDays(expiry, today);
    const cls = classify(daysLeft);
    if (!cls) continue;

    // Skip alerts already acknowledged — matches motho2's gating.
    const alert30 = (doc.alert_sent_30 as boolean | null) ?? null;
    const alert7  = (doc.alert_sent_7 as boolean | null) ?? null;
    if (cls === 'expired' && alert7) continue;
    if (cls === '7_day_warning' && alert7) continue;
    if (cls === '30_day_warning' && alert30) continue;

    const emp = doc.employees as { employee_name?: string } | null;
    const dtype = doc.document_types as { name?: string } | null;
    const empName = emp?.employee_name ?? 'Employee';
    const docType = dtype?.name ?? 'Document';
    const expiryStr = format(expiry, 'dd MMM yyyy');

    out.push({
      id: doc.id as string,
      employee_id: (doc.employee_id as string | null) ?? null,
      employee_name: empName,
      document_type: docType,
      expiry_date: expiryRaw,
      days_left: daysLeft,
      expiry_class: cls,
      message: buildMessage(cls, empName, docType, daysLeft, expiryStr),
      alert_sent_30: alert30,
      alert_sent_7: alert7,
    });
  }
  return out;
}

async function insertHrNotification(userId: string, type: DocumentExpiryClass, message: string) {
  const title =
    type === 'expired' ? 'Document Expired' :
    type === '7_day_warning' ? 'Document Expiring Urgently' :
    'Document Expiring Soon';
  // Routes through the shared HR notification service, which writes to
  // hr_notifications and is best-effort (silent on schema-missing).
  await writeNotifications({
    userIds: [userId],
    title,
    message,
    type: type as NotificationType,
  });
}

async function markAlerts(docId: string, sent30: boolean | null, sent7: boolean | null) {
  const payload: Record<string, boolean> = {};
  if (sent30 !== null) payload.alert_sent_30 = sent30;
  if (sent7 !== null) payload.alert_sent_7 = sent7;
  if (Object.keys(payload).length === 0) return;
  await supabase.from('employee_documents').update(payload).eq('id', docId);
}

/**
 * Full motho2 behavior: scan + write a notification row per expiring doc + set
 * alert flags so the same doc isn't re-alerted. See header comment for the
 * notifications-table schema this assumes.
 */
export async function checkDocumentExpiry(adminUserId: string): Promise<{ alerted: number }> {
  const items = await scanExpiringDocuments();
  for (const item of items) {
    await insertHrNotification(adminUserId, item.expiry_class, item.message);
    if (item.expiry_class === 'expired' || item.expiry_class === '7_day_warning') {
      await markAlerts(item.id, null, true);
    } else {
      await markAlerts(item.id, true, null);
    }
  }
  return { alerted: items.length };
}
