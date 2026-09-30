'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import { api, fmt, getSession, yuan } from '../lib';

const CASE_STATUS: any = {
  cs_lead_pending: ['待客服主管审批', 'warn'], storage_lead_pending: ['待寄存主管复核', 'warn'],
  approved: ['双批准·待执行', 'info'], rejected: ['已驳回', 'bad'],
  done: ['处置完成', 'ok'], withdrawn: ['已撤回', ''],
};
const DIR_STATUS: any = { pending: ['待执行', 'warn'], done: ['已执行', 'ok'], withdrawn: ['已撤回', ''] };
const ACTION: any = { migrate: '迁移长期存放区', continue_keep: '继续保管 6 个月', other: '其他合规处置' };

export default function StorageCenterPage() {
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState('cases');
  const [cases, setCases] = useState<any[]>([]);
  const [dirs, setDirs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    const [cs, ds2, st] = await Promise.all([
      api('GET', '/api/storage/disposal-cases'),
      api('GET', '/api/storage/directives'),
      api('GET', '/api/storage/overview'),
    ]);
    setCases(cs); setDirs(ds2); setStats(st);
  }
  useEffect(() => { setMe(getSession()); load(); /* eslint-disable-next-line */ }, []);

  const role = me?.user?.role;
  const act = async (fn: () => Promise<any>, ok?: string) => {
    setErr(''); setMsg('');
    try { await fn(); setMsg(ok || '操作成功'); await load(); }
    catch (e: any) { setErr(e.message); }
  };

  if (!me) return null;

  return (
    <AppShell>
      <h1>寄存处置中心</h1>
      {err && <div className="error">{err}</div>}
      {msg && <div className="ok-msg">{msg}</div>}

      {stats && <div className="grid3">
        <div className="stat"><div className="n" style={{ color: 'var(--bad)' }}>{stats.protected_lockers}</div><div className="l">受保护待处置柜位（不可释放/再分配）</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--warn)' }}>{stats.pending_disposal_cases}</div><div className="l">待主管审批/复核申请</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--warn)' }}>{stats.pending_directives}</div><div className="l">待执行处置/迁移指令</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--ok)' }}>{stats.done_directives}</div><div className="l">已执行处置</div></div>
        <div className="stat"><div className="n">{stats.expired_lockers}</div><div className="l">已到期柜位</div></div>
        <div className="stat"><div className="n">{stats.post_disposal_followups}</div><div className="l">待完成处置后家属回访</div></div>
      </div>}

      <div className="pill-actions" style={{ margin: '10px 0' }}>
        <button className={tab === 'cases' ? '' : 'ghost'} onClick={() => setTab('cases')}>处置申请与审批（{cases.length}）</button>
        <button className={tab === 'dirs' ? '' : 'ghost'} onClick={() => setTab('dirs')}>处置/迁移指令（{dirs.length}）</button>
      </div>

      {tab === 'cases' && (
        <div className="panel">
          <p className="muted">
            流程：客服完成 ≥3 轮、≥2 种渠道联系仍无回应 → 发起申请（柜位进入保护态）→
            <b>客服主管审批</b>下一步 → <b>寄存主管复核授权与证据</b> → 生成指令。任一主管驳回则解除保护、回到过期跟进。
          </p>
          {cases.length === 0 ? <p className="muted">暂无处置申请</p> : (
            <table>
              <thead><tr><th>#</th><th>宠物/工单</th><th>门店</th><th>拟定处置</th><th>事由</th><th>状态</th><th>审批操作</th></tr></thead>
              <tbody>
                {cases.map(c => (
                  <tr key={c.id} style={c.status.includes('pending') ? { background: '#fbf6ef' } : undefined}>
                    <td>#{c.id}</td>
                    <td><Link href={`/appointments/${c.appointment_id}`}>{c.pet_name || `#${c.appointment_id}`}
                      <div className="muted mono">{c.appt_code}</div></Link></td>
                    <td>#{c.store_id} 号店</td>
                    <td>{ACTION[c.proposed_action]}
                      {c.target_locker && <div className="muted">目标 {c.target_locker}</div>}
                      {c.planned_migrate_at && <div className="muted">计划 {fmt(c.planned_migrate_at)}</div>}</td>
                    <td style={{ maxWidth: 220 }}>{c.reason}</td>
                    <td><span className={`tag ${CASE_STATUS[c.status][1]}`}>{CASE_STATUS[c.status][0]}</span></td>
                    <td>
                      {c.status === 'cs_lead_pending' && ['cs_lead', 'manager'].includes(role) && (
                        <div className="pill-actions">
                          <button className="small ok" onClick={() => act(() =>
                            api('POST', `/api/storage/disposal-cases/${c.id}/cs-lead-review`,
                              { approve: true, note: prompt('审批意见') || '同意按规定推进' }),
                            '客服主管已批准，转寄存主管复核')}>批准</button>
                          <button className="small danger" onClick={() => act(() =>
                            api('POST', `/api/storage/disposal-cases/${c.id}/cs-lead-review`,
                              { approve: false, note: prompt('驳回原因') || '继续联系家属' }),
                            '已驳回，柜位解除保护')}>驳回</button>
                        </div>)}
                      {c.status === 'storage_lead_pending' && ['storage_lead', 'manager'].includes(role) && (
                        <div className="pill-actions">
                          <button className="small ok" onClick={() => act(() =>
                            api('POST', `/api/storage/disposal-cases/${c.id}/storage-lead-review`,
                              { approve: true, note: prompt('复核意见') || '授权与证据齐备，放行处置' }),
                            '复核通过，处置指令已生成')}>复核放行</button>
                          <button className="small danger" onClick={() => act(() =>
                            api('POST', `/api/storage/disposal-cases/${c.id}/storage-lead-review`,
                              { approve: false, note: prompt('驳回原因') || '授权/证据不充分' }),
                            '复核驳回，柜位解除保护')}>驳回</button>
                        </div>)}
                      {(c.status === 'approved' || c.status === 'done' || c.status === 'withdrawn'
                        || c.status === 'rejected') && <span className="muted">详见「指令」标签 / 工单</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'dirs' && (
        <div className="panel">
          <p className="muted">
            指令执行必须登记交接人员、时间与材料，原柜位快照永久留存；执行前主人恢复联系，可一键撤回，
            系统冲销对应账单、释放预占目标柜位并恢复原柜位状态。
          </p>
          {dirs.length === 0 ? <p className="muted">暂无处置/迁移指令</p> : (
            <table>
              <thead><tr><th>#</th><th>宠物/工单</th><th>动作</th><th>柜位变化</th><th>状态</th><th>交接/回访</th><th>操作</th></tr></thead>
              <tbody>
                {dirs.map(d => (
                  <tr key={d.id}>
                    <td>#{d.id}{d.source === 'family_confirmed' && <div className="tag info">家属方案</div>}</td>
                    <td><Link href={`/appointments/${d.appointment_id}`}>{d.pet_name || `#${d.appointment_id}`}
                      <div className="muted mono">{d.appt_code}</div></Link></td>
                    <td>{ACTION[d.action]}</td>
                    <td className="mono">{d.from_locker}{d.target_locker && <> → <b>{d.target_locker}</b></>}</td>
                    <td><span className={`tag ${DIR_STATUS[d.status][1]}`}>{DIR_STATUS[d.status][0]}</span>
                      {d.status === 'pending' && <div className="muted">计划 {fmt(d.planned_execute_at)}</div>}
                      {d.status === 'done' && <div className="muted">执行 {fmt(d.executed_at)}</div>}
                      {d.status === 'withdrawn' && <div className="muted">撤回 {fmt(d.withdrawn_at)}</div>}</td>
                    <td style={{ maxWidth: 200 }}>
                      {d.handler_name && <div>交接：{d.handler_name}</div>}
                      {d.execute_note && <div className="muted">{d.execute_note}</div>}
                      {d.withdraw_reason && <div className="muted">撤回原因：{d.withdraw_reason}</div>}
                    </td>
                    <td>
                      {d.status === 'pending' && (
                        <div className="pill-actions">
                          {['customer_service', 'cs_lead', 'storage_lead', 'manager'].includes(role) &&
                            <button className="small ok" onClick={() => {
                              const handler = prompt('交接人员姓名？', me.user.name) || '';
                              const note = prompt('执行/交接备注（可留空）') || '';
                              act(() => api('POST', `/api/storage/directives/${d.id}/execute`,
                                { handler_name: handler, note, media: [] }),
                                '处置已执行，已安排 7 日后家属回访');
                            }}>执行交接</button>}
                          <button className="small ghost danger" onClick={() => act(() =>
                            api('POST', `/api/storage/directives/${d.id}/withdraw`,
                              { reason: prompt('撤回原因', '主人在处置执行前恢复联系') || '主人恢复联系' }),
                            '已撤回：账单与柜位状态已恢复')}>撤回</button>
                        </div>)}
                      {d.status === 'done' && ['customer_service', 'cs_lead', 'manager'].includes(role) &&
                        <button className="small" onClick={() => {
                          const result = prompt('家属回访结果：satisfied 满意 / understanding 理解 / concerned 有顾虑 / unreachable 无法联系', 'understanding') || 'understanding';
                          const note = prompt('回访记录') || '';
                          act(() => api('POST', `/api/storage/directives/${d.id}/callback`,
                            { result, note, media: [] }), '家属回访结果已记录');
                        }}>登记家属回访</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </AppShell>
  );
}
