// YT 노래방 · 공용 도구: 화면 요소 찾기, 시간 표시, 알림
'use strict';

const $ = s => document.querySelector(s);
const fmt = t => { if (!isFinite(t) || t < 0) t = 0; return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
const fmtMs = t => { t = Math.round(t * 100) / 100; const m = Math.floor(t / 60); return String(m).padStart(2, '0') + ':' + (t - m * 60).toFixed(2).padStart(5, '0'); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let toastTimer;
// 회사 진동 (js/haptics.js, 디자인실 복사본): 손가락으로 쓰는 화면에서만. tap 누르기 · success 예약·저장 · warning 취소 (CR-018)
function haptic(kind = 'tap') { try { if (matchMedia('(hover:none)').matches) window.YenaHaptics?.play(kind); } catch {} }
// CR-242 N1: 창(dialog)이 열려 있으면 알림을 그 창 안에 둔다. 창은 맨 위 층(showModal)이라 body에 있는 알림은 창 뒤로 숨는다.
// 창 안 알림은 창 위쪽(창 위 끝 + 12px, css `dialog > .toast`)에 뜬다: 아래는 [닫기][저장] 자리.
// 창이 겹치면(설정 위 손님 창) 손이 가 있는 창, 창이 닫히면 남은 창이나 body로 돌아간다 (같은 알림 하나라 사라지거나 두 번 뜨지 않음)
function toastHome() {
  const open = [...document.querySelectorAll('dialog[open]')];
  return open.find(d => d.contains(document.activeElement)) || open[open.length - 1] || document.body;
}
function toastPlace(el) {
  const home = toastHome();
  if (el.parentNode !== home) home.append(el);
  if (home !== document.body) home.style.setProperty('--toast-top', Math.max(12, Math.round(home.getBoundingClientRect().top) + 12) + 'px');
}
function toast(msg, ms = 3000) {
  const el = $('#toast'); toastPlace(el); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, ms);
}
// 창이 열리고 닫힐 때(open 속성) 알림 자리를 다시 고른다: 그리기 전에 옮겨져서 깜빡이지 않는다 (브라우저 밖 시험 tests/load-core.js에는 없어서 건너뜀)
if (typeof MutationObserver === 'function') new MutationObserver(recs => {
  const el = $('#toast');
  if (el && recs.some(r => r.target.localName === 'dialog')) toastPlace(el);
}).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
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
