import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';
const isConfigured = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('YOUR_');
const SESSION_KEY = 'greenpocket-session';

async function writeSession(value) {
  const text = value ? JSON.stringify(value) : '';
  if (Platform.OS === 'web') {
    if (value) globalThis.localStorage?.setItem(SESSION_KEY, text);
    else globalThis.localStorage?.removeItem(SESSION_KEY);
  } else if (value) await SecureStore.setItemAsync(SESSION_KEY, text);
  else await SecureStore.deleteItemAsync(SESSION_KEY);
}

async function readSession() {
  const text = Platform.OS === 'web' ? globalThis.localStorage?.getItem(SESSION_KEY) : await SecureStore.getItemAsync(SESSION_KEY);
  return text ? JSON.parse(text) : null;
}

const C = {
  dark: '#123B2A', green: '#2F8F5B', lime: '#70C890', pale: '#DFF3E7',
  bg: '#F5FAF7', white: '#FFFFFF', ink: '#18352A', muted: '#718178',
  red: '#E35D5D', redPale: '#FCE9E7', line: '#E1ECE5', amber: '#F2A93B',
};
const DEFAULT_CATEGORIES = ['ทั่วไป', 'อาหาร', 'เดินทาง', 'งาน'];
const DEMO_TRANSACTIONS = [
  { id: 'd1', title: 'เงินเดือน', amount: 28000, type: 'income', category: 'งาน', transaction_date: new Date().toISOString().slice(0, 10) },
  { id: 'd2', title: 'ค่าอาหาร', amount: 120, type: 'expense', category: 'อาหาร', transaction_date: new Date().toISOString().slice(0, 10) },
];

const money = (n) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(Number(n || 0));
const today = () => new Date().toISOString().slice(0, 10);
const monthNow = () => today().slice(0, 7);
const monthLabel = (value) => {
  const [y, m] = value.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
};
const shiftMonth = (value, delta) => {
  const [y, m] = value.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

async function authRequest(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST', signal: controller.signal,
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.error_description || data.message || 'เข้าสู่ระบบไม่สำเร็จ');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('เชื่อมต่อ Supabase หมดเวลา กรุณาลองใหม่');
    throw error;
  } finally { clearTimeout(timer); }
}

async function restRequest(path, token, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) {
    const raw = data?.message || data?.details || data?.hint || data || 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ';
    const message = String(raw);
    if (/user_id|transaction_date|schema cache|column/i.test(message)) {
      throw new Error('โครงสร้างตาราง transactions ยังไม่ครบ กรุณารัน SQL migration ใน README บน Supabase');
    }
    if (/row-level security|policy|permission denied|42501/i.test(message)) {
      throw new Error('Supabase ปฏิเสธสิทธิ์บันทึก กรุณาตรวจ RLS policy ของตาราง transactions');
    }
    if (/relation .* does not exist|42P01/i.test(message)) {
      throw new Error('ยังไม่พบตารางที่แอปต้องใช้ กรุณารัน SQL migration ใน README บน Supabase');
    }
    throw new Error(message);
  }
  return data;
}

