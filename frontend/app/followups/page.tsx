'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import { api, fmt, TRIGGER_LABEL } from '../lib';

export default function FollowupsPage() {
  const [tab, setTab] = useState('scheduled');
  const [items, setItems] = useState<any[]>([]);
  const [appts, setAppts] = useState<Record<number, any>>({});

  async function load() {
    const [fs, as] = await Promise.all([
      api('GET', `/api/followups?status=${tab}`),
      api('GET', '/api/appointments'),
    ]);
    setItems(fs);
    const map: Record<number, any> = {};
    as.forEach((x: any) => { map[x.id] = x; });
    setAppts(map);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  async function done(f: any, skipped = false) {
    const emotion = skipped ? '' : prompt('家属情绪状态？（如：平静 / 仍悲伤 / 情绪波动）') || '已记录';
    const content = skipped ? '' : prompt('回访内容记录？') || '已完成回访';
    await api('POST', `/api/followups/${f.id}/complete`, { emotion_note: emotion, content, skipped });
    load();
  }

  return (
    <AppShell>
      <h1>情感回访中心</h1>
      <div className="panel">
        <p className="muted">
          回访节奏由业务事件驱动：纪念品制作失败、骨灰盒破损会立即生成关怀回访；
          柜位到期前 30 天与到期未续费自动生成提醒；服务完结后第 7 天安排情绪安抚回访。
        </p>
        <div className="pill-actions" style={{ marginBottom: 10 }}>
          {[['scheduled', '待回访'], ['done', '已完成'], ['skipped', '已跳过']].map(([k, l]) =>
            <button key={k} className={tab === k ? '' : 'ghost'} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {items.length === 0 ? <p className="muted">暂无回访任务</p> : (
          <table>
            <thead><tr><th>宠物工单</th><th>回访类型</th><th>计划时间</th><th>内容</th><th>情绪记录</th><th></th></tr></thead>
            <tbody>
              {items.map(f => (
                <tr key={f.id}>
                  <td>{appts[f.appointment_id]?.pet_name || `#${f.appointment_id}`}
                    <div className="muted mono">{appts[f.appointment_id]?.code}</div></td>
                  <td><span className={`tag ${f.trigger.includes('failed') || f.trigger.includes('damaged') || f.trigger.includes('expired') ? 'bad' : 'info'}`}>
                    {TRIGGER_LABEL[f.trigger] || f.trigger}</span></td>
                  <td>{fmt(f.planned_at)}</td>
                  <td style={{ maxWidth: 280 }}>{f.content}{f.done_at && <div className="muted">完成于 {fmt(f.done_at)}</div>}</td>
                  <td style={{ maxWidth: 180 }}>{f.emotion_note || '—'}</td>
                  <td>
                    {f.status === 'scheduled' && <div className="pill-actions">
                      <button className="small ok" onClick={() => done(f)}>完成回访</button>
                      <button className="small ghost" onClick={() => done(f, true)}>跳过</button>
                    </div>}
                    <Link className="btn ghost small" href={`/appointments/${f.appointment_id}`}>工单</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
