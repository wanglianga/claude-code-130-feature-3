'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import {
  api, fmt, getSession, CASE_STATUS_LABEL, CASE_REASON_LABEL, DISPOSITION_ACTION_LABEL,
  CONTACT_CHANNEL_LABEL, CONTACT_RESULT_LABEL, LOCKER_STATUS_LABEL,
} from '../lib';

export default function DispositionsPage() {
  const [s, setS] = useState<any>(null);
  const [tab, setTab] = useState('');
  const [cases, setCases] = useState<any[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => setS(getSession()), []);
  const role = s?.user?.role;

  async function load() {
    const list = await api('GET', `/api/storage/cases${tab ? `?status=${tab}` : ''}`);
    setCases(list);
    if (selId) {
      try { setDetail(await api('GET', `/api/storage/cases/${selId}`)); } catch { setDetail(null); }
    }
  }
  useEffect(() => { if (s) load(); /* eslint-disable-next-line */ }, [tab, selId, s]);

  async function act(fn: () => Promise<any>, ok?: string) {
    setErr(''); setMsg('');
    try { await fn(); setMsg(ok || '操作成功'); await load(); }
    catch (e: any) { setErr(e.message); }
  }

  if (!s) return null;

  return (
    <AppShell>
      <h1>骨灰寄存到期处置中心</h1>
      <div className="panel">
        <p className="muted">
          到期前按主人偏好发送续费 / 取回 / 转长期提醒；逾期多轮联系无回应后，柜位进入<b>受保护待处置</b>状态，
          不得释放或再分配；客服主管审批、寄存主管复核授权与证据后生成处置指令；执行留痕原柜位、交接人员与时间，
          并完成家属回访；执行前家属恢复联系可撤回指令并恢复账单与柜位。
        </p>
        <div className="pill-actions">
          {[['', '全部'], ['contacting', '多轮联系中'], ['awaiting_supervisor', '待主管审批'],
            ['awaiting_storage_review', '待寄存复核'], ['ordered', '待执行'],
            ['executed', '已执行'], ['withdrawn', '已撤回']].map(([k, l]) =>
            <button key={l} className={tab === k ? '' : 'ghost'} onClick={() => { setTab(k); setSelId(null); }}>{l}</button>)}
        </div>
      </div>

      {err && <div className="error">{err}</div>}
      {msg && <div className="ok-msg">{msg}</div>}

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="panel">
          <h2>处置案件（{cases.length}）</h2>
          {cases.length === 0 ? <p className="muted">暂无案件</p> : (
            <table>
              <thead><tr><th>案件</th><th>宠物/柜位</th><th>状态</th><th>联系轮次</th></tr></thead>
              <tbody>
                {cases.map(c => (
                  <tr key={c.id} onClick={() => setSelId(c.id)}
                    style={{ cursor: 'pointer', background: selId === c.id ? '#faf2e8' : undefined }}>
                    <td className="mono">{c.code}
                      <div className="muted">{CASE_REASON_LABEL[c.reason] || c.reason}</div></td>
                    <td><b>{c.pet_name}</b><div className="muted mono">{c.appt_code} · {c.locker_code}</div></td>
                    <td><CaseStatusTag s={c.status} /></td>
                    <td>{c.attempts_done}{c.rounds_required ? `/${c.rounds_required}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ marginTop: 8 }}>
            新立案入口：打开对应工单详情 →「寄存续费与处置」面板。
          </p>
        </div>

        {detail && (
          <CaseDetail key={detail.case.id} d={detail} role={role} act={act} reload={load}
            setMsg={setMsg} setErr={setErr} />
        )}
        {!detail && (
          <div className="panel muted">请选择左侧案件查看联系记录、授权证据、审批与处置指令。</div>
        )}
      </div>
    </AppShell>
  );
}

function CaseStatusTag({ s }: { s: string }) {
  const color = s === 'contacting' ? 'warn'
    : s === 'awaiting_supervisor' || s === 'awaiting_storage_review' ? 'warn'
    : s === 'ordered' ? 'info'
    : s === 'executed' || s === 'closed_resolved' ? 'ok'
    : s === 'withdrawn' ? 'info' : '';
  return <span className={`tag ${color}`}>{CASE_STATUS_LABEL[s] || s}</span>;
}

function CaseDetail({ d, role, act, reload, setMsg, setErr }: any) {
  const c = d.case;
  const canCs = ['customer_service', 'manager'].includes(role);
  const canSuper = ['cs_supervisor', 'manager'].includes(role);
  const canStorage = ['storage_manager', 'manager'].includes(role);
  const isOwner = role === 'owner';
  const [contact, setContact] = useState({ channel: 'phone', result: 'no_answer', note: '', evidence: '' });
  const [review, setReview] = useState({
    action: 'continue_storage', target_locker_id: '', period_months: '12',
    planned_at: '', note: '',
  });
  const [exec, setExec] = useState({ handover_by: '', note: '', evidence: '' });
  const [freeLockers, setFreeLockers] = useState<any[]>([]);

  useEffect(() => {
    if (review.action === 'migrate' || c.status === 'awaiting_storage_review') {
      api('GET', `/api/resources?store_id=${d.appointment.store_id}`).then(rs =>
        setFreeLockers((rs.lockers || []).filter((l: any) => l.status === 'free'))).catch(() => {});
    }
  }, [review.action, c.status]);

  const pendingOrder = d.orders.find((o: any) => o.status === 'pending');

  async function handleContact() {
    const ok = contact.result === 'reached' || contact.result === 'promised';
    await act(() => api('POST', `/api/storage/cases/${c.id}/contact`, {
      channel: contact.channel, result: contact.result,
      note: contact.note || '已按流程联系',
      evidence_urls: contact.evidence.split(',').map(x => x.trim()).filter(Boolean),
    }), ok ? '已登记，家属已联系上' : '联系已登记');
    setContact({ channel: 'phone', result: 'no_answer', note: '', evidence: '' });
  }

  async function handleExecute() {
    if (!exec.handover_by) { alert('请填写交接人员'); return; }
    await act(() => api('POST', `/api/storage/orders/${pendingOrder.id}/execute`, {
      handover_by: exec.handover_by, note: exec.note,
      evidence_urls: exec.evidence.split(',').map((x: string) => x.trim()).filter(Boolean),
    }), '处置已执行，已生成家属回访任务');
    setExec({ handover_by: '', note: '', evidence: '' });
  }

  return (
    <div className="panel">
      <div className="section-title">
        <h2 style={{ margin: 0 }}>{c.code} <CaseStatusTag s={c.status} /></h2>
        <span style={{ flex: 1 }} />
        <Link className="btn ghost small" href={`/appointments/${c.appointment_id}`}>打开工单</Link>
      </div>
      <dl className="kv">
        <dt>宠物</dt><dd>{d.appointment.pet_name}（{d.appointment.code}）</dd>
        <dt>家属</dt><dd>{d.appointment.owner?.name} {d.appointment.owner?.phone}</dd>
        <dt>原柜位</dt><dd>{d.locker.code} · {LOCKER_STATUS_LABEL[d.locker.status]}
          {d.target_locker && <> · 拟迁入 <b>{d.target_locker.code}</b></>}</dd>
        <dt>开案原因</dt><dd>{CASE_REASON_LABEL[c.reason] || c.reason}（剩余期限快照 {c.remain_days_snapshot} 天）</dd>
        {d.preference && <>
          <dt>联系人</dt><dd>{d.preference.contact_name} {d.preference.contact_phone}
            <span className={`tag ${d.preference.contact_valid === 'invalid' ? 'bad' : d.preference.contact_valid === 'valid' ? 'ok' : 'warn'}`}>
              {d.preference.contact_valid === 'invalid' ? '失效' : d.preference.contact_valid === 'valid' ? '有效' : '未核查'}
            </span>
            {d.preference.alt_contact_phone && <span className="muted">；备用 {d.preference.alt_contact_name} {d.preference.alt_contact_phone}</span>}</dd>
          <dt>续费偏好</dt><dd>{({ renew: '续费', retrieve: '到期取回', longterm: '转长期寄存' } as any)[d.preference.preferred_action]}
            （{CONTACT_CHANNEL_LABEL[d.preference.preferred_channel] || d.preference.preferred_channel}）</dd>
        </>}
      </dl>

      {/* 授权文件 */}
      <h3>授权与证明文件</h3>
      {d.authorizations.length === 0 ? <p className="muted">暂无授权文件</p> : (
        <table>
          <thead><tr><th>文件</th><th>类型</th><th>复核状态</th><th>{canStorage ? '操作' : ''}</th></tr></thead>
          <tbody>
            {d.authorizations.map((au: any) => (
              <tr key={au.id}>
                <td>{au.title}<div className="muted mono">{au.doc_no}</div></td>
                <td className="muted">{au.doc_type}</td>
                <td>{au.status === 'verified' ? <span className="tag ok">已采信</span>
                  : au.status === 'rejected' ? <span className="tag bad">未采信</span>
                  : <span className="tag warn">待寄存主管复核</span>}</td>
                <td>{canStorage && au.status === 'uploaded' && (
                  <div className="pill-actions">
                    <button className="small ok" onClick={() => act(() => api('POST', `/api/storage/authorizations/${au.id}/verify`,
                      { approve: true, note: '身份与授权材料核验一致' }), '授权文件已采信')}>采信</button>
                    <button className="small danger" onClick={() => act(() => api('POST', `/api/storage/authorizations/${au.id}/verify`,
                      { approve: false, note: '材料不足，要求补充' }), '已退回补充')}>不采信</button>
                  </div>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 多轮联系 */}
      <h3>多轮联系记录（{d.attempts.length}/{c.rounds_required || '—'}）</h3>
      {d.attempts.length === 0 ? <p className="muted">尚未登记联系</p> : (
        <table>
          <thead><tr><th>轮次</th><th>渠道</th><th>结果</th><th>时间</th><th>说明 / 证明</th></tr></thead>
          <tbody>
            {d.attempts.map((a: any) => (
              <tr key={a.id}>
                <td>第 {a.round} 轮</td>
                <td>{CONTACT_CHANNEL_LABEL[a.channel] || a.channel}</td>
                <td><span className={`tag ${['reached', 'promised'].includes(a.result) ? 'ok' : 'bad'}`}>
                  {CONTACT_RESULT_LABEL[a.result] || a.result}</span></td>
                <td className="muted">{fmt(a.contacted_at)}</td>
                <td style={{ maxWidth: 260 }}>{a.note}
                  {a.evidence_urls?.length > 0 && <div className="media-list">
                    {a.evidence_urls.map((u: string) => <span key={u}>📎 {u.split('/').pop()}</span>)}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.status === 'contacting' && canCs && (
        <div style={{ background: '#faf7f2', padding: 10, borderRadius: 8, marginTop: 8 }}>
          <h3>登记本轮联系（{d.attempts.length + 1}）</h3>
          <div className="grid3">
            <div><label>渠道</label><select value={contact.channel} onChange={e => setContact({ ...contact, channel: e.target.value })}>
              {Object.entries(CONTACT_CHANNEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
            <div><label>结果</label><select value={contact.result} onChange={e => setContact({ ...contact, result: e.target.value })}>
              {Object.entries(CONTACT_RESULT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
            <div><label>证明材料 URL（逗号分隔）</label>
              <input value={contact.evidence} onChange={e => setContact({ ...contact, evidence: e.target.value })}
                placeholder="录音/截图/信函底单/上门照片" /></div>
          </div>
          <label>联系情况说明</label><input value={contact.note} onChange={e => setContact({ ...contact, note: e.target.value })} />
          <button className="small" style={{ marginTop: 6 }} onClick={handleContact}>
            提交本轮联系
          </button>
          <p className="muted">完成规定轮次仍无有效回应，柜位将自动进入「受保护待处置」并提交客服主管审批。</p>
        </div>
      )}

      {/* 审批流 */}
      {c.status === 'awaiting_supervisor' && (
        <div style={{ background: '#f6ead9', padding: 10, borderRadius: 8, marginTop: 8 }}>
          <h3>客服主管审批</h3>
          {canSuper ? <div className="pill-actions">
            <button className="ok" onClick={() => {
              const note = prompt('审批意见（同意进入下一步处置评估）') || '联系程序合规，同意';
              act(() => api('POST', `/api/storage/cases/${c.id}/supervisor-approve`, { approve: true, note }),
                '已批准，转送寄存主管复核');
            }}>批准下一步</button>
            <button className="danger" onClick={() => {
              const note = prompt('退回原因（要求补充联系）') || '继续补充多轮联系';
              act(() => api('POST', `/api/storage/cases/${c.id}/supervisor-approve`, { approve: false, note }), '已退回补充联系');
            }}>退回补充</button>
          </div> : <p className="muted">等待客服主管审批</p>}
        </div>
      )}

      {c.status === 'awaiting_storage_review' && (
        <div style={{ background: '#e3eaef', padding: 10, borderRadius: 8, marginTop: 8 }}>
          <h3>寄存主管复核授权与证据，并生成处置指令</h3>
          {canStorage ? <>
            <div className="grid3">
              <div><label>处置方式</label><select value={review.action}
                onChange={e => setReview({ ...review, action: e.target.value })}>
                {Object.entries(DISPOSITION_ACTION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
              {review.action === 'migrate' && <div><label>迁移目标柜位（必须当前空闲）</label>
                <select value={review.target_locker_id} onChange={e => setReview({ ...review, target_locker_id: e.target.value })}>
                  <option value="" disabled>选择空闲柜位</option>
                  {freeLockers.map(l => <option key={l.id} value={l.id}>{l.code} · {l.tier === 'premium' ? '尊享' : '标准'} · ¥{l.annual_fee}/年</option>)}
                </select></div>}
              {review.action !== 'retrieve' && review.action !== 'other' && <div>
                <label>保管周期（月）</label><input type="number" value={review.period_months}
                  onChange={e => setReview({ ...review, period_months: e.target.value })} /></div>}
              {(review.action === 'migrate' || review.action === 'retrieve') && <div>
                <label>计划执行时间</label><input type="datetime-local" value={review.planned_at}
                  onChange={e => setReview({ ...review, planned_at: e.target.value })} /></div>}
            </div>
            <label>复核 / 处置说明</label><input value={review.note} onChange={e => setReview({ ...review, note: e.target.value })}
              placeholder="授权链与联系证据复核结论" />
            <button className="small ok" style={{ marginTop: 6 }} onClick={() => {
              if (review.action === 'migrate' && !review.target_locker_id) return alert('迁移须选择当前空闲的目标柜位');
              act(() => api('POST', `/api/storage/cases/${c.id}/storage-review`, {
                approve: true, action: review.action,
                target_locker_id: review.target_locker_id ? Number(review.target_locker_id) : undefined,
                period_months: review.period_months ? Number(review.period_months) : undefined,
                planned_at: review.planned_at ? new Date(review.planned_at).toISOString() : undefined,
                action_note: review.note, note: review.note,
              }), '复核通过，处置指令已生成');
            }}>复核通过并生成指令</button>
            <button className="small danger" onClick={() => act(() => api('POST', `/api/storage/cases/${c.id}/storage-review`,
              { approve: false, note: prompt('退回原因') || '授权/证据不足' }), '已退回补充')}>复核不通过</button>
          </> : <p className="muted">等待寄存主管复核授权文件与联系证据</p>}
        </div>
      )}

      {/* 处置指令 */}
      <h3>处置指令（{d.orders.length}）</h3>
      {d.orders.length === 0 ? <p className="muted">尚未生成指令</p> : d.orders.map((o: any) => (
        <div key={o.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <b>{o.order_no}</b> <span className="tag info">{DISPOSITION_ACTION_LABEL[o.action] || o.action}</span>{' '}
          {o.status === 'pending' ? <span className="tag warn">待执行</span>
            : o.status === 'executed' ? <span className="tag ok">已执行</span>
            : <span className="tag">已撤回</span>}
          <dl className="kv" style={{ marginTop: 6 }}>
            <dt>原柜位</dt><dd className="mono">{o.from_locker_code}（永久保留追溯）</dd>
            {o.to_locker_code && <><dt>目标柜位</dt><dd className="mono">{o.to_locker_code}</dd></>}
            {o.period_months && <><dt>周期</dt><dd>{o.period_months} 个月</dd></>}
            <dt>计划时间</dt><dd>{fmt(o.planned_at)}</dd>
            {o.executed_at && <>
              <dt>执行时间</dt><dd>{fmt(o.executed_at)}</dd>
              <dt>交接人员</dt><dd>{o.handover_by}{o.executed_by ? `（经办 #${o.executed_by}）` : ''}</dd>
              <dt>执行说明</dt><dd>{o.execute_note}</dd>
              {o.evidence_urls?.length > 0 && <dt>交接证明</dt>}
              {o.evidence_urls?.length > 0 && <dd><div className="media-list">
                {o.evidence_urls.map((u: string) => <span key={u}>📎 {u.split('/').pop()}</span>)}</div></dd>}
              <dt>家属回访</dt><dd>{o.follow_up_result
                ? <>{o.follow_up_result}<div className="muted">回访于 {fmt(o.follow_up_at)}</div></>
                : <span className="tag warn">待回访</span>}</dd>
            </>}
          </dl>

          {o.status === 'pending' && (canCs || canStorage || role === 'driver' || role === 'cremator') && (
            <div style={{ background: '#faf7f2', padding: 8, borderRadius: 8 }}>
              <div className="grid2">
                <div><label>交接人员（双方签字）</label><input value={exec.handover_by}
                  onChange={e => setExec({ ...exec, handover_by: e.target.value })} placeholder="如：礼仪师、寄存主管" /></div>
                <div><label>交接证明 URL（逗号分隔）</label><input value={exec.evidence}
                  onChange={e => setExec({ ...exec, evidence: e.target.value })} /></div>
              </div>
              <label>执行说明</label><input value={exec.note} onChange={e => setExec({ ...exec, note: e.target.value })} />
              <button className="small ok" style={{ marginTop: 6 }} onClick={handleExecute}>按指令执行并留痕</button>
            </div>
          )}
          {o.status === 'executed' && !o.follow_up_result && (canCs || canSuper || canStorage) && (
            <button className="small" onClick={() => {
              const result = prompt('家属后续回访结果（安置确认 / 情绪 / 诉求）');
              if (result) act(() => api('POST', `/api/storage/orders/${o.id}/followup`, { result }), '回访结果已记录');
            }}>登记家属回访结果</button>
          )}
        </div>
      ))}

      {/* 撤回 */}
      {['contacting', 'awaiting_supervisor', 'awaiting_storage_review', 'ordered'].includes(c.status) &&
        (isOwner || canCs || canSuper || canStorage) && (
        <div style={{ marginTop: 8 }}>
          <button className="danger" onClick={() => {
            const note = prompt('撤回原因（家属恢复联系的说明）') || '家属在处置执行前恢复联系';
            act(() => api('POST', `/api/storage/cases/${c.id}/withdraw`, { note }),
              '未完成指令已撤回，账单与柜位状态已恢复');
          }}>家属恢复联系 · 撤回未完成处置</button>
          <span className="muted"> 撤回将释放预占目标柜位、作废/冲红处置账单，原柜位恢复占用。</span>
        </div>
      )}
    </div>
  );
}
