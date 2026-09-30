'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import { api, fmt, yuan, LOCKER_STATUS_LABEL } from '../lib';

const STATUS_COLOR: Record<string, string> = {
  free: 'ok', occupied: 'info', expiring: 'warn', expired: 'bad',
  protected: 'bad', reserved: 'warn',
};

export default function LockersPage() {
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [appts, setAppts] = useState<Record<number, any>>({});
  const [cases, setCases] = useState<any[]>([]);
  const [scanMsg, setScanMsg] = useState('');

  async function load() {
    const ls = await api('GET', `/api/lockers${status ? `?status=${status}` : ''}`);
    setItems(ls);
    if (ls.some((l: any) => l.appointment_id)) {
      const as = await api('GET', '/api/appointments');
      const map: Record<number, any> = {};
      as.forEach((x: any) => { map[x.id] = x; });
      setAppts(map);
    }
    try { setCases(await api('GET', '/api/storage/cases')); } catch { setCases([]); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const caseByLocker: Record<number, any> = {};
  cases.forEach(c => { caseByLocker[c.locker_id] = c; });

  async function scan() {
    const r = await api('POST', '/api/storage/scan');
    setScanMsg(`扫描完成：共 ${r.scanned} 个占用柜位，按偏好新发送提醒 ${r.reminders} 个，新标记过期 ${r.expired} 个`);
    load();
  }
  async function renew(l: any) {
    const rc = await api('POST', `/api/storage/appointments/${l.appointment_id}/renew-check`, { months: 12 });
    if (!rc.can_renew) { alert(`续费未通过校验：${rc.block_reasons.join('；') || '存在未结费用'}`); return; }
    await api('POST', `/api/storage/appointments/${l.appointment_id}/renew`,
      { months: 12, acknowledge_price_change: true });
    setScanMsg(`柜位 ${l.code} 已续费 12 个月`);
    load();
  }

  return (
    <AppShell>
      <div className="section-title">
        <h1 style={{ margin: 0 }}>寄存柜位管理（年费制 · 到期处置）</h1>
        <span className="spacer" style={{ flex: 1 }} />
        <button onClick={scan}>扫描到期并按偏好提醒</button>
      </div>
      {scanMsg && <div className="ok-msg">{scanMsg}</div>}
      <div className="panel">
        <p className="muted">
          到期前按主人偏好发送续费/取回/转长期提醒；逾期多轮联系无回应后柜位进入<b>受保护待处置</b>，
          不得释放或再分配；转长期迁移指令会把目标柜位标记为<b>迁移预占</b>，防止重复承诺。
        </p>
        <div className="pill-actions">
          {[['', '全部'], ['free', '空闲'], ['occupied', '占用中'], ['expiring', '临期(30天内)'],
            ['expired', '已过期'], ['protected', '受保护待处置'], ['reserved', '迁移预占']].map(([k, l]) =>
            <button key={l} className={status === k ? '' : 'ghost'} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>柜位编号</th><th>门店</th><th>等级</th><th>状态</th><th>对应宠物/工单</th><th>入存</th><th>到期</th><th>年费</th><th></th></tr></thead>
          <tbody>
            {items.map(l => {
              const c = caseByLocker[l.id];
              return (
                <tr key={l.id} style={l.status === 'protected' ? { background: '#f6e7e4' } : undefined}>
                  <td className="mono"><b>{l.code}</b></td>
                  <td>#{l.store_id} 号店</td>
                  <td>{l.tier === 'premium' ? '尊享柜 980/年' : '标准柜 600/年'}</td>
                  <td><span className={`tag ${STATUS_COLOR[l.status] || ''}`}>{LOCKER_STATUS_LABEL[l.status] || l.status}</span></td>
                  <td>{l.appointment_id ? <>
                    {appts[l.appointment_id]?.pet_name || `#${l.appointment_id}`}
                    <div className="muted mono">{appts[l.appointment_id]?.code}</div>
                    {c && ['contacting', 'awaiting_supervisor', 'awaiting_storage_review', 'ordered'].includes(c.status) &&
                      <Link href="/dispositions" className="tag warn">处置 {c.code}</Link>}
                  </> : '—'}</td>
                  <td>{fmt(l.occupied_since)}</td>
                  <td>{fmt(l.expire_at)}</td>
                  <td>{yuan(l.annual_fee)}</td>
                  <td>
                    {l.appointment_id && ['occupied', 'expiring', 'expired'].includes(l.status) &&
                      <button className="small" onClick={() => renew(l)}>续费 12 月</button>}
                    {l.appointment_id && <Link className="btn ghost small" href={`/appointments/${l.appointment_id}`}>工单</Link>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
