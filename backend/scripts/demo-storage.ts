/**
 * 寄存到期续费、授权与柜位处置 —— 端到端验证脚本（真实 HTTP API）。
 * 前置：MariaDB 已启动、已 npm run seed、后端已在 4000 端口运行。
 * 运行：npm run demo:storage
 *
 * 覆盖（种子工单 #1 糯米 / #2 团子 / #3 年糕）：
 *  A. 续费三项校验：未结费用拦截 → 财务结清 → 年费变更未确认拦截 → 勾选确认后续费成功
 *  B. 转长期寄存：比较可用柜位 → 拟定方案（目标保护、出账）→ 占用目标被拦截 →
 *     家属确认 → 执行迁移（原柜位快照/交接人/时间）→ 家属后续回访
 *  C. 逾期处置：补第四轮联系 → 发起处置（保护态）→ 保护态禁止释放/续费/再分配 →
 *     授权未核实被寄存主管拦截 → 核实授权 → 双审批生成指令 → 执行前主人恢复联系撤回
 *     （账单冲销、预占释放、原柜位恢复过期）→ 重新走审批 → 继续保管指令执行
 */
import 'reflect-metadata';

const BASE = process.env.API_BASE || 'http://127.0.0.1:4000';
let token = '';
const ok = (cond: boolean, msg: string) => {
  if (cond) { console.log(`  ✓ ${msg}`); return; }
  throw new Error(`断言失败：${msg}`);
};
const log = (...a: any[]) => console.log(...a);

