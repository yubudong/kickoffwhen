export function SessionProgress({
  current,
  total,
  roundNumber,
}: {
  current: number;
  total: number;
  roundNumber: number;
}) {
  return (
    <div aria-label={`第 ${current} / ${total} 题`} className="dictation-progress">
      <strong>第 {current} / {total} 题</strong>
      <span>第 {roundNumber} 轮</span>
      <progress aria-label="听写进度" max={total} value={current} />
    </div>
  );
}
