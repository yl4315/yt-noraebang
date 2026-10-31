// 자동 생성, 직접 고치지 말 것 — 원본 departments/design/tokens/tokens.json
// 다시 만들기: departments/design/tokens 에서 node build.mjs · 토큰 v1.2.0 (2026-10-29)
//
// 회사 진동 5가지의 웹 버전 (navigator.vibrate, ms). 값은 expo-haptics 웹 패턴 = 캘린더를 브라우저로 열었을 때와 같다.
// 안드로이드 Kotlin은 캘린더와 같은 VibrationEffect.createWaveform(timings, amplitudes, -1) 값이라 코드상 같다. 웹은 세기(amplitude)를 정할 수 없어 길이만 같다. 실제로 같은 느낌인지는 기기 확인 필요
// 쓰는 법: <script src="haptics.js"></script> 다음 YenaHaptics.play('tap')
(function () {
  var patterns = {
    tap: [50], // 모든 버튼·날짜·칩·스위치를 누를 때 (자동)
    hold: [60], // 길게 눌러 잡았을 때 (끌기 시작)
    tick: [50], // 끄는 중 다른 날·다른 줄을 지날 때마다
    success: [40, 100, 40], // 놓았을 때, 저장, 체크, 말로 기록 성공
    warning: [50, 100, 50], // 지우기 첫 탭(이때는 tap 대신 이것만), 미래 날짜 체크 시도, 말로 기록 실패
  };
  window.YenaHaptics = {
    patterns: patterns,
    play: function (name) {
      try {
        if (navigator.vibrate) navigator.vibrate(patterns[name] || patterns.tap);
      } catch (e) {}
    },
  };
})();
