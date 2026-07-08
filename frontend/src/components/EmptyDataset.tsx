type Props = {
  title?: string;
  steps?: string[];
};

const DEFAULT_STEPS = [
  '点击右上角导入，上传交割单或币安导出表格',
  '在数据集下拉框中切换已导入的表格',
  '从交易列表选一笔，在 K 线上复盘',
];

export default function EmptyDataset({
  title = '尚无数据集',
  steps = DEFAULT_STEPS,
}: Props) {
  return (
    <div className="oc-empty oc-empty--page">
      <div className="max-w-md space-y-4 text-left">
        <h1 className="oc-empty__title">{title}</h1>
        <ul className="oc-guide-list">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
