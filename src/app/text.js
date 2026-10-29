// 界面文字（简体中文）。术语与来源表格保持一致：问题类型、发生次数、已处理、占比例、总计。
export const T = {
  appName: 'QT软件问题统计汇总',
  tabs: { import: '导入图片', review: '待复核', summary: '月度汇总', history: '历史记录' },
  col: { no: '序号', item: '问题类型', occ: '发生次数', proc: '已处理', backlog: '未处理', pct: '占比例' },
  status: { queued: '排队中', working: '识别中', review: '待复核', done: '已确认', error: '出错', duplicate: '重复图片' },
  issue: {
    unreadable: (r) => `第${r + 1}行：无法识别数字`,
    low_confidence: (r) => `第${r + 1}行：数字识别不确定`,
    processed_exceeds: (r) => `第${r + 1}行：已处理大于发生次数`,
    unknown_name: (r) => `第${r + 1}行：问题类型未确认`,
    no_rows: () => '未找到任何数据行',
    no_total: () => '未识别到图片中的总计行',
    unreadable_total: () => '无法识别总计行的数字',
    sum_mismatch: (_r, i) => `各行合计（${i.sums.occ}/${i.sums.proc}）与图片总计（${i.total.occ}/${i.total.proc}）不一致`,
    duplicate_item: () => '有问题类型重复出现',
    suggested: (r) => `第${r + 1}行：数字由“总计”推算而来，请对照原图确认`,
  },
};

export const errorText = (e) => ({
  NO_HEADER: '未找到表格的蓝色表头——这是统计表截图吗？',
  NO_ROWS: '无法识别表格的行线，请使用更清晰的截图，或裁剪到表格边缘。',
  NO_COLUMNS: '无法识别足够的列（需要名称列和两列数字）。',
}[e?.code] || `无法读取图片：${e?.message || e}`);
