import { Appointment } from '../entities/appointment';

/** 本地演示用报价规则：客服确认方案时给出建议价，可人工调整 */
export function suggestQuote(a: Partial<Appointment>) {
  const w = Number(a.weight_kg || 0);
  let base = 1680;
  if (w <= 5) base = 380;
  else if (w <= 10) base = 580;
  else if (w <= 20) base = 880;
  else if (w <= 35) base = 1280;
  const items: { kind: string; title: string; amount: number }[] = [
    { kind: 'base_quote', title: `基础善终火化服务费（${w}kg 档位）`, amount: base },
  ];
  if (a.pet_type === 'exotic') items.push({ kind: 'base_quote', title: '异宠特殊处理', amount: 200 });
  if (a.need_pickup) items.push({ kind: 'extra_pickup', title: '上门接送服务', amount: 150 });
  if (a.want_ceremony) items.push({ kind: 'ceremony', title: '纪念告别仪式', amount: 300 });
  if (a.private_cremation) items.push({ kind: 'private', title: '单独火化（非集体炉火化）', amount: 600 });
  if (a.want_urn) items.push({ kind: 'urn', title: '骨灰盒', amount: 280 });
  if (a.pawprint_hair) items.push({ kind: 'memento', title: '爪印毛发纪念品', amount: 180 });
  if (a.photo_video) items.push({ kind: 'memento', title: '全程照片视频记录', amount: 120 });
  if (a.storage_months > 0) {
    items.push({ kind: 'storage', title: `骨灰寄存 ${a.storage_months} 个月（柜位年费 600 元/年按比例）`,
      amount: Math.round((a.storage_months / 12) * 600) });
  }
  const total = items.reduce((s, i) => s + i.amount, 0);
  return { items, total };
}

/** 体重与报价不符时的补差规则：20 元/kg */
export function weightAdjustment(declaredKg: number, actualKg: number) {
  const diff = Math.round((actualKg - declaredKg) * 10) / 10;
  return { diff, amount: Math.round(diff * 20 * 100) / 100 };
}
