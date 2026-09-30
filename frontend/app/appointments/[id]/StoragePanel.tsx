'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmt, yuan, getSession, CONTACT_CHANNEL_LABEL, LOCKER_STATUS_LABEL, CASE_STATUS_LABEL } from '../../lib';

/**
 * 寄存续费与处置面板（工单详情内嵌）：
 * 主人设置偏好/联系人、续费三项校验、取回/转长期选择、授权上传；
 * 客服核查联系人、发起转长期方案、对逾期柜位立案。
 */
export function StoragePanel({ a, role, act, reload }: any) {
  const [sd, setSd] = useState<any>(null);
  const [rc, setRc] = useState<any>(null);
  const [months, setMonths] = useState(12);
  const [cand, setCand] = useState<any>(null);
  const [pref, setPref] = useState({
    contact_name: '', contact_phone: '', alt_contact_name: '', alt_contact_phone: '',
    preferred_channel: 'phone', preferred_action: 'renew', notify_days: 30, notes: '',
  });
  const [auth, setAuth] = useState({ doc_type: 'owner_id', title: '', doc_no: '', file_url: '' });
  const [propose, setPropose] = useState({ target_locker_id: '', planned_move_at: '', note: '' });

  const canCs = ['customer_service', 'cs_supervisor', 'storage_manager', 'manager'].includes(role);
  const isOwner = role === 'owner';

  async function loadStorage() {
    try {
      const d = await api('GET', `/api/storage/appointments/${a.id}/detail`);
      setSd(d);
      if (d.preference) {
        setPref(p => ({ ...p,
          contact_name: d.preference.contact_name || p.contact_name,
          contact_phone: d.preference.contact_phone || p.contact_phone,
          alt_contact_name: d.preference.alt_contact_name || '',
          alt_contact_phone: d.preference.alt_contact_phone || '',
          preferred_channel: d.preference.preferred_channel,
          preferred_action: d.preference.preferred_action,
          notify_days: d.preference.notify_days, notes: d.preference.notes || '' }));
      } else if (isOwner) {
        const me = getSession();
        setPref(p => ({ ...p, contact_name: me?.user?.name || '' }));
      }
    } catch { /* 无寄存信息时忽略 */ }
  }
  useEffect(() => { loadStorage(); /* eslint-disable-next-line */ }, [a.id]);

  if (!sd) return <div className="panel muted">寄存信息加载中…</div>;

  const lk = sd.locker;
  const openCase = sd.open_case;

  async function doRenewCheck() {
    setRc(await api('POST', `/api/storage/appointments/${a.id}/renew-check`, { months }));
  }
  async function doRenew() {
    await act(() => api('POST', `/api/storage/appointments/${a.id}/renew`,
      { months, acknowledge_price_change: true }),
      `续费成功，柜位新到期日已更新`);
    setRc(null); loadStorage(); reload();
  }
  async function loadCandidates() {
    const r = await api('GET', `/api/storage/appointments/${a.id}/longterm-candidates`);
    setCand(r);
    setPropose(p => ({ ...p, target_locker_id: r.candidates?.[0]?.id ? String(r.candidates[0].id) : '' }));
  }

  return (
    <div className="panel">
      <h2>骨灰寄存续费与处置</h2>

      {/* 柜位与处置状态 */}
      {lk ? (
        <dl className="kv">
          <dt>当前柜位</dt><dd><b>{lk.code}</b>（{lk.tier === 'premium' ? '尊享柜' : '标准柜'}）
            <span className={`tag ${lk.status === 'protected' ? 'bad' : lk.status === 'reserved' ? 'warn' : lk.status === 'expired' ? 'bad' : lk.status === 'expiring' ? 'warn' : 'info'}`}>
              {LOCKER_STATUS_LABEL[lk.status]}</span></dd>
          <dt>到期时间</dt><dd>{fmt(lk.expire_at)}（当前年费 {yuan(lk.annual_fee)}/年）</dd>
        </dl>
      ) : <p className="muted">该工单尚未入柜寄存。</p>}

      {/* 进行中处置案件提示 */}
      {openCase && (
        <div className={`tag ${openCase.status === 'contacting' ? 'warn' : 'info'}`} style={{ margin: '6px 0', display: 'block', padding: 8 }}>
          进行中处置案件 {openCase.code}：{CASE_STATUS_LABEL[openCase.status]}
          （已联系 {openCase.attempts?.length || 0}/{openCase.rounds_required} 轮）
          <Link className="btn small" style={{ marginLeft: 8 }} href="/dispositions">前往处置中心处理 →</Link>
        </div>
      )}

      {/* 续费偏好与联系人有效性 */}
      <details open={!sd.preference}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--brand-dark)' }}>
          续费偏好与联系人{sd.preference &&
            <span className="muted">（{sd.preference.contact_name} ·
              {sd.preference.contact_valid === 'invalid' ? ' 联系人失效' : sd.preference.contact_valid === 'valid' ? ' 联系人有效' : ' 未核查'}）</span>}
        </summary>
        <div className="grid3" style={{ marginTop: 8 }}>
          <div><label>主联系人</label><input value={pref.contact_name}
            onChange={e => setPref({ ...pref, contact_name: e.target.value })} /></div>
          <div><label>联系电话</label><input value={pref.contact_phone}
            onChange={e => setPref({ ...pref, contact_phone: e.target.value })} /></div>
          <div><label>首选渠道</label><select value={pref.preferred_channel}
            onChange={e => setPref({ ...pref, preferred_channel: e.target.value })}>
            {Object.entries(CONTACT_CHANNEL_LABEL).slice(0, 5).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
          <div><label>备用联系人</label><input value={pref.alt_contact_name}
            onChange={e => setPref({ ...pref, alt_contact_name: e.target.value })} /></div>
          <div><label>备用电话</label><input value={pref.alt_contact_phone}
            onChange={e => setPref({ ...pref, alt_contact_phone: e.target.value })} /></div>
          <div><label>到期偏好</label><select value={pref.preferred_action}
            onChange={e => setPref({ ...pref, preferred_action: e.target.value })}>
            <option value="renew">到期续费</option>
            <option value="retrieve">到期取回</option>
            <option value="longterm">转长期寄存</option>
          </select></div>
        </div>
        <label>备注</label><input value={pref.notes} onChange={e => setPref({ ...pref, notes: e.target.value })} />
        <div className="pill-actions" style={{ marginTop: 6 }}>
          <button className="small" onClick={() => act(async () => {
            await api('POST', `/api/storage/appointments/${a.id}/preference`, pref);
            await loadStorage();
          }, '续费偏好与联系人已保存')}>保存偏好</button>
          {canCs && sd.preference && <>
            <button className="small ghost" onClick={() => act(() => api('POST', `/api/storage/appointments/${a.id}/contact-check`,
              { valid: true, note: '电话核实可接通' }), '联系人已标记有效')}>核查为有效</button>
            <button className="small danger" onClick={() => act(() => api('POST', `/api/storage/appointments/${a.id}/contact-check`,
              { valid: false, note: prompt('失效原因（空号/停机/拒收）') || '无法联系' }), '联系人已标记失效')}>核查为失效</button>
          </>}
        </div>
      </details>

      {/* 授权文件 */}
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--brand-dark)', marginTop: 8 }}>
          授权与证明文件（{sd.authorizations.length}）
        </summary>
        {sd.authorizations.length > 0 && <table style={{ marginTop: 6 }}>
          <tbody>{sd.authorizations.map((x: any) => (
            <tr key={x.id}><td>{x.title}</td><td className="muted">{x.doc_type}</td>
              <td>{x.status === 'verified' ? <span className="tag ok">已采信</span>
                : x.status === 'rejected' ? <span className="tag bad">未采信</span>
                : <span className="tag warn">待复核</span>}</td></tr>
          ))}</tbody>
        </table>}
        {(isOwner || canCs) && <div className="grid3" style={{ marginTop: 6 }}>
          <div><label>文件类型</label><select value={auth.doc_type} onChange={e => setAuth({ ...auth, doc_type: e.target.value })}>
            <option value="owner_id">主人身份证明</option>
            <option value="power_of_attorney">授权委托书</option>
            <option value="family_confirm">家属确认书</option>
            <option value="relation">亲属关系证明</option>
            <option value="other">其他</option>
          </select></div>
          <div><label>文件标题</label><input value={auth.title} onChange={e => setAuth({ ...auth, title: e.target.value })} /></div>
          <div><label>材料 URL</label><input value={auth.file_url} onChange={e => setAuth({ ...auth, file_url: e.target.value })} /></div>
        </div>}
        {(isOwner || canCs) && <button className="small" style={{ marginTop: 6 }} onClick={() => {
          if (!auth.title || !auth.file_url) return alert('请填写标题与材料 URL');
          act(async () => { await api('POST', `/api/storage/appointments/${a.id}/authorizations`, auth); await loadStorage(); },
            '授权文件已上传，待寄存主管复核');
          setAuth({ doc_type: 'owner_id', title: '', doc_no: '', file_url: '' });
        }}>上传授权/证明文件</button>}
      </details>

      {/* 续费操作（柜位在存且无进行中处置指令） */}
      {lk && !openCase && ['occupied', 'expiring', 'expired'].includes(lk.status) && (
        <div style={{ borderTop: '1px dashed var(--line)', marginTop: 10, paddingTop: 10 }}>
          <h3>到期续费（系统三项校验）</h3>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: '0 0 120px' }}><label>续费月数</label>
              <input type="number" value={months} onChange={e => setMonths(Number(e.target.value))} /></div>
            <button className="small" onClick={doRenewCheck}>校验柜位/年费/欠费</button>
            {rc?.can_renew && <button className="small ok" onClick={doRenew}>
              确认续费 {rc.months} 个月（{yuan(rc.renewal_fee)}）</button>}
          </div>
          {rc && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <div>① 柜位可续用：{rc.renewable ? <span className="tag ok">可续</span> : <span className="tag bad">不可续</span>}</div>
              <div>② 年费价格：{rc.price_changed
                ? <span className="tag warn">{rc.price_note}（续费前须家属确认知晓）</span>
                : <span className="tag ok">{rc.price_note}（无变更）</span>}</div>
              <div>③ 未结服务费：{rc.outstanding_balance > 0.01
                ? <span className="tag bad">欠费 {yuan(rc.outstanding_balance)}</span>
                : <span className="tag ok">已结清</span>}
                {rc.pending_fee_changes?.length > 0 &&
                  <span className="tag bad"> {rc.pending_fee_changes.length} 项费用变更待确认</span>}</div>
              <div style={{ marginTop: 6 }}>本期续费 <b>{yuan(rc.renewal_fee)}</b>
                {rc.outstanding_balance > 0.01 && <> + 结清欠费 {yuan(rc.outstanding_balance)}</>}，
                合计应付 <b>{yuan(rc.payable_now)}</b></div>
              {rc.block_reasons?.length > 0 && <div className="error" style={{ marginTop: 6 }}>
                {rc.block_reasons.map((r: string) => <div key={r}>⛔ {r}</div>)}</div>}
              {rc.price_changed && rc.can_renew && <p className="muted">点击「确认续费」即表示家属已知晓并同意年费变更。</p>}
            </div>
          )}
        </div>
      )}

      {/* 取回 / 转长期（主人选择 + 客服方案） */}
      {lk && !openCase && ['occupied', 'expiring'].includes(lk.status) && (
        <div style={{ borderTop: '1px dashed var(--line)', marginTop: 10, paddingTop: 10 }}>
          <h3>取回 / 转长期寄存</h3>
          {isOwner && <div className="pill-actions">
            <button className="small ghost" onClick={() => act(() => api('POST',
              `/api/storage/appointments/${a.id}/choose-retrieve`,
              { retrieve_at: new Date(Date.now() + 7 * 86400000).toISOString() }), '已登记到期取回，客服将与您预约到店时间')}>
              我选择到期取回</button>
            <button className="small" onClick={loadCandidates}>我要转长期（比较柜位）</button>
          </div>}
          {canCs && <button className="small" onClick={loadCandidates}>比较长期柜位并提出方案</button>}

          {cand && (
            <div style={{ marginTop: 8 }}>
              <p className="muted">原柜位 {cand.current.code}（{yuan(cand.current.annual_fee)}/年），
                到期 {fmt(cand.current.expire_at)}。可选长期柜位（执行前再次校验占用，绝不承诺已被占用位置）：</p>
              <table>
                <thead><tr><th>柜位</th><th>等级</th><th>年费</th><th>10 年长期价(九折)</th></tr></thead>
                <tbody>{cand.candidates.map((c2: any) => (
                  <tr key={c2.id}><td className="mono">{c2.code}</td>
                    <td>{c2.tier === 'premium' ? '尊享' : '标准'}</td>
                    <td>{yuan(c2.annual_fee)}</td><td>{yuan(c2.longterm_120m_fee)}</td></tr>
                ))}</tbody>
              </table>
              {canCs && <div className="grid3" style={{ marginTop: 8 }}>
                <div><label>目标柜位</label><select value={propose.target_locker_id}
                  onChange={e => setPropose({ ...propose, target_locker_id: e.target.value })}>
                  <option value="" disabled>选择目标柜位</option>
                  {cand.candidates.map((c2: any) => <option key={c2.id} value={c2.id}>{c2.code}</option>)}
                </select></div>
                <div><label>拟迁移时间</label><input type="datetime-local" value={propose.planned_move_at}
                  onChange={e => setPropose({ ...propose, planned_move_at: e.target.value })} /></div>
                <div><label>说明</label><input value={propose.note} onChange={e => setPropose({ ...propose, note: e.target.value })} /></div>
              </div>}
              {canCs && <button className="small ok" style={{ marginTop: 6 }} onClick={() => {
                if (!propose.target_locker_id || !propose.planned_move_at) return alert('请选择目标柜位与迁移时间');
                act(async () => {
                  await api('POST', `/api/storage/appointments/${a.id}/longterm-propose`, {
                    target_locker_id: Number(propose.target_locker_id),
                    planned_move_at: new Date(propose.planned_move_at).toISOString(), note: propose.note });
                  reload();
                }, '转长期方案已提交，等待家属确认');
              }}>提出转长期方案（待家属确认）</button>}
              {isOwner && <p className="muted">长期方案由客服比较柜位后提交，请在上方「待家属确认」中确认。</p>}
            </div>
          )}
        </div>
      )}

      {/* 客服对逾期柜位立案 */}
      {canCs && lk && !openCase && lk.status === 'expired' && (
        <div style={{ borderTop: '1px dashed var(--line)', marginTop: 10, paddingTop: 10 }}>
          <h3>逾期处置立案</h3>
          <p className="muted">家属逾期未回应时立案，按规定完成多轮联系并留存渠道、结果与证明；多轮无回应后柜位自动进入受保护状态。</p>
          <button className="small danger" onClick={() => act(async () => {
            await api('POST', `/api/storage/appointments/${a.id}/cases`, { rounds_required: 3 });
            await loadStorage();
          }, '处置案件已立案，开始多轮联系')}>立处置案件（3 轮联系）</button>
        </div>
      )}
    </div>
  );
}
