// YT 노래방 · 공용 도구: 화면 요소 찾기, 시간 표시, 알림
'use strict';

const $ = s => document.querySelector(s);
const fmt = t => { if (!isFinite(t) || t < 0) t = 0; return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
const fmtMs = t => { t = Math.round(t * 100) / 100; const m = Math.floor(t / 60); return String(m).padStart(2, '0') + ':' + (t - m * 60).toFixed(2).padStart(5, '0'); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let toastTimer;
function toast(msg, ms = 3000) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, ms);
}
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || '', textContent: text ?? '' });
const pad2 = n => String(n).padStart(2, '0');
const fmtBytes = b => b >= 1e9 ? (b / 1e9).toFixed(1) + 'GB' : Math.max(0, Math.round(b / 1e6)) + 'MB';
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
// 객체에서 정해진 칸만 골라낸다 (빈 값은 뺀다)
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined && o[k] !== null).map(k => [k, o[k]]));
// localStorage는 막혀 있을 수 있어서(사생활 보호 창 등) 항상 try로 감싼다
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
// 검색용: 띄어쓰기·대소문자를 무시하고, 한글은 초성(ㅂㅍㅈ)으로도 찾을 수 있게
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const chosung = str => [...str].map(ch => { const c = ch.charCodeAt(0) - 0xAC00; return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch; }).join('');
const norm = str => (str || '').toLowerCase().replace(/\s+/g, '');
