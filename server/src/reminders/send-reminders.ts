/** One sender for the manual action and tenant worker. Never treat a stub or a claim as delivery. */
/* W2.2: outboxِ رویداد (CONTRACTS §۲) — sms.failed ← کارِ «ارسالِ دوباره»؛ sms.sent آن را می‌بندد. هرگز ارسال را نمی‌شکند. */
async function emitSms(client: any, row: any, type: string, payload: Record<string, unknown>) {
  try {
    await client.domainEvent.create({ data: {
      type, patientId: row.patientId ?? null, visitId: row.visitId ?? null, appointmentId: row.appointmentId ?? null,
      refType: 'reminder', refId: row.id, payload: { kind: row.kind, ...payload },
    } });
  } catch { /* جدولِ رویداد هنوز migrate نشده یا خطای گذرا — یادآوری خودش ثبت شده است */ }
}
export async function sendReminders(client: any, sms: any, ids?: number[]) {
  await client.reminder.updateMany({ where: { status: 'sending', attemptedAt: { lt: new Date(Date.now() - 10 * 60000) } }, data: { status: 'uncertain', error: 'نتیجه ارسال مشخص نشد؛ پیش از ارسال مجدد در سرویس پیامک بررسی شود' } });
  const due = await client.reminder.findMany({ where: { channel: 'sms', status: 'pending', dueAt: { lte: new Date() }, ...(ids ? { id: { in: ids } } : {}) }, orderBy: { dueAt: 'asc' }, take: ids ? 500 : 25 });
  let sent = 0, failed = 0, skipped = 0;
  for (const row of due) {
    const claim = await client.reminder.updateMany({ where: { id: row.id, status: 'pending' }, data: { status: 'sending', attemptedAt: new Date(), error: null } });
    if (!claim.count) { skipped++; continue; }
    let accepted = false;
    try {
      if (!row.phone) throw new Error('شماره‌ای ثبت نشده');
      const result = await sms.send(row.phone, row.text);
      if (!result.sent && !result.stub) throw new Error('سرویس پیامک ارسال را نپذیرفت');
      accepted = result.sent;
      await client.reminder.update({ where: { id: row.id }, data: { status: result.stub ? 'simulated' : 'sent', sentAt: result.sent ? new Date() : null, providerId: result.providerId ?? null, deliveryStatus: result.sent ? 'unknown' : 'not_sent', error: result.stub ? 'حالت آزمایشی؛ پیام واقعی ارسال نشده است' : null } });
      if (result.sent) sent++; else skipped++;
      if (result.sent) await emitSms(client, row, 'sms.sent', { providerId: result.providerId ?? null });
    } catch (e) {
      failed++;
      const uncertain = accepted || (e as any)?.smsOutcome === 'unknown';
      await client.reminder.update({ where: { id: row.id }, data: { status: uncertain ? 'uncertain' : 'failed', sentAt: null, deliveryStatus: uncertain ? 'unknown' : 'not_sent', error: uncertain ? 'نتیجه ارسال مشخص نشد؛ پیش از ارسال مجدد در سرویس پیامک بررسی شود' : String(e instanceof Error ? e.message : e).slice(0, 300) } });
      await emitSms(client, row, uncertain ? 'sms.uncertain' : 'sms.failed', { error: String(e instanceof Error ? e.message : e).slice(0, 300) });
    }
  }
  return { due: due.length, sent, failed, skipped };
}
