'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import { api, fmt, getSession, PET_LABEL, STATUS_LABEL, statusTag, yuan } from '../lib';

export default function AppointmentsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [s, setS] = useState<any>(null);
  useEffect(() => setS(getSession()), []);

  async function load() {
    if (!getSession()) return;
    setLoading(true);
    try {
      const data = await api('GET', `/api/appointments${status ? `?status=${status}` : ''}`);
      setItems(data);
    } finally { setLoading(false); }
  }
  useEffect(() => { if (s) load(); /* eslint-disable-next-line */ }, [status, s]);

  if (!s) return <AppShell><div className="panel">加载中…</div></AppShell>;

  return (
    <AppShell>
      <div className="section-title">
        <h1 style={{ margin: 0 }}>服务工单</h1>
        {s.user.role === 'owner' && <Link className="btn" href="/new">＋ 为善终的 TA 预约</Link>}
        <span className="spacer" style={{ flex: 1 }} />
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 170 }}>
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="panel">
        {loading ? <p className="muted">加载中…</p> : items.length === 0 ? <p className="muted">暂无工单</p> : (
          <table>
            <thead><tr>
              <th>单号</th><th>宠物</th><th>门店/家属</th><th>状态</th>
              <th>承诺接运</th><th>火化时间</th><th>费用</th><th></th>
            </tr></thead>
            <tbody>
              {items.map(a => (
                <tr key={a.id}>
                  <td className="mono">{a.code}</td>
                  <td><b>{a.pet_name}</b><br /><span className="muted">{PET_LABEL[a.pet_type]} · {a.pet_breed} · {a.weight_kg}kg</span></td>
                  <td>#{a.store_id} 号店<br /><span className="muted">{a.need_pickup ? '需上门接送' : '自行送达'}</span></td>
                  <td><span className={`tag ${statusTag(a.status)}`}>{STATUS_LABEL[a.status]}</span></td>
                  <td>{fmt(a.pickup_promised_at)}</td>
                  <td>{fmt(a.furnace_scheduled_at)}</td>
                  <td>{yuan(a.final_amount || a.quote_amount)}</td>
                  <td><Link className="btn ghost small" href={`/appointments/${a.id}`}>进入处理</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
