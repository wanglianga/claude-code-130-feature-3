'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, setSession } from '../lib';

export default function RegisterPage() {
  const router = useRouter();
  const [f, setF] = useState({ username: '', password: '123456', name: '', phone: '' });
  const [err, setErr] = useState('');
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    setErr('');
    try {
      await api('POST', '/auth/register', f);
      const r = await api('POST', '/auth/login', { username: f.username, password: f.password });
      setSession(r);
      router.push('/appointments');
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="login-wrap">
      <div className="panel">
        <h2>注册宠物主人账号</h2>
        {err && <div className="error">{err}</div>}
        <label>用户名</label><input value={f.username} onChange={set('username')} />
        <label>密码</label><input type="password" value={f.password} onChange={set('password')} />
        <label>称呼</label><input value={f.name} onChange={set('name')} placeholder="如：王女士" />
        <label>手机号</label><input value={f.phone} onChange={set('phone')} />
        <div style={{ marginTop: 12 }}>
          <button onClick={submit}>注册并进入</button>
          <Link className="btn ghost" href="/login">返回登录</Link>
        </div>
      </div>
    </div>
  );
}
