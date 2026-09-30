'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import { api, fmt, yuan, LOCKER_STATUS_LABEL } from '../lib';

export default function LockersPage() {
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [appts, setAppts] = useState<Record<number, any>>({});
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
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  async function scan() {
    const r = await api('POST', '/api/lockers/scan');
    setScanMsg(`扫描完成：共 ${r.scanned} 个占用柜位，新标记临期 ${r.expiring} 个、过期 ${r.expired} 个；${r.note}（按家属偏好生成提醒回访）`);
    load();
  }

  const tagCls = (s: string) =>
    s === 'free' ? 'ok' : s === 'occupied' ? 'info' : s === 'protected' ? 'bad' : 'warn';

  return (
    <AppShell>
      <div className="section-title">
        <h1 style={{ margin: 0 }}>寄存柜位管理（年费制）</h1>
        <span className="spacer" style={{ flex: 1 }} />
        <button onClick={scan}>扫描到期状态</button>
      </div>
      {scanMsg && <div className="ok-msg">{scanMsg}</div>}
      <div className="panel">
        <p className="muted">
          到期前 30 天按家属偏好（续费/取回/转长期）与渠道生成提醒；到期未续费经多轮联系无果后进入
          <b style={{ color: 'var(--bad)' }}>「受保护待处置」</b>——柜位不得释放、不得再次分配，须客服主管审批、寄存主管复核后才可处置。
          续费三项校验（柜位可续用/年费变更/未结费用）在工单的寄存面板办理。
        </p>
        <div className="pill-actions">
          {[['', '全部'], ['free', '空闲'], ['occupied', '占用中'], ['expiring', '临期(30天内)'],
            ['expired', '已到期'], ['protected', '受保护待处置']].map(([k, l]) =>
            <button key={l} className={status === k ? '' : 'ghost'} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>柜位编号</th><th>门店</th><th>等级</th><th>状态</th><th>对应宠物/工单</th><th>入存</th><th>到期</th><th>年费</th><th></th></tr></thead>
          <tbody>
            {items.map(l => (
              <tr key={l.id} style={l.status === 'protected' ? { background: '#fbf1ef' } : undefined}>
                <td className="mono"><b>{l.code}</b></td>
                <td>#{l.store_id} 号店</td>
                <td>{l.tier === 'premium' ? '尊享柜 980/年' : '标准柜 600/年'}</td>
                <td><span className={`tag ${tagCls(l.status)}`}>{LOCKER_STATUS_LABEL[l.status] || l.status}</span>
                  {l.status === 'protected' && l.protected_reason &&
                    <div className="muted" style={{ color: 'var(--bad)' }}>{l.protected_reason}</div>}</td>
                <td>{l.appointment_id ? <>
                  {appts[l.appointment_id]?.pet_name || `#${l.appointment_id}`}
                  <div className="muted mono">{appts[l.appointment_id]?.code}</div>
                </> : '—'}</td>
                <td>{fmt(l.occupied_since)}</td>
                <td>{fmt(l.expire_at)}</td>
                <td>{yuan(l.annual_fee)}</td>
                <td>
                  {l.appointment_id &&
                    <Link className="btn ghost small" href={`/appointments/${l.appointment_id}`}>
                      {['occupied', 'expiring', 'expired'].includes(l.status) ? '续费/处置' : '工单'}</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