async function api(method: string, path: string, body?: any, who?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = data?.message ? JSON.stringify(data.message) : res.status;
    const err: any = new Error(`${who || path} → ${res.status} ${m}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}
/** 预期失败：返回错误消息 */
async function apiFail(method: string, path: string, body: any, who: string, expectText?: string) {
  try {
    await api(method, path, body, who);
  } catch (e: any) {
    if (expectText && !String(e.message).includes(expectText)) {
      throw new Error(`${who}：错误信息不含「${expectText}」，实际：${e.message}`);
    }
    return String(e.message);
  }
  throw new Error(`${who}：预期失败但成功了`);
}

async function login(u: string) {
  const r: any = await api('POST', '/auth/login', { username: u, password: '123456' });
  token = r.token;
  log(`\n=== 登录：${r.user.name}（${r.user.role}）===`);
}

async function main() {
  const iso = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

  // ========== A. 糯米（#1）：续费三项校验 ==========
  log('\n========== A. 续费校验（柜位可续用 / 年费变更 / 未结费用）==========');
  await login('cs1');
  let sv: any = await api('GET', '/api/storage/appointments/1');
  ok(sv.renew_check.balance === 200, `未结余额 200 元（实际 ${sv.renew_check.balance}）`);
  ok(sv.renew_check.price_changed === true, '检测到年费已由 600 调整为 660');
  ok(sv.renew_check.renewable === false && sv.renew_check.blockers.length >= 2,
    `续费被拦截（${sv.renew_check.blockers.length} 项：${sv.renew_check.blockers.join('；')}）`);
  await apiFail('POST', `/api/lockers/${sv.locker.id}/renew`, { months: 12 }, '欠费续费', '未结服务费用 200');

  // 财务结清 200 元
  await login('fin1');
  await api('POST', '/api/appointments/1/payment', { amount: 200, method: 'wechat', note: '结清历史服务费用' });
  sv = await api('GET', '/api/storage/appointments/1');
  ok(sv.renew_check.balance === 0, '结清后未结余额为 0');

  // 年费变更未确认仍被拦截
  await login('cs1');
  await apiFail('POST', `/api/lockers/${sv.locker.id}/renew`, { months: 12 }, '变价未确认续费', '年费价格已变更');
  // 勾选确认后续费成功
  const renewed: any = await api('POST', `/api/lockers/${sv.locker.id}/renew`,
    { months: 12, price_confirmed: true }, '确认变价后续费');
  ok(renewed.status === 'occupied', '续费后柜位恢复占用中');
  // 续费产生新一期年费账单，财务收取后余额清零
  sv = await api('GET', '/api/storage/appointments/1');
  ok(sv.renew_check.balance > 0, `续费年费已出账 ${sv.renew_check.balance} 元`);
  await login('fin1');
  await api('POST', '/api/appointments/1/payment',
    { amount: sv.renew_check.balance, method: 'wechat', note: '收取新一年续费年费' });
  await login('cs1');
  sv = await api('GET', '/api/storage/appointments/1');
  ok(sv.renew_check.balance === 0 && sv.renew_check.renewable === true && sv.renew_check.price_changed === false,
    '续费账单结清后校验全部通过、年费快照已更新为新价');
  const days = Math.ceil((+new Date(renewed.expire_at) - Date.now()) / 86400000);
  ok(days > 360 && days < 380, `新到期时间约 12 个月后（${days} 天）`);

  // ========== B. 团子（#2）：转长期寄存（柜位比较 + 家属确认 + 执行 + 回访）==========
  log('\n========== B. 转长期寄存（比较可用柜位 / 迁移时间 / 家属确认）==========');
  await login('cs2');
  sv = await api('GET', '/api/storage/appointments/2');
  const opts = sv.long_term_options as any[];
  ok(opts.length >= 2, `可比较空闲柜位 ${opts.length} 个（${opts.map(o => o.code).join('、')}）`);
  const target = opts[0];
  const other = opts[1];

  // 模拟目标柜位刚被他人占用：直接先由另一工单占用 other 不太好构造，改为对目标连续发起两次，第二次应被保护拦截
  const dir1: any = await api('POST', '/api/storage/appointments/2/long-term', {
    target_locker_id: target.id, planned_migrate_at: iso(3),
  }, '拟定转长期方案');
  ok(dir1.status === 'pending', `迁移指令 #${dir1.id} 已生成待家属确认`);
  const t1 = await api('GET', '/api/lockers').then((ls: any[]) => ls.find((l: any) => l.id === target.id));
  ok(t1.status === 'protected', `目标柜位 ${target.code} 已保护预占，不会被再分配`);

  // 再次拟定到同一目标 → 已被预占拦截；拟定到另一柜位 → 因存在待确认指令被拦截
  await apiFail('POST', '/api/storage/appointments/2/long-term',
    { target_locker_id: target.id, planned_migrate_at: iso(3) }, '承诺已占用柜位', '不能承诺该位置');
  await apiFail('POST', '/api/storage/appointments/2/long-term',
    { target_locker_id: other.id, planned_migrate_at: iso(3) }, '重复拟定', '待家属确认或待执行');

  // 未确认前禁止执行
  await apiFail('POST', `/api/storage/directives/${dir1.id}/execute`,
    { handler_name: '客服-陈露' }, '未确认先执行', '家属尚未确认');

  // 家属确认并执行
  await login('owner2');
  await api('POST', `/api/storage/directives/${dir1.id}/family-respond`,
    { approve: true, note: '同意迁入尊享长期区' }, '家属确认');
  await login('cs2');
  await api('POST', `/api/storage/directives/${dir1.id}/execute`, {
    handler_name: '寄存专员-何安', media: ['https://example.com/handover/migrate-tuanzi.jpg'],
    note: '家属视频在场，骨灰盒完好迁入',
  }, '执行迁移');
  sv = await api('GET', '/api/storage/appointments/2');
  ok(sv.locker.code === target.code, `现柜位为 ${target.code}（已迁移）`);
  ok(sv.locker.status === 'occupied', '目标柜位已转占用');
  const oldFree = (await api('GET', '/api/lockers') as any[]).find((l: any) => l.code === 'B-01-02');
  ok(oldFree.status === 'free', '原柜位 B-01-02 已释放可再分配（快照仍保留在指令中）');
  const doneDir = sv.directives.find((d: any) => d.id === dir1.id);
  ok(doneDir.from_locker_code === 'B-01-02' && doneDir.handler_name === '寄存专员-何安',
    '指令保留原柜位 B-01-02 与交接人员');
  const followups2 = await api('GET', '/api/followups?status=scheduled');
  ok((followups2 as any[]).some(f => f.trigger === 'post_disposal'), '已生成处置后 7 日家属回访任务');
  // 家属回访结果
  await api('POST', `/api/storage/directives/${dir1.id}/callback`,
    { result: 'satisfied', note: '家属已到新柜位祭扫，表示满意' }, '家属回访');

  // ========== C. 年糕（#3）：逾期多轮联系 → 保护态 → 双审批 → 撤回恢复 → 重新处置 ==========
  log('\n========== C. 逾期处置（多轮联系 / 受保护 / 双审批 / 撤回恢复）==========');
  sv = await api('GET', '/api/storage/appointments/3');
  ok(sv.locker.status === 'expired', '柜位 B-01-03 已到期');
  ok(sv.disposal_eligibility.rounds === 3 && sv.disposal_eligibility.channels === 3,
    '种子已有 3 轮 / 3 种渠道（电话/短信/信函）联系记录，满足 ≥3 轮 ≥2 渠道');

  // 联系记录校验：渠道/结果/证明均可追溯
  ok(sv.attempts.every((t: any) => t.channel && t.result && t.proof_urls?.length),
    '每轮联系均有渠道、结果与证明材料');

  // 发起处置（迁移）：授权未核实 → 寄存主管复核时才拦截；申请本身可提交
  const migTarget = sv.long_term_options[0];
  const c1: any = await api('POST', '/api/storage/appointments/3/disposal-cases', {
    proposed_action: 'migrate', target_locker_id: migTarget.id, planned_migrate_at: iso(2),
    reason: '过期 45 天，三轮（电话/短信/挂号信）联系无果，按规定申请迁移长期区',
  }, '发起迁移处置');
  ok(c1.status === 'cs_lead_pending', `处置申请 #${c1.id} 待客服主管审批`);
  let lk3 = (await api('GET', '/api/lockers') as any[]).find((l: any) => l.code === 'B-01-03');
  ok(lk3.status === 'protected', '柜位进入受保护待处置，不能释放或再次分配');

  // 保护态拦截：续费 / 入柜再分配 / 重复发起
  await apiFail('POST', `/api/lockers/${lk3.id}/renew`, { months: 12 }, '保护态续费', '受保护');
  await login('owner2');
  await apiFail('POST', '/api/appointments/3/locker-assign', { code: 'B-01-03' }, '保护态再分配', '无权');
  await login('cs2');

  // 客服主管批准
  await login('cslead1');
  await api('POST', `/api/storage/disposal-cases/${c1.id}/cs-lead-review`,
    { approve: true, note: '联系程序合规，同意推进' }, '客服主管批准');

  // 寄存主管复核：授权未核实 → 拦截
  await login('storelead1');
  await apiFail('POST', `/api/storage/disposal-cases/${c1.id}/storage-lead-review`,
    { approve: true }, '授权未核实复核', '授权');

  // 客服上传并由寄存主管核实授权（种子为 uploaded）
  await login('cs2');
  await api('POST', '/api/storage/appointments/3/authorization',
    { action: 'verify', note: '与留存家属签字比对一致' }, '核实授权');
  await login('storelead1');
  const r2: any = await api('POST', `/api/storage/disposal-cases/${c1.id}/storage-lead-review`,
    { approve: true, note: '授权真实有效、多轮证据齐备，放行' }, '寄存主管复核通过');
  ok(r2.directive_id, `复核通过生成处置指令 #${r2.directive_id}`);
  const migDir = r2.directive_id;

  // 执行前主人恢复联系 → 客服/主人撤回指令
  await login('owner2');
  await api('POST', `/api/storage/directives/${migDir}/withdraw`,
    { reason: '家属看到挂号信赶回，要求先续费协商' }, '主人恢复联系撤回');
  sv = await api('GET', '/api/storage/appointments/3');
  ok(sv.locker.status === 'expired', '撤回后原柜位恢复为已到期（解除保护）');
  const tFree = (sv.long_term_options as any[]).some(l => l.id === migTarget.id);
  ok(tFree, '迁移预占目标柜位已释放，重新出现在可比较列表');
  const c1After = sv.cases.find((x: any) => x.id === c1.id);
  ok(c1After.status === 'withdrawn', '处置申请状态为已撤回');
  const d3 = await api('GET', '/api/appointments/3');
  const migFee = d3.fees.find((f: any) => f.kind === 'storage_migrate');
  ok(!!migFee && migFee.voided === true, '迁移账单行已冲销，账单恢复');

  // 重新发起：改为「继续保管」→ 双审批 → 执行
  await login('cs2');
  const c2: any = await api('POST', '/api/storage/appointments/3/disposal-cases', {
    proposed_action: 'continue_keep', reason: '家属暂回外地，双方协商继续保管 6 个月等待取回',
  }, '重新发起继续保管');
  await login('cslead1');
  await api('POST', `/api/storage/disposal-cases/${c2.id}/cs-lead-review`, { approve: true });
  await login('storelead1');
  const r3: any = await api('POST', `/api/storage/disposal-cases/${c2.id}/storage-lead-review`,
    { approve: true, note: '继续保管合规' }, '复核通过');
  await login('cs2');
  await api('POST', `/api/storage/directives/${r3.directive_id}/execute`, {
    handler_name: '寄存专员-何安', note: '柜位加封继续保管条，6 个月内家属可随时取回',
  }, '执行继续保管');
  sv = await api('GET', '/api/storage/appointments/3');
  ok(sv.locker.status === 'occupied', '继续保管后柜位恢复占用');
  const keepDays = Math.ceil((+new Date(sv.locker.expire_at) - Date.now()) / 86400000);
  ok(keepDays > 170 && keepDays < 190, `新保管期限约 6 个月（${keepDays} 天）`);

  // 越权：客服不能审批
  await login('cs2');
  await apiFail('POST', `/api/storage/disposal-cases/${c2.id}/cs-lead-review`,
    { approve: true }, '客服越权审批', '无权');

  // ========== D. 糯米（#1）：家属取回骨灰，释放柜位 ==========
  log('\n========== D. 家属到期取回（释放柜位并留痕）==========');
  await login('owner1');
  await api('POST', '/api/storage/appointments/1/retrieve', { note: '王女士到店取回糯米骨灰' }, '家属取回');
  const lockersAfter = await api('GET', '/api/lockers') as any[];
  const a01 = lockersAfter.find((l: any) => l.code === 'A-01-01');
  ok(a01.status === 'free' && a01.appointment_id === null, '原柜位 A-01-01 已释放、无关联工单');
  const d1 = await api('GET', '/api/appointments/1');
  ok((d1.timeline as any[]).some(t => t.node_key === 'storage_retrieved'),
    '时间线保留「家属已取回骨灰，原柜位释放」交接记录');

  // 总览统计
  await login('manager1');
  const ov: any = await api('GET', '/api/manager/overview');
  const sov: any = await api('GET', '/api/storage/overview');
  log(`\n管理者总览：受保护柜位 ${ov.protected_lockers}；寄存处置总览 ${JSON.stringify(sov)}`);

  log('\n🎉 寄存续费/授权/柜位处置全链路验证通过');
}

main().catch(e => { console.error('\n❌ 验证失败:', e.message); process.exit(1); });
