// 간단한 비동기 세마포어 — 동시 실행 수를 제한해 대용량 업로드의 메모리 사용을 바운드.
export function makeSemaphore(max) {
  let active = 0;
  const queue = [];
  function acquire() {
    return new Promise((resolve) => {
      if (active < max) { active++; resolve(); }
      else queue.push(resolve);
    });
  }
  function release() {
    if (queue.length) queue.shift()();
    else active = Math.max(0, active - 1);
  }
  return { acquire, release, stats: () => ({ active, waiting: queue.length }) };
}