function AuthScreen({ onSession, onDemo }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('error');
  const authAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    Animated.timing(authAnim, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [authAnim]);

  async function submit() {
    setNotice('');
    if (!isConfigured) { setNotice('ยังไม่ได้ตั้งค่า Supabase URL และ Key'); return; }
    if (!email.includes('@') || password.length < 6) { setNotice('กรุณาใส่อีเมลและรหัสผ่านอย่างน้อย 6 ตัวอักษร'); return; }
    setBusy(true);
    try {
      if (mode === 'login') {
        const data = await authRequest('token?grant_type=password', { email, password });
        onSession(data);
      } else {
        const data = await authRequest('signup', { email, password });
        if (data.access_token) onSession(data);
        else { setNoticeType('success'); setNotice('สมัครสำเร็จ กรุณาตรวจสอบอีเมลเพื่อยืนยันบัญชี แล้วกลับมาเข้าสู่ระบบ'); }
      }
    } catch (error) { setNoticeType('error'); setNotice(error.message || 'ไม่สามารถเชื่อมต่อ Supabase ได้'); }
    finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={s.authPage}>
      <StatusBar barStyle="light-content" backgroundColor={C.dark} />
      <Animated.View style={[s.authHero, { opacity: authAnim, transform: [{ translateY: authAnim.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }) }] }]}><Text style={s.authEmoji}>🌿</Text><Text style={s.authBrand}>GreenPocket</Text><Text style={s.authSub}>จัดการเงินให้ง่ายและเป็นส่วนตัว</Text></Animated.View>
      <Animated.View style={[s.authCard, { opacity: authAnim, transform: [{ translateY: authAnim.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] }]}>
        <View style={s.authTabs}>
          {['login', 'signup'].map((x) => <Pressable key={x} onPress={() => { setMode(x); setNotice(''); setNoticeType('error'); }} style={[s.authTab, mode === x && s.authTabOn]}><Text style={[s.authTabText, mode === x && s.authTabTextOn]}>{x === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</Text></Pressable>)}
        </View>
        <Text style={s.label}>อีเมล</Text>
        <TextInput style={s.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="name@example.com" />
        <Text style={s.label}>รหัสผ่าน</Text>
        <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="อย่างน้อย 6 ตัวอักษร" />
        <Pressable accessibilityRole="button" style={({ pressed }) => [s.primary, pressed && { opacity: .78, transform: [{ scale: .98 }] }]} onPress={submit} disabled={busy}>{busy ? <ActivityIndicator color="white" /> : <Text style={s.primaryText}>{mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}</Text>}</Pressable>
        {!!notice && <Text style={[s.authNotice, noticeType === 'success' && s.authNoticeSuccess]}>{notice}</Text>}
        <Pressable onPress={onDemo} style={s.demoButton}><Text style={s.demoButtonText}>ทดลองใช้โดยไม่เข้าสู่ระบบ</Text></Pressable>
        {!isConfigured && <Text style={s.warning}>ยังไม่ได้ตั้งค่า Supabase URL และ Key</Text>}
      </Animated.View>
    </SafeAreaView>
  );
}

function Summary({ transactions }) {
  const totals = transactions.reduce((a, x) => { a[x.type] += Number(x.amount); return a; }, { income: 0, expense: 0 });
  return (
    <View style={s.summary}>
      <Text style={s.summaryLabel}>ยอดคงเหลือเดือนนี้</Text><Text style={s.balance}>{money(totals.income - totals.expense)}</Text>
      <View style={s.summaryRow}><View style={s.summaryHalf}><Text style={s.smallMuted}>● รายรับ</Text><Text style={s.income}>{money(totals.income)}</Text></View><View style={s.vline} /><View style={s.summaryHalf}><Text style={s.smallMuted}>● รายจ่าย</Text><Text style={s.expense}>{money(totals.expense)}</Text></View></View>
    </View>
  );
}

function SpendingChart({ transactions }) {
  const rows = useMemo(() => {
    const map = {};
    transactions.filter((x) => x.type === 'expense').forEach((x) => { map[x.category] = (map[x.category] || 0) + Number(x.amount); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [transactions]);
  const max = Math.max(...rows.map((x) => x[1]), 1);
  if (!rows.length) return null;
  return <View style={s.panel}><Text style={s.panelTitle}>รายจ่ายตามหมวดหมู่</Text>{rows.map(([name, value]) => <View key={name} style={s.chartRow}><View style={s.chartLabelRow}><Text style={s.chartLabel}>{name}</Text><Text style={s.chartValue}>{money(value)}</Text></View><View style={s.track}><View style={[s.bar, { width: `${Math.max(7, value / max * 100)}%` }]} /></View></View>)}</View>;
}

function BudgetPanel({ budgets, transactions, onManage }) {
  if (!budgets.length) return <Pressable style={s.emptyBudget} onPress={onManage}><Text style={s.emptyBudgetTitle}>🎯 ตั้งงบประมาณเดือนนี้</Text><Text style={s.emptyBudgetText}>แตะเพื่อกำหนดวงเงินแต่ละหมวด</Text></Pressable>;
  return <View style={s.panel}><View style={s.rowBetween}><Text style={s.panelTitle}>งบประมาณ</Text><Pressable onPress={onManage}><Text style={s.link}>จัดการ</Text></Pressable></View>{budgets.map((b) => {
    const spent = transactions.filter((x) => x.type === 'expense' && x.category === b.category).reduce((n, x) => n + Number(x.amount), 0);
    const pct = Math.min(spent / Number(b.amount) * 100, 100);
    return <View key={b.id || b.category} style={s.budgetRow}><View style={s.chartLabelRow}><Text style={s.chartLabel}>{b.category}</Text><Text style={[s.chartValue, spent > Number(b.amount) && { color: C.red }]}>{money(spent)} / {money(b.amount)}</Text></View><View style={s.track}><View style={[s.budgetBar, { width: `${pct}%`, backgroundColor: spent > Number(b.amount) ? C.red : C.green }]} /></View></View>;
  })}</View>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [demo, setDemo] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [budgets, setBudgets] = useState([]);
  const [month, setMonth] = useState(monthNow());
  const [filter, setFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('ทั้งหมด');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [transactionModal, setTransactionModal] = useState(false);
  const [transactionError, setTransactionError] = useState('');
  const [savingTransaction, setSavingTransaction] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [budgetModal, setBudgetModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [type, setType] = useState('expense');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('ทั่วไป');
  const [date, setDate] = useState(today());
  const [newCategory, setNewCategory] = useState('');
  const [budgetCategory, setBudgetCategory] = useState('อาหาร');
  const [budgetAmount, setBudgetAmount] = useState('');
  const intro = useState(new Animated.Value(0))[0];
  const pulse = useState(new Animated.Value(1))[0];

  useEffect(() => {
    Animated.timing(intro, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.045, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [intro, pulse]);

  useEffect(() => {
    (async () => {
      try {
        const saved = await readSession();
        if (saved?.refresh_token) {
          const fresh = saved.expires_at && saved.expires_at * 1000 > Date.now() + 60000
            ? saved
            : await authRequest('token?grant_type=refresh_token', { refresh_token: saved.refresh_token });
          setSession(fresh);
          await writeSession(fresh);
        }
      } catch (_) { await writeSession(null); }
      finally { setBooting(false); }
    })();
  }, []);

  async function acceptSession(value) { setSession(value); await writeSession(value); }
  async function logout() { setSession(null); setDemo(false); await writeSession(null); }

  const user = session?.user;
  const token = session?.access_token;
  // loadAll depends on the active account and selected month only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) loadAll(); }, [user?.id, month]);
  useEffect(() => { if (demo) { setTransactions(DEMO_TRANSACTIONS); setCategories(DEFAULT_CATEGORIES); } }, [demo]);

  async function loadAll() {
    setLoading(true);
    try {
      const [tx, cats, bg] = await Promise.all([
        restRequest(`transactions?select=*&transaction_date=gte.${month}-01&transaction_date=lt.${shiftMonth(month, 1)}-01&order=transaction_date.desc,created_at.desc`, token),
        restRequest('categories?select=*&order=name.asc', token),
        restRequest(`budgets?select=*&month=eq.${month}&order=category.asc`, token),
      ]);
      setTransactions(tx || []);
      setCategories([...new Set([...DEFAULT_CATEGORIES, ...(cats || []).map((x) => x.name)])]);
      setBudgets(bg || []);
    } catch (error) { Alert.alert('โหลดข้อมูลไม่สำเร็จ', error.message); }
    finally { setLoading(false); }
  }

  const monthTransactions = transactions.filter((x) => (x.transaction_date || x.created_at?.slice(0, 10) || '').startsWith(month));
  const visible = monthTransactions.filter((x) => (filter === 'all' || x.type === filter) && (categoryFilter === 'ทั้งหมด' || x.category === categoryFilter) && x.title.toLowerCase().includes(search.trim().toLowerCase()));

  function resetForm() { setEditing(null); setType('expense'); setTitle(''); setAmount(''); setCategory(categories[0] || 'ทั่วไป'); setDate(today()); setTransactionError(''); }
  function openAdd() { resetForm(); setTransactionModal(true); }
  function openEdit(item) { setEditing(item); setType(item.type); setTitle(item.title); setAmount(String(item.amount)); setCategory(item.category); setDate(item.transaction_date || item.created_at.slice(0, 10)); setTransactionModal(true); }

  async function saveTransaction() {
    const numeric = Number(amount.replace(/,/g, ''));
    setTransactionError('');
    if (!title.trim() || !Number.isFinite(numeric) || numeric <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setTransactionError('กรอกชื่อ จำนวนเงิน และวันที่รูปแบบ YYYY-MM-DD ให้ครบ');
      return;
    }
    if (!demo && (!user?.id || !token)) {
      setTransactionError('เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่');
      return;
    }
    const row = { title: title.trim(), amount: numeric, type, category, transaction_date: date };
    setSavingTransaction(true);
    try {
      if (demo) {
        if (editing) setTransactions((old) => old.map((x) => x.id === editing.id ? { ...x, ...row } : x));
        else setTransactions((old) => [{ ...row, id: String(Date.now()) }, ...old]);
      } else if (editing) {
        const data = await restRequest(`transactions?id=eq.${editing.id}`, token, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
        setTransactions((old) => old.map((x) => x.id === editing.id ? data[0] : x));
      } else {
        const data = await restRequest('transactions', token, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...row, user_id: user.id }) });
        setTransactions((old) => [data[0], ...old]);
      }
      setTransactionModal(false); resetForm();
    } catch (error) { setTransactionError(error.message || 'บันทึกรายการไม่สำเร็จ'); }
    finally { setSavingTransaction(false); }
  }

  function askDelete(item) {
    Alert.alert('ลบรายการ?', item.title, [{ text: 'ยกเลิก', style: 'cancel' }, { text: 'ลบ', style: 'destructive', onPress: async () => {
      try { if (!demo) await restRequest(`transactions?id=eq.${item.id}`, token, { method: 'DELETE' }); setTransactions((old) => old.filter((x) => x.id !== item.id)); }
      catch (error) { Alert.alert('ลบไม่สำเร็จ', error.message); }
    } }]);
  }

  async function addCategory() {
    const name = newCategory.trim();
    if (!name || categories.includes(name)) return;
    try {
      if (!demo) await restRequest('categories', token, { method: 'POST', body: JSON.stringify({ user_id: user.id, name }) });
      setCategories((old) => [...old, name]); setNewCategory(''); setCategory(name);
    } catch (error) { Alert.alert('เพิ่มหมวดหมู่ไม่สำเร็จ', error.message); }
  }

  async function removeCategory(name) {
    try {
      if (!demo) await restRequest(`categories?name=eq.${encodeURIComponent(name)}`, token, { method: 'DELETE' });
      setCategories((old) => old.filter((x) => x !== name));
      if (categoryFilter === name) setCategoryFilter('ทั้งหมด');
    } catch (error) { Alert.alert('ลบหมวดหมู่ไม่สำเร็จ', error.message); }
  }

  async function saveBudget() {
    const numeric = Number(budgetAmount.replace(/,/g, ''));
    if (numeric <= 0) { Alert.alert('จำนวนเงินไม่ถูกต้อง'); return; }
    const row = { user_id: user?.id || 'demo', category: budgetCategory, amount: numeric, month };
    try {
      if (demo) setBudgets((old) => [...old.filter((x) => x.category !== budgetCategory), { ...row, id: budgetCategory }]);
      else {
        const data = await restRequest('budgets?on_conflict=user_id,category,month', token, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row) });
        setBudgets((old) => [...old.filter((x) => x.category !== budgetCategory), data[0]]);
      }
      setBudgetAmount(''); setBudgetModal(false);
    } catch (error) { Alert.alert('ตั้งงบไม่สำเร็จ', error.message); }
  }

  async function exportCsv() {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['วันที่,ประเภท,รายการ,หมวดหมู่,จำนวนเงิน', ...visible.map((x) => [x.transaction_date, x.type === 'income' ? 'รายรับ' : 'รายจ่าย', x.title, x.category, x.amount].map(q).join(','))].join('\n');
    try {
      if (Platform.OS === 'web') {
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = `greenpocket-${month}.csv`; a.click(); URL.revokeObjectURL(url);
      } else await Share.share({ title: `GreenPocket ${month}`, message: csv });
    } catch (error) { Alert.alert('ส่งออกไม่สำเร็จ', error.message); }
  }

  if (booting) return <SafeAreaView style={[s.authPage, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator size="large" color={C.lime} /><Text style={{ color: C.white, marginTop: 12 }}>กำลังตรวจสอบการเข้าสู่ระบบ...</Text></SafeAreaView>;
  if (!session && !demo) return <AuthScreen onSession={acceptSession} onDemo={() => setDemo(true)} />;

  const renderTransaction = ({ item }) => <Pressable style={s.tx} onPress={() => openEdit(item)}>
    <View style={[s.txIcon, item.type === 'income' ? s.txIncome : s.txExpense]}><Text style={s.txArrow}>{item.type === 'income' ? '↙' : '↗'}</Text></View>
    <View style={{ flex: 1 }}><Text style={s.txTitle}>{item.title}</Text><Text style={s.txMeta}>{item.category} • {new Date(item.transaction_date + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</Text></View>
    <View style={{ alignItems: 'flex-end' }}><Text style={[s.txAmount, { color: item.type === 'income' ? C.green : C.red }]}>{item.type === 'income' ? '+' : '-'}{money(item.amount)}</Text><Pressable onPress={() => askDelete(item)} hitSlop={8}><Text style={s.delete}>ลบ</Text></Pressable></View>
  </Pressable>;

  return <SafeAreaView style={s.safe}>
    <StatusBar barStyle="light-content" backgroundColor={C.dark} />
    <Animated.View style={[s.header, { opacity: intro, transform: [{ translateY: intro.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }]}><View><Text style={s.hello}>{demo ? 'โหมดทดลอง' : user?.email}</Text><Text style={s.brand}>GreenPocket</Text></View><Pressable onPress={logout} style={s.logout}><Text style={s.logoutText}>ออก</Text></Pressable></Animated.View>
    <FlatList data={visible} keyExtractor={(x) => String(x.id)} renderItem={renderTransaction} contentContainerStyle={s.content} ListHeaderComponent={<Animated.View style={{ opacity: intro, transform: [{ translateY: intro.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }] }}>
      <View style={s.monthNav}><Pressable onPress={() => setMonth(shiftMonth(month, -1))}><Text style={s.monthArrow}>‹</Text></Pressable><Text style={s.monthText}>{monthLabel(month)}</Text><Pressable onPress={() => setMonth(shiftMonth(month, 1))}><Text style={s.monthArrow}>›</Text></Pressable></View>
      <Summary transactions={monthTransactions} />
      <SpendingChart transactions={monthTransactions} />
      <BudgetPanel budgets={budgets} transactions={monthTransactions} onManage={() => setBudgetModal(true)} />
      <View style={s.tools}><Pressable style={s.toolButton} onPress={() => setCategoryModal(true)}><Text style={s.toolIcon}>🏷️</Text><Text style={s.toolText}>หมวดหมู่</Text></Pressable><Pressable style={s.toolButton} onPress={() => setBudgetModal(true)}><Text style={s.toolIcon}>🎯</Text><Text style={s.toolText}>ตั้งงบ</Text></Pressable><Pressable style={s.toolButton} onPress={exportCsv}><Text style={s.toolIcon}>📤</Text><Text style={s.toolText}>CSV</Text></Pressable></View>
      <Text style={s.sectionTitle}>รายการ</Text>
      <TextInput style={s.search} value={search} onChangeText={setSearch} placeholder="🔎 ค้นหารายการ..." placeholderTextColor="#93A299" />
      <View style={s.filterRow}>{[['all','ทั้งหมด'],['income','รายรับ'],['expense','รายจ่าย']].map(([v,l]) => <Pressable key={v} onPress={() => setFilter(v)} style={[s.chip, filter === v && s.chipOn]}><Text style={[s.chipText, filter === v && s.chipTextOn]}>{l}</Text></Pressable>)}</View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 7 }}>{['ทั้งหมด', ...categories].map((x) => <Pressable key={x} onPress={() => setCategoryFilter(x)} style={[s.categoryFilter, categoryFilter === x && s.categoryFilterOn]}><Text style={[s.categoryFilterText, categoryFilter === x && { color: C.green, fontWeight: '800' }]}>{x}</Text></Pressable>)}</ScrollView>
    </Animated.View>} ListEmptyComponent={loading ? <ActivityIndicator color={C.green} /> : <View style={s.empty}><Text style={s.emptyEmoji}>🌱</Text><Text style={s.emptyTitle}>ไม่พบรายการ</Text><Text style={s.smallMuted}>ลองเปลี่ยนตัวกรองหรือเพิ่มรายการใหม่</Text></View>} />
    <Animated.View style={[s.fab, { transform: [{ scale: pulse }] }]}><Pressable style={s.fabPress} onPress={openAdd}><Text style={s.fabText}>＋ เพิ่มรายการ</Text></Pressable></Animated.View>

    <Modal visible={transactionModal} transparent animationType="slide" onRequestClose={() => setTransactionModal(false)}><KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }} keyboardShouldPersistTaps="handled"><View style={s.sheet}><View style={s.handle} /><Text style={s.sheetTitle}>{editing ? 'แก้ไขรายการ' : 'เพิ่มรายการใหม่'}</Text><View style={s.segment}>{['income','expense'].map((x) => <Pressable key={x} onPress={() => setType(x)} style={[s.segmentButton, type === x && { backgroundColor: x === 'income' ? C.green : C.red }]}><Text style={[s.segmentText, type === x && { color: C.white }]}>{x === 'income' ? '＋ รายรับ' : '− รายจ่าย'}</Text></Pressable>)}</View><Text style={s.label}>ชื่อรายการ</Text><TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="เช่น ค่าอาหาร" /><Text style={s.label}>จำนวนเงิน</Text><TextInput style={[s.input, { fontSize: 20, fontWeight: '800' }]} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" /><Text style={s.label}>วันที่ (YYYY-MM-DD)</Text><TextInput style={s.input} value={date} onChangeText={setDate} placeholder="2026-09-23" /><Text style={s.label}>หมวดหมู่</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categoryChoices}>{categories.map((x) => <Pressable key={x} onPress={() => setCategory(x)} style={[s.categoryChoice, category === x && s.categoryChoiceOn]}><Text style={[s.categoryChoiceText, category === x && { color: C.green, fontWeight: '800' }]}>{x}</Text></Pressable>)}</ScrollView>{!!transactionError && <Text style={s.formError}>{transactionError}</Text>}<Pressable disabled={savingTransaction} style={[s.primary, savingTransaction && { opacity: 0.6 }]} onPress={saveTransaction}><Text style={s.primaryText}>{savingTransaction ? 'กำลังบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'บันทึกรายการ'}</Text></Pressable><Pressable disabled={savingTransaction} style={s.cancel} onPress={() => setTransactionModal(false)}><Text style={s.cancelText}>ยกเลิก</Text></Pressable></View></ScrollView></KeyboardAvoidingView></Modal>

    <Modal visible={categoryModal} transparent animationType="slide" onRequestClose={() => setCategoryModal(false)}><KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={s.sheet}><View style={s.handle} /><Text style={s.sheetTitle}>จัดการหมวดหมู่</Text><View style={s.inline}><TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} value={newCategory} onChangeText={setNewCategory} placeholder="ชื่อหมวดหมู่ใหม่" /><Pressable style={s.addSmall} onPress={addCategory}><Text style={s.primaryText}>เพิ่ม</Text></Pressable></View><View style={{ marginTop: 16 }}>{categories.map((x) => <View key={x} style={s.manageRow}><Text style={s.manageName}>{x}</Text>{!DEFAULT_CATEGORIES.includes(x) && <Pressable onPress={() => removeCategory(x)}><Text style={s.delete}>ลบ</Text></Pressable>}</View>)}</View><Pressable style={s.cancel} onPress={() => setCategoryModal(false)}><Text style={s.cancelText}>เสร็จแล้ว</Text></Pressable></View></KeyboardAvoidingView></Modal>

    <Modal visible={budgetModal} transparent animationType="slide" onRequestClose={() => setBudgetModal(false)}><KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={s.sheet}><View style={s.handle} /><Text style={s.sheetTitle}>ตั้งงบ • {monthLabel(month)}</Text><Text style={s.label}>หมวดหมู่</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categoryChoices}>{categories.map((x) => <Pressable key={x} onPress={() => setBudgetCategory(x)} style={[s.categoryChoice, budgetCategory === x && s.categoryChoiceOn]}><Text style={[s.categoryChoiceText, budgetCategory === x && { color: C.green, fontWeight: '800' }]}>{x}</Text></Pressable>)}</ScrollView><Text style={s.label}>งบประมาณ (บาท)</Text><TextInput style={[s.input, { fontSize: 20, fontWeight: '800' }]} value={budgetAmount} onChangeText={setBudgetAmount} keyboardType="numeric" placeholder="0" /><Pressable style={s.primary} onPress={saveBudget}><Text style={s.primaryText}>บันทึกงบประมาณ</Text></Pressable><Pressable style={s.cancel} onPress={() => setBudgetModal(false)}><Text style={s.cancelText}>ยกเลิก</Text></Pressable></View></KeyboardAvoidingView></Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.dark, paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 18 : 10, paddingBottom: 54, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hello: { color: '#A9CABB', fontSize: 11, maxWidth: 230 }, brand: { color: C.white, fontSize: 24, fontWeight: '900', marginTop: 2 }, logout: { backgroundColor: '#285440', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 15 }, logoutText: { color: C.white, fontWeight: '700', fontSize: 12 },
  content: { paddingHorizontal: 16, paddingBottom: 110 }, monthNav: { marginTop: -37, marginBottom: 10, height: 42, backgroundColor: '#24503D', borderRadius: 18, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, monthArrow: { color: C.white, fontSize: 30 }, monthText: { color: C.white, fontWeight: '800' },
  summary: { backgroundColor: C.white, borderRadius: 22, padding: 20, shadowColor: C.dark, shadowOpacity: .12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5 }, summaryLabel: { color: C.muted, fontSize: 12 }, balance: { color: C.ink, fontSize: 32, fontWeight: '900', marginVertical: 7 }, summaryRow: { flexDirection: 'row', marginTop: 7 }, summaryHalf: { flex: 1 }, vline: { width: 1, backgroundColor: C.line, marginHorizontal: 14 }, smallMuted: { color: C.muted, fontSize: 11 }, income: { color: C.green, fontWeight: '800', fontSize: 15, marginTop: 4 }, expense: { color: C.red, fontWeight: '800', fontSize: 15, marginTop: 4 },
  panel: { backgroundColor: C.white, borderRadius: 18, padding: 16, marginTop: 12, borderWidth: 1, borderColor: '#EBF2ED' }, panelTitle: { color: C.ink, fontSize: 15, fontWeight: '900', marginBottom: 12 }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between' }, link: { color: C.green, fontWeight: '800', fontSize: 12 }, chartRow: { marginBottom: 11 }, chartLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }, chartLabel: { color: C.ink, fontSize: 12, fontWeight: '700' }, chartValue: { color: C.muted, fontSize: 11 }, track: { height: 7, borderRadius: 4, backgroundColor: '#EDF3EF', overflow: 'hidden' }, bar: { height: 7, borderRadius: 4, backgroundColor: C.red }, budgetBar: { height: 7, borderRadius: 4 }, budgetRow: { marginBottom: 12 }, emptyBudget: { backgroundColor: C.pale, borderRadius: 18, padding: 16, marginTop: 12 }, emptyBudgetTitle: { color: C.dark, fontWeight: '900' }, emptyBudgetText: { color: C.green, fontSize: 11, marginTop: 4 },
  tools: { flexDirection: 'row', gap: 8, marginTop: 12 }, toolButton: { flex: 1, backgroundColor: C.white, borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: C.line }, toolIcon: { fontSize: 18 }, toolText: { color: C.ink, fontSize: 10, fontWeight: '700', marginTop: 4 }, sectionTitle: { color: C.ink, fontSize: 19, fontWeight: '900', marginTop: 22, marginBottom: 10 },
  search: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, color: C.ink, marginBottom: 10 }, filterRow: { flexDirection: 'row', gap: 7, marginBottom: 9 }, chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: C.white, borderWidth: 1, borderColor: C.line }, chipOn: { backgroundColor: C.dark, borderColor: C.dark }, chipText: { color: C.muted, fontSize: 11, fontWeight: '700' }, chipTextOn: { color: C.white }, categoryFilter: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: C.pale }, categoryFilterOn: { borderWidth: 1, borderColor: C.green }, categoryFilterText: { color: C.muted, fontSize: 10 },
  tx: { backgroundColor: C.white, borderRadius: 16, padding: 13, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: '#EBF2ED' }, txIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, txIncome: { backgroundColor: C.pale }, txExpense: { backgroundColor: C.redPale }, txArrow: { fontSize: 20, fontWeight: '900' }, txTitle: { color: C.ink, fontWeight: '800', fontSize: 13 }, txMeta: { color: C.muted, fontSize: 10, marginTop: 4 }, txAmount: { fontWeight: '900', fontSize: 13 }, delete: { color: C.red, fontSize: 10, marginTop: 5 }, empty: { alignItems: 'center', paddingTop: 28 }, emptyEmoji: { fontSize: 38 }, emptyTitle: { color: C.ink, fontWeight: '900', marginVertical: 7 },
  fab: { position: 'absolute', right: 18, bottom: 22, backgroundColor: C.green, borderRadius: 28, paddingHorizontal: 20, height: 56, justifyContent: 'center', shadowColor: C.dark, shadowOpacity: .25, shadowRadius: 9, elevation: 7 }, fabPress: { flex: 1, justifyContent: 'center' }, fabText: { color: C.white, fontWeight: '900' },
  overlay: { flex: 1, backgroundColor: 'rgba(10,35,24,.45)', justifyContent: 'flex-end' }, sheet: { backgroundColor: C.white, borderTopLeftRadius: 27, borderTopRightRadius: 27, padding: 20, paddingBottom: Platform.OS === 'ios' ? 32 : 20, maxHeight: '92%' }, handle: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#D5E1DA', alignSelf: 'center', marginBottom: 15 }, sheetTitle: { color: C.ink, fontSize: 21, fontWeight: '900', marginBottom: 15 },
  segment: { flexDirection: 'row', backgroundColor: '#EFF4F1', borderRadius: 13, padding: 4, gap: 4, marginBottom: 14 }, segmentButton: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' }, segmentText: { color: C.muted, fontWeight: '800' }, label: { color: C.ink, fontSize: 11, fontWeight: '800', marginBottom: 6 }, input: { borderWidth: 1, borderColor: C.line, backgroundColor: '#FAFCFA', borderRadius: 13, paddingHorizontal: 13, paddingVertical: Platform.OS === 'ios' ? 12 : 9, color: C.ink, marginBottom: 12 }, categoryChoices: { gap: 7, paddingBottom: 15 }, categoryChoice: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: C.line }, categoryChoiceOn: { backgroundColor: C.pale, borderColor: C.lime }, categoryChoiceText: { color: C.muted, fontSize: 11 },
  formError: { color: C.red, backgroundColor: C.redPale, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 12, lineHeight: 18, fontWeight: '700' }, primary: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' }, primaryText: { color: C.white, fontWeight: '900' }, cancel: { alignItems: 'center', paddingVertical: 13 }, cancelText: { color: C.muted, fontWeight: '700' }, inline: { flexDirection: 'row', gap: 8 }, addSmall: { backgroundColor: C.green, borderRadius: 13, paddingHorizontal: 18, justifyContent: 'center' }, manageRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line }, manageName: { color: C.ink, fontWeight: '700' },
  authPage: { flex: 1, backgroundColor: C.dark }, authHero: { alignItems: 'center', paddingTop: 52, paddingBottom: 40 }, authEmoji: { fontSize: 44 }, authBrand: { color: C.white, fontSize: 30, fontWeight: '900', marginTop: 8 }, authSub: { color: '#A9CABB', marginTop: 5 }, authCard: { flex: 1, backgroundColor: C.bg, borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 22 }, authTabs: { flexDirection: 'row', backgroundColor: '#E7F0EA', borderRadius: 14, padding: 4, marginBottom: 22 }, authTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11 }, authTabOn: { backgroundColor: C.white }, authTabText: { color: C.muted, fontWeight: '800' }, authTabTextOn: { color: C.green }, demoButton: { alignItems: 'center', paddingVertical: 15 }, demoButtonText: { color: C.green, fontWeight: '800' }, authNotice: { color: C.red, backgroundColor: C.redPale, borderRadius: 11, padding: 11, marginTop: 10, textAlign: 'center', fontSize: 12, lineHeight: 18 }, authNoticeSuccess: { color: C.dark, backgroundColor: C.pale }, warning: { color: C.red, textAlign: 'center', fontSize: 11 },
});

