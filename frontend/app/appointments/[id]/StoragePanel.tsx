'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, fmt, getSession, yuan } from '../../lib';

const PREF: Record<string, string> = { renew: '到期续费', retrieve: '到期取回', long_term: '转长期寄存' };
const CHANNEL: Record<string, string> = { sms: '短信', phone: '电话', wechat: '微信', email: '邮件', visit: '上门', letter: '书面信函' };
const CHANNEL_PREF: Record<string, string> = { sms: '短信', phone: '电话', wechat: '微信', email: '邮件' };
const VALIDITY: Record<string, string> = { unknown: '待核实', valid: '有效', invalid: '空号/停机', changed: '号码已变更' };
const AUTH: Record<string, string> = { none: '未提供', uploaded: '已登记待核实', verified: '已核实有效', expired: '已失效' };
const RESULT: Record<string, string> = {
  reached: '已联系上', no_answer: '无人应答', invalid_number: '空号/停机', refused: '明确拒绝',
  voicemail: '留言/语音信箱', promised_renew: '承诺续费', promised_retrieve: '承诺取回',
  promised_long_term: '承诺转长期',
};
const CASE_STATUS: any = {
  cs_lead_pending: ['待客服主管审批', 'warn'], storage_lead_pending: ['待寄存主管复核', 'warn'],
  approved: ['双批准·指令待执行', 'info'], rejected: ['已驳回', 'bad'],
  done: ['处置完成', 'ok'], withdrawn: ['已撤回', ''],
};
const DIR_STATUS: any = { pending: ['待执行', 'warn'], done: ['已执行', 'ok'], withdrawn: ['已撤回', ''] };
const ACTION: Record<string, string> = { migrate: '迁移长期区', continue_keep: '继续保管', other: '其他合规处置' };
const CB_RESULT: Record<string, string> = { satisfied: '满意', understanding: '理解接受', concerned: '仍有顾虑', unreachable: '仍无法联系' };

function nowInput(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 16);
}

