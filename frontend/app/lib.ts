'use client';

export const API = process.env.NEXT_PUBLIC_API || 'http://127.0.0.1:4000';

export type Session = { token: string; user: any };

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('pa_session');
  return raw ? JSON.parse(raw) : null;
}
export function setSession(s: Session | null) {
  if (s) localStorage.setItem('pa_session', JSON.stringify(s));
  else localStorage.removeItem('pa_session');
}

export async function api(method: string, path: string, body?: any): Promise<any> {
  const s = getSession();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(s ? { Authorization: `Bearer ${s.token}` } : {}),
    },
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = Array.isArray(data.message) ? data.message.join('；') : (data.message || `请求失败 ${res.status}`);
    throw new Error(m);
  }
  return data;
}

export const ROLE_LABEL: Record<string, string> = {
  owner: '宠物主人',
  customer_service: '客服',
  cs_supervisor: '客服主管',
  storage_manager: '寄存主管',
  driver: '接送员',
  ceremonialist: '礼仪师',
  cremator: '火化师',
  artisan: '纪念品制作',
  finance: '财务',
  manager: '管理者',
};

export const LOCKER_STATUS_LABEL: Record<string, string> = {
  free: '空闲', occupied: '占用中', expiring: '临期', expired: '已到期',
  protected: '受保护待处置', reserved: '迁移预占',
};

export const CASE_STATUS_LABEL: Record<string, string> = {
  contacting: '多轮联系中',
  awaiting_supervisor: '待客服主管审批',
  awaiting_storage_review: '待寄存主管复核',
  ordered: '处置指令待执行',
  executed: '处置已执行',
  withdrawn: '已撤回（家属恢复联系）',
  closed_resolved: '家属自行处理闭环',
};

export const CASE_REASON_LABEL: Record<string, string> = {
  overdue_no_response: '逾期多轮联系无回应',
  owner_longterm_request: '家属申请转长期',
};

export const DISPOSITION_ACTION_LABEL: Record<string, string> = {
  migrate: '迁移长期柜位', continue_storage: '继续保管', retrieve: '家属取回', other: '其他合规处置',
};

export const CONTACT_CHANNEL_LABEL: Record<string, string> = {
  phone: '电话', sms: '短信', wechat: '微信', email: '邮件', letter: '书面信函', onsite: '上门',
};

export const CONTACT_RESULT_LABEL: Record<string, string> = {
  reached: '已联系上', promised: '家属承诺处理', no_answer: '无人接听',
  bounced: '空号/停机/退信', refused: '明确拒绝', message_left: '已留言待回',
};

export const STATUS_LABEL: Record<string, string> = {
  submitted: '待客服确认',
  cs_confirmed: '方案待家属确认',
  scheduled: '已调度',
  picked_up: '已接运',
  in_storage: '冷藏暂存中',
  farewell: '告别仪式中',
  cremating: '火化中',
  fulfilled: '火化完成待收尾',
  completed: '已完结',
  cancelled: '已取消',
};

export function statusTag(s: string) {
  const map: Record<string, string> = {
    submitted: 'warn', cs_confirmed: 'info', scheduled: 'info', picked_up: '',
    in_storage: 'info', farewell: 'warn', cremating: 'warn', fulfilled: '',
    completed: 'ok', cancelled: 'bad',
  };
  return map[s] || '';
}

export function fmt(d?: string | Date | null) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(+dt)) return '—';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

export function yuan(v: any) { return `¥${Number(v || 0).toFixed(2)}`; }

export const PET_LABEL: Record<string, string> = {
  cat: '猫', dog: '犬', rabbit: '兔', exotic: '异宠',
};

export const TRIGGER_LABEL: Record<string, string> = {
  routine: '常规回访',
  memento_failed: '纪念品失败关怀',
  urn_damaged: '骨灰盒破损关怀',
  locker_expiring: '柜位临期提醒',
  locker_expired: '到期未续费跟进',
  locker_renew_reminder: '到期续费提醒',
  locker_retrieve_reminder: '到期取回提醒',
  locker_longterm_reminder: '转长期提醒',
  disposition_followup: '处置后家属回访',
  post_service: '服务后情绪安抚',
};
