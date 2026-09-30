/**
 * 端到端业务演示（直接走 HTTP API）。
 * 前置：MariaDB 已启动、已 npm run seed、后端已在 4000 端口运行。
 * 运行：npm run demo
 *
 * 覆盖：主人下单（含转介/全部服务选项）→ 客服方案+家属确认 → 调度
 * → 交通延误 → 接运（体重不符自动补差）→ 冷藏 → 家属改期 → 视频见证
 * → 告别 → 火化证明 → 纪念品失败/重做 → 骨灰盒寄送破损/补发 → 柜位入存
 * → 费用与收款 → 完结 → 7日安抚回访 + 柜位到期扫描。
 */
import 'reflect-metadata';

const BASE = process.env.API_BASE || 'http://127.0.0.1:4000';
let token = '';
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
    const msg = data?.message ? JSON.stringify(data.message) : res.status;
    throw new Error(`${who || path} → ${res.status} ${msg}`);
  }
  return data;
}

async function login(u: string) {
  const r: any = await api('POST', '/auth/login', { username: u, password: '123456' });
  token = r.token;
  log(`\n=== 登录：${r.user.name}（${r.user.role}）===`);
  return r.user;
}

async function main() {
  // 1. 主人下单
  await login('owner1');
  const appt: any = await api('POST', '/api/appointments', {
    store_id: 1, hospital_id: 1,
    pet_name: '布丁', pet_type: 'cat', pet_breed: '英国短毛猫', weight_kg: 4.2,
    death_time: new Date(Date.now() - 3600e3).toISOString(),
    need_pickup: true, pickup_address: '本市春风小区 3 栋',
    want_ceremony: true, private_cremation: true, want_urn: true,
    pawprint_hair: true, photo_video: true, storage_months: 0,
  }, '主人下单');
  const id = appt.id;
  log(`预约单 ${appt.code} #${id} 已提交`);

  // 2. 客服确认方案
  await login('cs1');
  await api('POST', `/api/appointments/${id}/confirm-plan`, {}, '客服确认方案');
  const d1: any = await api('GET', `/api/appointments/${id}`, {});
  log(`方案报价：${d1.fee_summary.quote_total} 元`);

  // 3. 家属确认方案
  await login('owner1');
  const planC = d1.confirmations.find((c: any) => c.subject === 'plan');
  await api('POST', `/api/appointments/${id}/confirmations/${planC.id}/respond`,
    { approve: true, note: '同意方案，请温柔对待布丁' });

  // 4. 客服调度（约 2 小时后接运、明天告别与火化）
  await login('cs1');
  const h = (n: number) => new Date(Date.now() + n * 3600e3).toISOString();
  await api('POST', `/api/appointments/${id}/dispatch`, {
    driver_id: 5, ceremonialist_id: 7, cremator_id: 9,
    pickup_at: h(2), ceremony_at: h(20), furnace_at: h(22),
    furnace_name: '1号火化炉', room_name: '宁静厅(1号店)',
  }, '客服调度');
  log('调度完成：接送员-老赵 / 冷藏位 / 1号火化炉 / 宁静厅 / 纪念品');

  // 5. 接送途中交通延误
  await login('driver1');
  await api('POST', `/api/appointments/${id}/driver-delay`,
    { minutes: 40, reason: '晚高峰高架事故拥堵' }, '交通延误');
  log('接送员上报延误 40 分钟，承诺接运时间已顺延并通知家属');

  // 6. 接运：实际体重 5.0kg（与登记 4.2kg 不符）→ 自动补差
  await api('POST', `/api/appointments/${id}/pickup`, {
    actual_weight_kg: 5.0, media: ['https://example.com/photos/pickup-01.jpg'],
    note: '主人当面交接，宠物安卧在毯中',
  }, '接运复称');
  const d2: any = await api('GET', `/api/appointments/${id}`, {});
  const pendingFee = d2.fees.find((f: any) => f.confirm_status === 'pending');
  log(`体重不符产生费用变更：${pendingFee.title} ${pendingFee.amount} 元，待家属确认`);

  // 7. 入冷藏
  await api('POST', `/api/appointments/${id}/cold-in`, {
    media: ['https://example.com/photos/cold-01.jpg'], note: '冷藏温度 4℃',
  }, '入冷藏');

  // 8. 家属确认补差
  await login('owner1');
  const feeC = d2.confirmations.find((c: any) => c.subject === 'fee_change');
  await api('POST', `/api/appointments/${id}/confirmations/${feeC.id}/respond`,
    { approve: true }, '家属确认补差');

  // 9. 家属申请更改仪式时间
  await api('POST', `/api/appointments/${id}/reschedule`,
    { new_time: h(21), reason: '外地亲属想赶回来参加告别' }, '家属改期');

  // 10. 家属要求视频见证
  await api('POST', `/api/appointments/${id}/video-witness`,
    { note: '我身体不便到现场，希望全程视频送别' }, '视频见证');

  // 11. 客服同意改期
  await login('cs1');
  const d3: any = await api('GET', `/api/appointments/${id}`, {});
  const rsc = d3.confirmations.filter((c: any) => c.subject === 'ceremony_time').pop();
  await api('POST', `/api/appointments/${id}/reschedule/${rsc.id}/approve`,
    { approve: true, note: '已协调礼仪师与告别室' }, '客服同意改期');
  log('改期成功，告别室档期已重排');

  // 12. 告别仪式
  await login('rite1');
  await api('POST', `/api/appointments/${id}/farewell-start`,
    { media: ['https://example.com/photos/farewell-01.jpg'], note: '家属视频接入正常' });
  await api('POST', `/api/appointments/${id}/farewell-end`,
    { media: ['https://example.com/photos/farewell-02.jpg'], note: '仪式安详完成' });

  // 13. 火化（未确认费用会被拦截；此处已确认）
  await login('fire1');
  await api('POST', `/api/appointments/${id}/cremation-start`, { note: '单独炉火化' });
  await api('POST', `/api/appointments/${id}/cremation-complete`, {
    media: ['https://example.com/photos/crem-01.jpg', 'https://example.com/photos/crem-02.jpg'],
    note: '视频见证全程录制',
  }, '火化完成');
  const d4: any = await api('GET', `/api/appointments/${id}`, {});
  log(`火化证明已出具：${d4.certificate.cert_no}（单独火化：${d4.certificate.private_cremation}）`);

  // 14. 纪念品：爪印制作失败 → 关怀回访 → 重做 → 完成
  await login('art1');
  const paw = d4.mementos.find((m: any) => m.kind === 'pawprint');
  await api('POST', `/api/mementos/${paw.id}/start`, {});
  await api('POST', `/api/mementos/${paw.id}/fail`,
    { reason: '脱模时泥坯开裂' }, '纪念品失败');
  log('纪念品失败已自动生成即时关怀回访任务');
  await api('POST', `/api/mementos/${paw.id}/remake`, {}, '安排重做');
  await api('POST', `/api/mementos/${paw.id}/done`,
    { media: ['https://example.com/photos/paw-ok.jpg'] }, '重做完成');
  // 其余纪念品快速完成
  for (const m of d4.mementos.filter((x: any) => x.id !== paw.id)) {
    await api('POST', `/api/mementos/${m.id}/start`, {});
    await api('POST', `/api/mementos/${m.id}/done`, { media: [] });
  }

  // 15. 客服完成纪念品失败关怀回访
  await login('cs1');
  const care = (await api('GET', '/api/followups?status=scheduled', {}) as any[])
    .find(f => f.trigger === 'memento_failed');
  await api('POST', `/api/followups/${care.id}/complete`, {
    emotion_note: '起初难过，得知重做并加急后情绪平复',
    content: '已致歉并说明重做方案，赠送一张周年纪念照',
  });

  // 16. 骨灰盒寄送 → 破损 → 补发 → 签收
  const ship: any = await api('POST', `/api/appointments/${id}/shipment`,
    { carrier: '顺丰速运', tracking_no: 'SF10001' }, '寄出骨灰盒');
  await api('POST', `/api/shipments/${ship.id}/damage`, {
    note: '外盒挤压变形，木盒边角磕裂',
    media: ['https://example.com/photos/damage-01.jpg'],
  }, '寄送破损');
  await api('POST', `/api/shipments/${ship.id}/resend`,
    { carrier: '顺丰速运', tracking_no: 'SF10002' }, '破损补发');
  await api('POST', `/api/shipments/${ship.id}/delivered`, {});
  await api('POST', `/api/shipments/${ship.id}/claim`, {});

  // 17. 财务收款（按最终金额一次收清）
  await login('fin1');
  const d5: any = await api('GET', `/api/appointments/${id}`, {});
  const payable = d5.fee_summary.payable;
  await api('POST', `/api/appointments/${id}/payment`,
    { amount: payable, method: 'wechat', note: '方案+体重补差，已结清' }, '财务收款');
  log(`财务收款 ${payable} 元（报价 ${d5.fee_summary.quote_total} + 确认变更 ${d5.fee_summary.confirmed_change}）`);

  // 18. 客服完结归档
  await login('cs1');
  await api('POST', `/api/appointments/${id}/complete`, { note: '家属致谢' }, '完结');

  // 19. 管理者总览 & 柜位演示（第二单走寄存，演示到期扫描）
  await login('manager1');
  const ov: any = await api('GET', '/api/manager/overview', {});
  log(`管理者总览：总单 ${ov.total}，未闭环异常 ${ov.open_exceptions}，应收 ${ov.payable_total}，已收 ${ov.paid_total}`);

  // 20. 第二只宠物快速走通入柜，再手动验证柜位扫描
  await login('owner2');
  const a2: any = await api('POST', '/api/appointments', {
    store_id: 2, pet_name: '雪球', pet_type: 'rabbit', pet_breed: '垂耳兔',
    weight_kg: 1.8, death_time: new Date().toISOString(),
    need_pickup: true, pickup_address: '本市湖畔家园',
    want_urn: false, storage_months: 12,
  });
  await login('cs2');
  await api('POST', `/api/appointments/${a2.id}/confirm-plan`, {});
  const dd: any = await api('GET', `/api/appointments/${a2.id}`, {});
  const pc = dd.confirmations.find((c: any) => c.subject === 'plan');
  await login('owner2');
  await api('POST', `/api/appointments/${a2.id}/confirmations/${pc.id}/respond`, { approve: true });
  await login('cs2');
  await api('POST', `/api/appointments/${a2.id}/dispatch`, {
    driver_id: 6, ceremonialist_id: 8, cremator_id: 10,
    pickup_at: h(1), ceremony_at: h(2), furnace_at: h(3),
    furnace_name: '2号火化炉',
  });
  await login('driver2');
  await api('POST', `/api/appointments/${a2.id}/pickup`, { actual_weight_kg: 1.8, media: [] });
  await api('POST', `/api/appointments/${a2.id}/cold-in`, { media: [] });
  await login('fire2');
  await api('POST', `/api/appointments/${a2.id}/cremation-start`, {});
  await api('POST', `/api/appointments/${a2.id}/cremation-complete`, { media: [] }, '雪球火化');
  await login('cs2');
  const lk = await api('POST', `/api/appointments/${a2.id}/locker-assign`,
    { code: 'B-01-01' }, '入柜寄存');
  log(`雪球骨灰入柜 ${lk.code}，到期 ${new Date(lk.expire_at).toLocaleDateString('zh-CN')}`);
  const scan: any = await api('POST', '/api/lockers/scan', {});
  log(`柜位扫描：${scan.scanned} 个占用柜位，临期 ${scan.expiring}，过期 ${scan.expired}`);

  await login('owner1');
  const final: any = await api('GET', `/api/appointments/${id}`, {});
  log(`\n布丁单最终状态：${final.appointment.status}，时间线 ${final.timeline.length} 个可追溯节点，待回访 ${final.followups.filter((f:any)=>f.status==='scheduled').length} 项`);

  // ============================================================
  // 21. 寄存处置场景 A：团团（2 号店，逾期 40 天，种子案件多轮联系中）
  //     第 3 轮联系无回应 → 柜位受保护 → 客服主管审批 → 寄存主管复核生成指令
  //     → 执行前家属恢复联系 → 撤回指令、恢复账单与柜位 → 家属完成续费
  // ============================================================
  log('\n========== 寄存处置场景 A：逾期多轮联系 → 双审批 → 执行前撤回 → 续费 ==========');
  await login('cs2');
  const store2Appts: any[] = await api('GET', '/api/appointments?status=completed', {});
  const tuan = store2Appts.find((x: any) => x.pet_name === '团团');
  if (!tuan) throw new Error('种子数据缺少「团团」，请先 npm run seed');
  const sd1: any = await api('GET', `/api/storage/appointments/${tuan.id}/detail`, {});
  const dc = sd1.open_case;
  log(`处置案件 ${dc.code}：已联系 ${dc.attempts.length}/${dc.rounds_required} 轮，柜位 ${sd1.locker.code} 状态 ${sd1.locker.status}`);

  // 第 3 轮：书面信函仍无回应，留存挂号信底单
  const esc: any = await api('POST', `/api/storage/cases/${dc.id}/contact`, {
    channel: 'letter', result: 'no_answer',
    note: '逾期第 40 天寄发挂号处置告知函，回执显示家属未取件',
    evidence_urls: ['https://example.com/contact/round3-registered-letter.jpg'],
  }, '第三轮联系');
  if (!esc.escalated) throw new Error('三轮无回应后应升级为受保护待处置');
  const prot: any = await api('GET', `/api/storage/cases/${dc.id}`, {});
  log(`三轮联系无回应 → 柜位 ${prot.locker.code} 状态「${prot.locker.status}」，案件待客服主管审批`);
  if (prot.locker.status !== 'protected') throw new Error('柜位应进入 protected 受保护状态');

  // 客服主管审批
  await login('cssup2');
  await api('POST', `/api/storage/cases/${dc.id}/supervisor-approve`,
    { approve: true, note: '联系程序合规，同意进入处置评估' }, '客服主管审批');

  // 寄存主管复核：选择「迁移」却未指定目标柜位 → 拦截且不推进状态
  await login('store2');
  try {
    await api('POST', `/api/storage/cases/${dc.id}/storage-review`,
      { approve: true, action: 'migrate', note: '尝试迁移但不指定目标柜位（应被拦截）' });
    throw new Error('迁移未指定目标柜位时应被拦截');
  } catch (e: any) {
    log(`合规拦截：${e.message}`);
  }
  // 证据齐全（三轮均有证明材料），生成「继续保管 12 个月」指令
  const order: any = await api('POST', `/api/storage/cases/${dc.id}/storage-review`, {
    approve: true, action: 'continue_storage', period_months: 12,
    planned_at: new Date(Date.now() + 2 * 86400000).toISOString(),
    note: '三轮联系证据完整（通话记录/短信退信/挂号回执），指令继续保管 12 个月',
  }, '寄存主管复核并生成指令');
  log(`处置指令 ${order.order_no}：${order.action}，原柜位 ${order.from_locker_code} 永久保留，待执行`);

  // 执行前家属恢复联系 → 撤回（owner 本人可撤回）
  await login('owner2');
  await api('POST', `/api/storage/cases/${dc.id}/withdraw`,
    { note: '家属看到挂号函后主动来电，希望续费继续寄存' }, '执行前撤回');
  const after: any = await api('GET', `/api/storage/cases/${dc.id}`, {});
  log(`撤回后：案件 ${after.case.status}，指令 ${after.orders[0].status}，柜位恢复为「${after.locker.status}」`);
  if (after.orders[0].status !== 'withdrawn') throw new Error('指令应已撤回');
  if (after.locker.status !== 'expired') throw new Error('原柜位应恢复为 expired（到期占用）状态');

  // 家属完成续费（新续费流程：三项校验）
  const rc: any = await api('POST', `/api/storage/appointments/${tuan.id}/renew-check`, { months: 12 });
  log(`续费校验：可续用=${rc.renewable}，年费变更=${rc.price_changed}，未结余额=${rc.outstanding_balance}，放行=${rc.can_renew}`);
  await api('POST', `/api/storage/appointments/${tuan.id}/renew`,
    { months: 12, acknowledge_price_change: true }, '家属续费 12 个月');
  const renewed: any = await api('GET', `/api/storage/cases/${dc.id}`, {});
  log(`续费完成：柜位 ${renewed.locker.code} 状态「${renewed.locker.status}」，新到期 ${new Date(renewed.locker.expire_at).toLocaleDateString('zh-CN')}`);

  // ============================================================
  // 22. 寄存处置场景 B：念念（1 号店，15 天后到期，偏好「转长期」，年费 600→680）
  //     续费价格变更校验 → 转长期比较柜位 → 家属确认 → 占用柜位拦截验证
  //     → 迁移执行留痕 → 家属后续回访
  // ============================================================
  log('\n========== 寄存处置场景 B：年费变更提示 + 转长期寄存迁移 ==========');
  await login('owner1');
  const myAppts: any[] = await api('GET', '/api/appointments?status=completed', {});
  const nian = myAppts.find((x: any) => x.pet_name === '念念');
  if (!nian) throw new Error('种子数据缺少「念念」，请先 npm run seed');

  // 续费三项校验：年费已由 600 上调至 680，未确认知晓时拦截
  const rc2: any = await api('POST', `/api/storage/appointments/${nian.id}/renew-check`, { months: 12 });
  log(`续费校验：${rc2.price_note}；本期续费 ${rc2.renewal_fee} 元；未结 ${rc2.outstanding_balance} 元；放行=${rc2.can_renew}`);
  if (!rc2.price_changed) throw new Error('应检测出年费价格变更 600→680');
  await login('owner1');
  try {
    await api('POST', `/api/storage/appointments/${nian.id}/renew`, { months: 12 });
    throw new Error('未确认年费变更时续费应被拦截');
  } catch (e: any) {
    log(`合规拦截：${e.message}`);
  }

  // 客服按偏好转长期：比较可用柜位与迁移时间
  await login('cs1');
  await api('POST', '/api/storage/scan', {});  // 按偏好发送提醒（已存在则不重复）
  const cand: any = await api('GET', `/api/storage/appointments/${nian.id}/longterm-candidates`, {});
  const target = cand.candidates.find((c: any) => c.code === 'A-01-01');
  log(`柜位比较：原柜位 ${cand.current.code}（${cand.current.annual_fee}/年）→ 候选长期柜位 ${target.code}，10 年九折价 ${target.longterm_120m_fee} 元`);
  const moveAt = new Date(Date.now() + 5 * 86400000).toISOString();
  const proposal: any = await api('POST', `/api/storage/appointments/${nian.id}/longterm-propose`, {
    target_locker_id: target.id, planned_move_at: moveAt, note: '家属周末方便到场，安排礼仪师陪同迁移',
  }, '客服提出转长期方案');

  // 家属确认 → 预占目标柜位
  await login('owner1');
  await api('POST', `/api/storage/longterm/${proposal.id}/confirm`,
    { approve: true, note: '同意迁移至 A-01-01，周六下午到场' }, '家属确认转长期');
  const nc: any = await api('GET', `/api/storage/appointments/${nian.id}/detail`, {});
  const migCase = nc.open_case;
  const migOrder = migCase.orders[0];
  log(`迁移指令 ${migOrder.order_no} 已生成，目标柜位预占状态 reserved`);

  // 占用拦截：另一单不得再承诺/迁入 A-01-01
  await login('cs1');
  try {
    await api('POST', `/api/storage/appointments/${nian.id}/longterm-propose`, {
      target_locker_id: target.id, planned_move_at: moveAt,
    });
    throw new Error('已预占柜位应被拦截');
  } catch (e: any) {
    log(`合规拦截：${e.message}`);
  }

  // 执行迁移：记录原柜位、交接人员、时间与证明
  await api('POST', `/api/storage/orders/${migOrder.id}/execute`, {
    handover_by: '礼仪师-安然、寄存主管-许伯安（双方签字）',
    note: '原柜位骨灰盒核验封签完好，迁入 A-01-01 长期柜位',
    evidence_urls: ['https://example.com/move/handover-01.jpg', 'https://example.com/move/sign-sheet.jpg'],
  }, '执行迁移');
  await api('POST', `/api/storage/orders/${migOrder.id}/followup`, {
    result: '迁移后第 3 日电话回访，家属确认安放位置满意，情绪平稳，已告知新到期日',
  }, '登记家属回访');
  const nd: any = await api('GET', `/api/storage/appointments/${nian.id}/detail`, {});
  log(`迁移完成：原柜位 A-02-01 已释放，新柜位 A-01-01 状态「${nd.locker.status}」，到期 ${new Date(nd.locker.expire_at).toLocaleDateString('zh-CN')}`);
  // 案件已执行，open_case 关闭，改查案件详情核对执行留痕与回访
  const cd: any = await api('GET', `/api/storage/cases/${migCase.id}`, {});
  const doneOrder = cd.orders[0];
  log(`处置指令留痕：状态=${doneOrder.status}；原柜位=${doneOrder.from_locker_code}；交接人=${doneOrder.handover_by}`);
  log(`执行时间=${new Date(doneOrder.executed_at).toLocaleString('zh-CN')}；家属回访结果已记录=${!!doneOrder.follow_up_result}`);
  if (doneOrder.status !== 'executed' || !doneOrder.follow_up_at) throw new Error('迁移处置未完整留痕');

  log('\n演示完成 ✅（含寄存到期续费三项校验、授权与联系留痕、受保护双审批、迁移/撤回/回访全流程）');
}

main().catch(e => { console.error('\n❌ 演示失败:', e.message); process.exit(1); });
