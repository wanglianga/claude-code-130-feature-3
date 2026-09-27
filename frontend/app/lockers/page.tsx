'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import { api, fmt, yuan } from '../lib';

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
    setScanMsg(`扫描完成：共 ${r.scanned} 个占用柜位，新标记临期 ${r.expiring} 个、过期 ${r.expired} 个（同时生成对应回访任务）`);
    load();
  }
  async function renew(l: any) {
    await api('POST', `/api/lockers/${l.id}/renew`, { months: 12 });
    load();
  }

  return (
    <AppShell>
      <div className="section-title">
        <h1 style={{ margin: 0 }}>寄存柜位管理（年费制）</h1>
        <span className="spacer" style={{ flex: 1 }} />
        <button onClick={scan}>扫描到期状态</button>
      </div>
      {scanMsg && <div className="ok-msg">{scanMsg}</div>}
      <div className="panel">
        <p className="muted">到期前 30 天自动标记「临期」并生成续费提醒回访；到期未续费标记「过期」并生成跟进任务；续费后自动关闭待办提醒。</p>
        <div className="pill-actions">
          {[['', '全部'], ['free', '空闲'], ['occupied', '占用中'], ['expiring', '临期(30天内)'], ['expired', '已过期']].map(([k, l]) =>
            <button key={l} className={status === k ? '' : 'ghost'} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>柜位编号</th><th>门店</th><th>等级</th><th>状态</th><th>对应宠物/工单</th><th>入存</th><th>到期</th><th>年费</th><th></th></tr></thead>
          <tbody>
            {items.map(l => (
              <tr key={l.id}>
                <td className="mono"><b>{l.code}</b></td>
                <td>#{l.store_id} 号店</td>
                <td>{l.tier === 'premium' ? '尊享柜 980/年' : '标准柜 600/年'}</td>
                <td><span className={`tag ${l.status === 'free' ? 'ok' : l.status === 'occupied' ? 'info' : 'bad'}`}>
                  {({ free: '空闲', occupied: '占用中', expiring: '临期', expired: '已过期' } as any)[l.status]}</span></td>
                <td>{l.appointment_id ? <>
                  {appts[l.appointment_id]?.pet_name || `#${l.appointment_id}`}
                  <div className="muted mono">{appts[l.appointment_id]?.code}</div>
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
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