export default function StoragePanel({ a, onChanged }: { a: any; onChanged: () => void }) {
  const id = a.id;
  const [me, setMe] = useState<any>(null);
  const [sv, setSv] = useState<any>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    try { setSv(await api('GET', `/api/storage/appointments/${id}`)); }
    catch (e: any) { setErr(e.message); }
  }, [id]);
  useEffect(() => { setMe(getSession()); load(); /* eslint-disable-next-line */ }, [id]);

  const act = async (fn: () => Promise<any>, ok?: string, reloadMain = true) => {
    setErr(''); setMsg('');
    try {
      await fn();
      setMsg(ok || '操作成功');
      await load();
      if (reloadMain) onChanged();
    } catch (e: any) { setErr(e.message); }
  };

  if (!me || !sv) return null;
  const role = me.user.role;
  const isStaff = ['customer_service', 'cs_lead', 'storage_lead', 'manager'].includes(role);
  const contact = sv.contact;
  const locker = sv.locker;
  const apptId = id;
  if (!locker) {
    return <div className="panel">
      <h2>寄存续费 · 授权 · 柜位处置</h2>
      <p className="muted">该工单尚未入柜寄存；骨灰入柜后可在此管理到期提醒偏好、续费校验、多轮联系与合规处置。</p>
    </div>;
  }
  const daysLeft = locker?.expire_at ? Math.ceil((+new Date(locker.expire_at) - Date.now()) / 86400000) : null;
  const pendingFamily = sv.directives.find((d: any) =>
    d.source === 'family_confirmed' && d.status === 'pending');

  return (
    <div className="panel">
      <h2>寄存续费 · 授权 · 柜位处置</h2>
      {err && <div className="error">{err}</div>}
      {msg && <div className="ok-msg">{msg}</div>}

      <ContactSection apptId={apptId} contact={contact} role={role} isStaff={isStaff} act={act} />

      {/* 续费校验与办理 */}
      {locker && (
        <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 10, marginTop: 10 }}>
          <h3>② 到期续费（系统校验：柜位可续用 / 年费变更 / 未结服务费用）</h3>
          <p className="muted">
            柜位 {locker.code} · 剩余期限 <b style={{ color: (daysLeft ?? 0) <= 30 ? 'var(--warn)' : undefined }}>
              {daysLeft === null ? '—' : `${daysLeft} 天`}</b>（{fmt(locker.expire_at)}）·
            未结余额 <b style={{ color: sv.renew_check.balance > 0.01 ? 'var(--bad)' : 'var(--ok)' }}>
              {yuan(sv.renew_check.balance)}</b>
            {sv.renew_check.price_changed && <> · <span className="tag bad">年费已由 {sv.renew_check.assigned_fee} 调整为 {sv.renew_check.current_fee} 元/年</span></>}
          </p>
          <RenewBox sv={sv} act={act} />
          {locker.status !== 'protected' && (
            <div className="pill-actions" style={{ borderTop: '1px dashed var(--line)', paddingTop: 8, marginTop: 8 }}>
              <button className="small ghost" onClick={() => {
                const note = prompt('取回交接备注（可留空）') || '';
                act(() => api('POST', `/api/storage/appointments/${apptId}/retrieve`, { note }),
                  '家属已取回骨灰，柜位已释放并留痕');
              }}>{role === 'owner' ? '我要取回骨灰并退柜' : '登记家属取回骨灰（释放柜位）'}</button>
              <span className="muted">取回后原柜位释放，交接记录保留在时间线；有在途迁移/处置指令时须先撤回。</span>
            </div>
          )}
        </div>
      )}

      {/* 多轮联系 */}
      {isStaff && locker && (
        <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 10, marginTop: 10 }}>
          <h3>③ 多轮联系（须 ≥{sv.rules.min_rounds} 轮、覆盖 ≥{sv.rules.min_channels} 种渠道；当前 {sv.attempts.length} 轮 / {sv.disposal_eligibility.channels} 种渠道）</h3>
          <AttemptForm apptId={apptId} act={act} />
          {sv.attempts.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>轮次</th><th>渠道</th><th>结果</th><th>时间</th><th>记录/证明</th></tr></thead>
              <tbody>
                {sv.attempts.map((t: any) => (
                  <tr key={t.id}>
                    <td>第 {t.round} 轮</td>
                    <td>{CHANNEL[t.channel] || t.channel}</td>
                    <td><span className={`tag ${['reached', 'promised_renew', 'promised_retrieve', 'promised_long_term'].includes(t.result) ? 'ok' : 'bad'}`}>
                      {RESULT[t.result] || t.result}</span></td>
                    <td>{fmt(t.attempted_at)}</td>
                    <td style={{ maxWidth: 260 }}>{t.note || '—'}
                      {t.proof_urls?.length > 0 && <div className="media-list">{t.proof_urls.map((u: string) =>
                        <span key={u}>📎 {u.split('/').pop()}</span>)}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 转长期寄存 */}
      {isStaff && locker && (
        <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 10, marginTop: 10 }}>
          <h3>④ 转长期寄存（比较可用柜位、迁移时间，取得家属确认后执行）</h3>
          <LongTermForm sv={sv} act={act} />
        </div>
      )}

      {/* 家属确认转长期 */}
      {pendingFamily && (
        <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 10, marginTop: 10 }}>
          <h3>待家属确认：转长期寄存方案</h3>
          <p>由 {pendingFamily.from_locker_code} 迁移至 <b>{pendingFamily.target_locker_code}</b>，
            计划迁移时间 {fmt(pendingFamily.planned_execute_at)}。目标柜位已临时保护，不会被他人占用。</p>
          {role === 'owner'
            ? <div className="pill-actions">
                <button className="small ok" onClick={() => act(() =>
                  api('POST', `/api/storage/directives/${pendingFamily.id}/family-respond`, { approve: true }),
                  '已确认，可按计划迁移')}>确认按此方案迁移</button>
                <button className="small danger" onClick={() => {
                  const note = prompt('拒绝原因（可选）') || '';
                  act(() => api('POST', `/api/storage/directives/${pendingFamily.id}/family-respond`,
                    { approve: false, note }), '已拒绝，柜位与账单已恢复');
                }}>暂不迁移</button>
              </div>
            : <p className="muted">等待家属在主人端确认；家属拒绝时目标柜位保护与出账将自动撤回。</p>}
        </div>
      )}

      {/* 逾期处置（客服发起） */}
      {isStaff && locker && (
        <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 10, marginTop: 10 }}>
          <h3>⑤ 逾期未回应处置申请（柜位将进入受保护待处置，不得释放/再分配）</h3>
          <DisposalForm sv={sv} role={role} act={act} />
        </div>
      )}

      {/* 申请与审批流 */}
      {sv.cases.length > 0 && (
        <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 10, marginTop: 10 }}>
          <h3>⑥ 处置申请与双级审批（{sv.cases.length}）</h3>
          <table>
            <thead><tr><th>#</th><th>拟定</th><th>状态</th><th>客服主管</th><th>寄存主管</th><th>操作</th></tr></thead>
            <tbody>
              {sv.cases.map((c: any) => {
                const [txt, color] = CASE_STATUS[c.status] || [c.status, ''];
                return (
                  <tr key={c.id}>
                    <td>#{c.id}</td>
                    <td>{ACTION[c.proposed_action]}
                      {c.target_locker_id && <div className="muted">目标 #{c.target_locker_id}</div>}
                      <div className="muted">{c.reason}</div></td>
                    <td><span className={`tag ${color}`}>{txt}</span></td>
                    <td>{c.cs_lead_status === 'approved' ? <span className="tag ok">已批准</span>
                      : c.cs_lead_status === 'rejected' ? <span className="tag bad">已驳回</span>
                        : <span className="tag warn">待审批</span>}
                      {c.cs_lead_note && <div className="muted">{c.cs_lead_note}</div>}</td>
                    <td>{c.storage_lead_status === 'approved' ? <span className="tag ok">复核通过</span>
                      : c.storage_lead_status === 'rejected' ? <span className="tag bad">复核驳回</span>
                        : <span className="tag warn">待复核</span>}
                      {c.storage_lead_note && <div className="muted">{c.storage_lead_note}</div>}</td>
                    <td>
                      {c.status === 'cs_lead_pending' && ['cs_lead', 'manager'].includes(role) && (
                        <div className="pill-actions">
                          <button className="small ok" onClick={() => act(() =>
                            api('POST', `/api/storage/disposal-cases/${c.id}/cs-lead-review`,
                              { approve: true, note: prompt('审批意见（可选）') || '同意按规定推进' }),
                            '客服主管已批准，转寄存主管复核')}>批准下一步</button>
                          <button className="small danger" onClick={() => act(() =>
                            api('POST', `/api/storage/disposal-cases/${c.id}/cs-lead-review`,
                              { approve: false, note: prompt('驳回原因') || '证据不足，继续联系' }),
                            '已驳回，柜位解除保护')}>驳回</button>
                        </div>)}
                      {c.status === 'storage_lead_pending' && ['storage_lead', 'manager'].includes(role) && (
                        <div className="pill-actions">
                          <button className="small ok" onClick={() => act(() =>
                            api('POST', `/api/storage/disposal-cases/${c.id}/storage-lead-review`,
                              { approve: true, note: prompt('复核意见（可选）') || '授权与多轮联系证据齐备，放行处置' }),
                            '复核通过，处置指令已生成')}>复核放行</button>
                          <button className="small danger" onClick={() => act(() =>
                            api('POST', `/api/storage/disposal-cases/${c.id}/storage-lead-review`,
                              { approve: false, note: prompt('驳回原因') || '授权/证据不充分' }),
                            '复核驳回，柜位解除保护')}>驳回</button>
                        </div>)}
                      {c.status === 'withdrawn' && <span className="muted">主人恢复联系，流程撤回</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 处置/迁移指令 */}
      {sv.directives.length > 0 && (
        <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 10, marginTop: 10 }}>
          <h3>⑦ 处置指令：执行 / 撤回 / 家属回访（{sv.directives.length}）</h3>
          {sv.directives.map((d: any) => (
            <DirectiveRow key={d.id} d={d} role={role} isStaff={isStaff} act={act} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContactSection({ apptId, contact, role, isStaff, act }: any) {
  const [pref, setPref] = useState(contact?.reminder_pref || 'renew');
  const [channel, setChannel] = useState(contact?.channel_pref || 'sms');
  const [alt, setAlt] = useState({ name: contact?.alt_contact_name || '', phone: contact?.alt_contact_phone || '', rel: contact?.alt_contact_relation || '' });
  const [docNo, setDocNo] = useState('');
  const [docUrl, setDocUrl] = useState('');

  useEffect(() => {
    setPref(contact?.reminder_pref || 'renew');
    setChannel(contact?.channel_pref || 'sms');
    setAlt({ name: contact?.alt_contact_name || '', phone: contact?.alt_contact_phone || '', rel: contact?.alt_contact_relation || '' });
  }, [contact?.id]);

  return (
    <div>
      <h3>① 联系人提醒偏好 · 有效性 · 授权文件</h3>
      <div className="grid3">
        <div><label>到期首选方案偏好</label>
          <select value={pref} onChange={e => setPref(e.target.value)}>
            {Object.entries(PREF).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label>首选提醒渠道</label>
          <select value={channel} onChange={e => setChannel(e.target.value)}>
            {Object.entries(CHANNEL_PREF).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label>联系人有效性（员工核实）</label>
          <div className="row" style={{ alignItems: 'center' }}>
            <span className={`tag ${contact?.validity === 'valid' ? 'ok' : contact?.validity === 'invalid' || contact?.validity === 'changed' ? 'bad' : 'warn'}`}>
              {VALIDITY[contact?.validity || 'unknown']}</span>
            {isStaff && <button className="small ghost" onClick={() => {
              const v = prompt('有效性：valid 有效 / invalid 空号停机 / changed 号码变更', 'valid') || '';
              if (v) act(() => api('POST', `/api/storage/appointments/${apptId}/validity`,
                { validity: v, note: prompt('备注（可选）') || '' }), '有效性已更新', false);
            }}>更新</button>}
          </div></div>
      </div>
      <div className="grid3" style={{ marginTop: 6 }}>
        <input placeholder="备用联系人姓名" value={alt.name} onChange={e => setAlt({ ...alt, name: e.target.value })} />
        <input placeholder="备用联系人电话" value={alt.phone} onChange={e => setAlt({ ...alt, phone: e.target.value })} />
        <input placeholder="与家属关系（如：女儿）" value={alt.rel} onChange={e => setAlt({ ...alt, rel: e.target.value })} />
      </div>
      <button className="small" style={{ marginTop: 6 }} onClick={() => act(() =>
        api('POST', `/api/storage/appointments/${apptId}/preferences`,
          { reminder_pref: pref, channel_pref: channel,
            alt_contact_name: alt.name, alt_contact_phone: alt.phone, alt_contact_relation: alt.rel }),
        '偏好与备用联系人已保存', false)}>保存提醒偏好</button>

      <div className="row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 2 }}>
          <label>授权文件（代办/迁移/处置授权；寄存主管复核前须核实）</label>
          <div className="row">
            <input style={{ flex: 1 }} placeholder="授权文件编号" value={docNo} onChange={e => setDocNo(e.target.value)} />
            <input style={{ flex: 2 }} placeholder="授权材料 URL（多个用逗号分隔）" value={docUrl} onChange={e => setDocUrl(e.target.value)} />
            <button className="small" onClick={() => {
              if (!docUrl && !docNo) return alert('请填写授权文件编号或材料 URL');
              act(() => api('POST', `/api/storage/appointments/${apptId}/authorization`, {
                action: 'upload', auth_doc_no: docNo,
                auth_media_urls: docUrl.split(',').map((x: string) => x.trim()).filter(Boolean),
                auth_expire_at: null,
              }), '授权文件已登记，待员工核实', false);
              setDocNo(''); setDocUrl('');
            }}>登记授权</button>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label>当前授权状态</label>
          <div className="pill-actions">
            <span className={`tag ${contact?.auth_status === 'verified' ? 'ok' : contact?.auth_status === 'expired' ? 'bad' : 'warn'}`}>
              {AUTH[contact?.auth_status || 'none']}</span>
            {isStaff && contact?.auth_status === 'uploaded' && (
              <button className="small ok" onClick={() => act(() =>
                api('POST', `/api/storage/appointments/${apptId}/authorization`,
                  { action: 'verify', note: prompt('核实备注（可选）') || '授权文件真实有效' }),
                '授权已核实', false)}>核实通过</button>)}
            {isStaff && contact?.auth_status === 'verified' && (
              <button className="small ghost danger" onClick={() => act(() =>
                api('POST', `/api/storage/appointments/${apptId}/authorization`,
                  { action: 'expire', note: prompt('失效原因') || '授权过期' }),
                '已标记授权失效', false)}>标记失效</button>)}
          </div>
          {contact?.auth_doc_no && <div className="muted mono" style={{ marginTop: 4 }}>文件编号：{contact.auth_doc_no}</div>}
        </div>
      </div>
    </div>
  );
}

function RenewBox({ sv, act }: any) {
  const [months, setMonths] = useState(12);
  const [priceOk, setPriceOk] = useState(false);
  const blockers: string[] = sv.renew_check.blockers || [];
  const locked = sv.locker.status === 'protected';
  return (
    <div>
      {blockers.length > 0 && <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
        {blockers.map((b: string, i: number) => <li key={i} style={{ color: 'var(--bad)', fontSize: 13 }}>{b}</li>)}
      </ul>}
      <div className="pill-actions" style={{ alignItems: 'center' }}>
        <label style={{ margin: 0 }}>续费月数
          <input type="number" min={1} max={60} value={months} style={{ width: 90, marginLeft: 6 }}
            onChange={e => setMonths(Number(e.target.value))} /></label>
        {sv.renew_check.price_changed && (
          <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={priceOk} onChange={e => setPriceOk(e.target.checked)} />
            已知悉年费变更（按新价 {sv.renew_check.current_fee} 元/年续费）</label>
        )}
        <button className="small ok" disabled={!sv.renew_check.renewable || (sv.renew_check.price_changed && !priceOk)}
          onClick={() => act(() => api('POST', `/api/lockers/${sv.locker.id}/renew`,
            { months, price_confirmed: priceOk }), `续费 ${months} 个月成功，新到期时间已更新`)}>
          {locked ? '柜位保护中·不可续费' : `续费 ${months} 个月`}</button>
      </div>
      <p className="muted">续费金额按现行年费 {yuan(sv.renew_check.current_fee)} 折算（{months} 个月 ≈ {yuan((sv.renew_check.current_fee / 12 * months).toFixed(2))}）。</p>
    </div>
  );
}

function AttemptForm({ apptId, act }: any) {
  const [f, setF] = useState({ channel: 'phone', result: 'no_answer', at: nowInput(), note: '', proof: '' });
  return (
    <div>
      <div className="grid3">
        <div><label>渠道</label><select value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })}>
          {Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
        <div><label>结果</label><select value={f.result} onChange={e => setF({ ...f, result: e.target.value })}>
          {Object.entries(RESULT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
        <div><label>联系时间</label><input type="datetime-local" value={f.at} onChange={e => setF({ ...f, at: e.target.value })} /></div>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input style={{ flex: 2 }} placeholder="联系情况记录（家属情绪、承诺内容等）" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        <input style={{ flex: 2 }} placeholder="证明材料 URL（通话截图/短信回执/挂号信/上门照片，逗号分隔）" value={f.proof} onChange={e => setF({ ...f, proof: e.target.value })} />
      </div>
      <button className="small" style={{ marginTop: 6 }} onClick={() => act(() =>
        api('POST', `/api/storage/appointments/${apptId}/attempts`, {
          channel: f.channel, result: f.result, attempted_at: new Date(f.at).toISOString(),
          note: f.note, proof_urls: f.proof.split(',').map((x: string) => x.trim()).filter(Boolean),
        }), '本轮联系已登记（渠道/结果/证明已留痕）')}>登记本轮联系（渠道/结果/证明留痕）</button>
    </div>
  );
}

function LongTermForm({ sv, act }: any) {
  const [target, setTarget] = useState('');
  const [at, setAt] = useState(nowInput(3));
  const options = sv.long_term_options || [];
  return (
    <div>
      <p className="muted">系统仅列出本门店当前空闲柜位；提交时会再次锁定校验，避免承诺已被占用的位置。</p>
      {options.length === 0 ? <p className="tag bad">门店暂无空闲柜位可供比较，无法承诺迁移位置</p> : (
        <table style={{ marginBottom: 6 }}>
          <thead><tr><th></th><th>柜位</th><th>等级</th><th>年费</th></tr></thead>
          <tbody>
            {options.map((l: any) => (
              <tr key={l.id} style={{ cursor: 'pointer', background: target === String(l.id) ? '#f6ead9' : undefined }}
                onClick={() => setTarget(String(l.id))}>
                <td><input type="radio" style={{ width: 'auto' }} checked={target === String(l.id)} onChange={() => setTarget(String(l.id))} /></td>
                <td className="mono"><b>{l.code}</b></td>
                <td>{l.tier === 'premium' ? '尊享柜' : '标准柜'}</td>
                <td className="mono">{yuan(l.annual_fee)}/年</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="pill-actions">
        <label style={{ margin: 0 }}>计划迁移时间
          <input type="datetime-local" style={{ width: 200, marginLeft: 6 }} value={at} onChange={e => setAt(e.target.value)} /></label>
        <button className="small ok" disabled={!target} onClick={() => act(() =>
          api('POST', `/api/storage/appointments/${sv.locker.appointment_id}/long-term`,
            { target_locker_id: Number(target), planned_migrate_at: new Date(at).toISOString() }),
          '方案已生成，目标柜位已临时保护，等待家属确认')}>拟定方案并请家属确认</button>
      </div>
    </div>
  );
}

function DisposalForm({ sv, role, act }: any) {
  const [action2, setAction2] = useState('migrate');
  const [target, setTarget] = useState('');
  const [at, setAt] = useState(nowInput(2));
  const [reason, setReason] = useState('');
  const e = sv.disposal_eligibility;
  const canApply = ['customer_service', 'cs_lead', 'manager'].includes(role)
    && e.expired && e.rounds >= e.min_rounds && e.channels >= e.min_channels
    && !e.last_reached && !e.has_active_case;
  return (
    <div>
      <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
        {!e.expired && <li className="muted">柜位尚未到期（当前 {sv.locker.status}）</li>}
        <li style={{ color: e.rounds >= e.min_rounds ? 'var(--ok)' : 'var(--bad)' }}>
          多轮联系 {e.rounds}/{e.min_rounds} 轮</li>
        <li style={{ color: e.channels >= e.min_channels ? 'var(--ok)' : 'var(--bad)' }}>
          渠道覆盖 {e.channels}/{e.min_channels} 种</li>
        {e.last_reached && <li style={{ color: 'var(--ok)' }}>最后一轮已联系上/家属有承诺，不应进入处置</li>}
        {e.has_active_case && <li style={{ color: 'var(--warn)' }}>已有进行中的处置申请</li>}
      </ul>
      <div className="grid3">
        <div><label>拟定处置方式</label>
          <select value={action2} onChange={ev => setAction2(ev.target.value)}>
            <option value="migrate">迁移至长期存放区</option>
            <option value="continue_keep">继续保管（6 个月）</option>
            <option value="other">其他合规处置</option>
          </select></div>
        {action2 === 'migrate' && <div><label>迁移目标柜位（空闲）</label>
          <select value={target} onChange={ev => setTarget(ev.target.value)}>
            <option value="" disabled>选择空闲柜位</option>
            {(sv.long_term_options || []).map((l: any) =>
              <option key={l.id} value={l.id}>{l.code} · {l.tier === 'premium' ? '尊享柜' : '标准柜'} · {yuan(l.annual_fee)}/年</option>)}
          </select></div>}
        {action2 === 'migrate' && <div><label>计划迁移时间</label>
          <input type="datetime-local" value={at} onChange={ev => setAt(ev.target.value)} /></div>}
      </div>
      <input style={{ marginTop: 6 }} placeholder="处置事由与合规依据（如：过期 45 天、三轮两渠道联系无果、已挂号信函）"
        value={reason} onChange={ev => setReason(ev.target.value)} />
      <button className="small danger" style={{ marginTop: 6 }} disabled={!canApply || (action2 === 'migrate' && !target) || !reason}
        onClick={() => act(() =>
          api('POST', `/api/storage/appointments/${sv.locker.appointment_id}/disposal-cases`, {
            proposed_action: action2, target_locker_id: target ? Number(target) : null,
            planned_migrate_at: action2 === 'migrate' ? new Date(at).toISOString() : null,
            reason,
          }), '已发起处置申请，柜位进入受保护待处置状态')}>发起处置申请（保护柜位）</button>
    </div>
  );
}

function DirectiveRow({ d, role, isStaff, act }: any) {
  const [open, setOpen] = useState(false);
  const [handler, setHandler] = useState('');
  const [note, setNote] = useState('');
  const [media, setMedia] = useState('');
  const [cb, setCb] = useState({ result: 'understanding', note: '' });
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <div style={{ flex: 3 }}>
          <b>指令 #{d.id}</b> · {ACTION[d.action]}
          {d.action === 'migrate' && <> · <span className="mono">{d.from_locker_code} → {d.target_locker_code}</span></>}
          {d.action !== 'migrate' && <> · 原柜位 <span className="mono">{d.from_locker_code}</span></>}
          {' '}<span className={`tag ${DIR_STATUS[d.status][1]}`}>{DIR_STATUS[d.status][0]}</span>
          {d.source === 'family_confirmed' && <span className="tag info" style={{ marginLeft: 4 }}>家属确认方案</span>}
          <div className="muted">
            {d.status === 'done'
              ? <>执行于 {fmt(d.executed_at)} · 交接人员 {d.handler_name}</>
              : <>计划执行 {fmt(d.planned_execute_at)} · 原柜位快照 {d.from_locker_code} 已永久留存</>}
          </div>
        </div>
        {d.status === 'pending' && <div className="pill-actions" style={{ flex: 2, justifyContent: 'flex-end' }}>
          {isStaff && <button className="small" onClick={() => setOpen(!open)}>{open ? '收起' : '执行交接'}</button>}
          <button className="small ghost danger" onClick={() => act(() =>
            api('POST', `/api/storage/directives/${d.id}/withdraw`,
              { reason: prompt('撤回原因', role === 'owner' ? '主人已恢复联系，要求继续协商' : '主人在处置执行前恢复联系') || '主人恢复联系' }),
            '指令已撤回：账单已冲销恢复、预占柜位已释放、原柜位状态已还原')}>
            {role === 'owner' ? '我已联系上·撤回' : '主人恢复联系·撤回'}</button>
        </div>}
      </div>
      {open && d.status === 'pending' && isStaff && (
        <div style={{ marginTop: 8 }}>
          <div className="grid3">
            <input placeholder="交接人员姓名" value={handler} onChange={e => setHandler(e.target.value)} />
            <input placeholder="交接材料 URL（逗号分隔）" value={media} onChange={e => setMedia(e.target.value)} />
            <input placeholder="执行备注" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <button className="small ok" style={{ marginTop: 6 }} onClick={() => act(() =>
            api('POST', `/api/storage/directives/${d.id}/execute`, {
              handler_name: handler || '值班交接员',
              media: media.split(',').map(x => x.trim()).filter(Boolean), note,
            }), '处置已执行，原柜位/交接人/时间已留痕，已安排 7 日后家属回访')}>确认完成交接执行</button>
        </div>
      )}
      {d.handover_media_urls?.length > 0 && <div className="media-list" style={{ marginTop: 4 }}>
        交接材料：{d.handover_media_urls.map((u: string) => <span key={u}>📎 {u.split('/').pop()}</span>)}</div>}
      {d.withdrawn_at && <div className="muted">撤回于 {fmt(d.withdrawn_at)}：{d.withdraw_reason}</div>}
      {d.status === 'done' && isStaff && (
        <div style={{ marginTop: 6 }}>
          <label>家属后续回访结果</label>
          <div className="pill-actions">
            <select style={{ width: 150 }} value={cb.result} onChange={e => setCb({ ...cb, result: e.target.value })}>
              {Object.entries(CB_RESULT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input style={{ flex: 1 }} placeholder="回访记录（家属情绪、诉求）" value={cb.note} onChange={e => setCb({ ...cb, note: e.target.value })} />
            <button className="small" onClick={() => act(() =>
              api('POST', `/api/storage/directives/${d.id}/callback`,
                { result: cb.result, note: cb.note, media: [] }), '家属回访结果已记录', false)}>登记回访</button>
          </div>
        </div>
      )}
    </div>
  );
}
