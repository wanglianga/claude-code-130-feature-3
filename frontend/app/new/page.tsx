'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '../AppShell';
import { api } from '../lib';

export default function NewAppointment() {
  const router = useRouter();
  const [stores, setStores] = useState<any[]>([]);
  const [hospitals, setHospitals] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const now = new Date(Date.now() - 3600e3);
  const isoLocal = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState<any>({
    store_id: '', hospital_id: '', pet_name: '', pet_type: 'cat', pet_breed: '',
    weight_kg: '', death_time: isoLocal, need_pickup: false, pickup_address: '',
    want_ceremony: false, private_cremation: false, want_urn: false,
    pawprint_hair: false, photo_video: false, storage_months: 0,
  });
  const set = (k: string, v: any) => setF({ ...f, [k]: v });

  useEffect(() => {
    api('GET', '/api/stores').then((d: any) => { setStores(d); if (d[0]) set('store_id', d[0].id); });
  }, []);
  useEffect(() => {
    if (f.store_id) api('GET', `/api/hospitals?store_id=${f.store_id}`).then(setHospitals);
  }, [f.store_id]);

  async function submit() {
    setErr('');
    if (!f.pet_name || !f.pet_breed || !f.weight_kg) { setErr('请填写宠物姓名、品种与体重'); return; }
    try {
      const a = await api('POST', '/api/appointments', {
        ...f, hospital_id: f.hospital_id || null,
        death_time: new Date(f.death_time).toISOString(),
      });
      setOk(true);
      setTimeout(() => router.push(`/appointments/${a.id}`), 600);
    } catch (e: any) { setErr(e.message); }
  }

  const checks: [string, string, string][] = [
    ['need_pickup', '上门接送', '无法自行送达时，安排接送员上门'],
    ['want_ceremony', '纪念告别仪式', '告别室与礼仪师陪同家属道别'],
    ['private_cremation', '单独火化', '单炉火化，骨灰不混淆'],
    ['want_urn', '骨灰盒', '实木骨灰盒，可到店领取或寄送'],
    ['pawprint_hair', '爪印 / 毛发纪念', '制作爪印泥牌与毛发纪念坠'],
    ['photo_video', '照片 / 视频记录', '全程照片与视频留念，支持视频见证'],
  ];

  return (
    <AppShell>
      <div className="hero">
        <h1>送别 TA，请告诉我们 TA 的故事</h1>
        <p>提交后客服将尽快与您确认服务方案与报价；每一个环节都会留下见证材料，您可以随时查看。</p>
      </div>
      {err && <div className="error">{err}</div>}
      {ok && <div className="ok-msg">预约已提交，正在跳转到工单页…</div>}
      <div className="grid2">
        <div className="panel">
          <h2>宠物信息</h2>
          <label>服务门店</label>
          <select value={f.store_id} onChange={e => set('store_id', Number(e.target.value))}>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}（{s.address}）</option>)}
          </select>
          <label>由宠物医院转介（可选）</label>
          <select value={f.hospital_id} onChange={e => set('hospital_id', Number(e.target.value) || '')}>
            <option value="">非医院转介</option>
            {hospitals.map(h => <option key={h.id} value={h.id}>{h.name} · {h.contact}</option>)}
          </select>
          <div className="row">
            <div><label>宠物姓名 *</label><input value={f.pet_name} onChange={e => set('pet_name', e.target.value)} placeholder="如：布丁" /></div>
            <div><label>种类</label>
              <select value={f.pet_type} onChange={e => set('pet_type', e.target.value)}>
                <option value="cat">猫</option><option value="dog">犬</option>
                <option value="rabbit">兔</option><option value="exotic">异宠</option>
              </select>
            </div>
          </div>
          <div className="row">
            <div><label>品种 *</label><input value={f.pet_breed} onChange={e => set('pet_breed', e.target.value)} placeholder="如：英国短毛猫" /></div>
            <div><label>体重 kg *</label><input type="number" step="0.1" value={f.weight_kg} onChange={e => set('weight_kg', e.target.value)} /></div>
          </div>
          <label>离世时间</label>
          <input type="datetime-local" value={f.death_time} onChange={e => set('death_time', e.target.value)} />
          {f.need_pickup && <>
            <label>接送地址</label>
            <textarea rows={2} value={f.pickup_address} onChange={e => set('pickup_address', e.target.value)} placeholder="小区/楼栋与联系方式说明" />
          </>}
        </div>

        <div className="panel">
          <h2>服务选择</h2>
          <div className="checkgrid">
            {checks.map(([k, label, tip]) => (
              <label key={k} title={tip}>
                <input type="checkbox" checked={f[k]} onChange={e => set(k, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          <label>骨灰寄存期限（月，0 表示不寄存）</label>
          <select value={f.storage_months} onChange={e => set('storage_months', Number(e.target.value))}>
            {[0, 1, 3, 6, 12, 24, 36].map(m => <option key={m} value={m}>{m === 0 ? '不寄存' : `${m} 个月`}</option>)}
          </select>
          <p className="muted">寄存按柜位年费 600 元/年（标准柜）折算，到期前 30 天客服会提醒续费；
            报价以客服核定方案为准，体重复称不符时将按 20 元/kg 多退少补并需您确认。</p>
          <button onClick={submit} style={{ marginTop: 10 }}>提交预约，等待客服确认</button>
        </div>
      </div>
    </AppShell>
  );
}
