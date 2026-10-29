// Ghi file .xlsx thật (không cần thư viện): zip không nén + XML. Có biểu đồ cột "tháng này so với tháng trước".
const enc = new TextEncoder();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- ZIP (store) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function zip(files) { // files: [{ name, data: string|Uint8Array }]
  const parts = [], central = []; let offset = 0;
  const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    const local = new Uint8Array([0x50, 0x4b, 3, 4, ...common, ...name]);
    parts.push(local, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), 0, 0]);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- Bảng tính ----------
const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
// Kiểu ô: 0 thường, 1 tiêu đề, 2 phần trăm, 3 đậm, 4 dòng tổng, 5 số thay đổi (+/−), 6 cảnh báo, 7 tổng (số)
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0&quot;%&quot;"/><numFmt numFmtId="165" formatCode="+0;-0;0"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFA85B00"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFBE6D3"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="2" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
</cellXfs></styleSheet>`;

function sheetXml(sheet, drawingRid) {
  const rows = sheet.rows.map((cells, r) => {
    const cs = cells.map((c, i) => {
      if (c == null || c === '') return '';
      const v = typeof c === 'object' ? c.v : c, s = typeof c === 'object' ? c.s || 0 : 0, ref = `${colName(i)}${r + 1}`;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}"${sheet.headerRow === r ? ' ht="30" customHeight="1"' : ''}>${cs}</row>`;
  }).join('');
  const cols = (sheet.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"${sheet.first ? ' tabSelected="1"' : ''}><pane ySplit="${(sheet.headerRow ?? 0) + 1}" topLeftCell="A${(sheet.headerRow ?? 0) + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows}</sheetData>${drawingRid ? `<drawing r:id="${drawingRid}"/>` : ''}</worksheet>`;
}

const chartXml = ({ sheetName, n, title, series }) => {
  const q = `'${sheetName.replace(/'/g, "''")}'`;
  const ser = series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${q}!$${s.col}$1</c:f></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/><c:cat><c:strRef><c:f>${q}!$B$2:$B$${n + 1}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${q}!$${s.col}$2:$${s.col}$${n + 1}</c:f></c:numRef></c:val></c:ser>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:rPr lang="zh-CN" sz="1400" b="1"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}<c:gapWidth val="80"/><c:axId val="111111"/><c:axId val="222222"/></c:barChart><c:catAx><c:axId val="111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="111111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
};

const drawingXml = (fromCol, fromRow, toCol, toRow) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><xdr:twoCellAnchor><xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;

// sheets: [{ name, rows: [[cell…]], widths, headerRow, chart?: { title, n, series:[{col,color}], anchor:[c0,r0,c1,r1] } }]
export function buildXlsx(sheets) {
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = [];
  const hasChart = sheets.some((s) => s.chart);
  files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${hasChart ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' : ''}</Types>` });
  files.push({ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
  files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: 'xl/styles.xml', data: STYLES });
  sheets.forEach((s, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml({ ...s, first: i === 0 }, s.chart ? 'rId1' : null) });
    if (s.chart) {
      files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/drawing" Target="../drawings/drawing1.xml"/></Relationships>` });
      files.push({ name: 'xl/drawings/drawing1.xml', data: drawingXml(...s.chart.anchor) });
      files.push({ name: 'xl/drawings/_rels/drawing1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/chart" Target="../charts/chart1.xml"/></Relationships>` });
      files.push({ name: 'xl/charts/chart1.xml', data: chartXml({ sheetName: s.name, ...s.chart }) });
    }
  });
  return zip(files);
}

// ---------- Báo cáo tháng ----------
// agg: kết quả aggregate(); cmp: compareMonths(); daily: { dates, items:[{id,label}], values: Map(date→Map(item→occ)) }; anomalies: findAnomalies()+mô tả
export function buildReportXlsx({ agg, cmp, daily, anomalies = [], monthLabel, prevLabel }) {
  const head = ['序号', '问题类型', '发生次数', '已处理', '未处理', '占比例(%)', `${prevLabel}发生次数`, '较上月变化', '变化(%)'].map((v) => ({ v, s: 1 }));
  const used = cmp.rows.map((r, i) => ({ r, a: agg.rows[i] })).filter(({ r, a }) => r.occ || r.prevOcc || a.proc);
  const body = used.map(({ r, a }, i) => [i + 1, r.label, r.occ, a.proc, { v: a.backlog, s: a.backlog > 0 ? 6 : 0 }, { v: Math.round(a.pct * 10) / 10, s: 2 }, r.prevOcc, { v: r.delta, s: 5 }, r.pct == null ? '—' : { v: Math.round(r.pct * 10) / 10, s: 2 }]);
  const total = [{ v: '', s: 4 }, { v: '总计', s: 4 }, { v: agg.totals.occ, s: 4 }, { v: agg.totals.proc, s: 4 }, { v: agg.totals.backlog, s: 4 }, { v: agg.totals.occ ? 100 : 0, s: 7 }, { v: cmp.totals.prevOcc, s: 4 }, { v: cmp.totals.delta, s: 4 }, cmp.totals.pct == null ? { v: '—', s: 4 } : { v: Math.round(cmp.totals.pct * 10) / 10, s: 7 }];
  const sheets = [{
    name: `${monthLabel}汇总`.slice(0, 31), headerRow: 0, widths: [6, 28, 12, 10, 10, 11, 16, 12, 10],
    rows: [head, ...body, total],
    chart: used.length ? { title: `${monthLabel}与${prevLabel}发生次数对比`, n: used.length, series: [{ col: 'C', color: '1F4E79' }, { col: 'G', color: 'E8A361' }], anchor: [10, 1, 20, 22] } : undefined,
  }];
  // Cột C (本月) và G (上月) dùng làm chuỗi biểu đồ; tên chuỗi lấy từ hàng tiêu đề.
  const dHead = [{ v: '日期', s: 1 }, ...daily.items.map((it) => ({ v: it.label, s: 1 })), { v: '合计', s: 1 }];
  const dRows = daily.dates.map((d) => { const vals = daily.items.map((it) => daily.values.get(d)?.get(it.id) ?? 0); return [d, ...vals, { v: vals.reduce((a, b) => a + b, 0), s: 3 }]; });
  sheets.push({ name: '按日明细', headerRow: 0, widths: [12, ...daily.items.map(() => 14), 8], rows: [dHead, ...dRows] });
  if (anomalies.length) sheets.push({ name: '异常提醒', headerRow: 0, widths: [10, 28, 60], rows: [[{ v: '类型', s: 1 }, { v: '问题类型', s: 1 }, { v: '说明', s: 1 }], ...anomalies.map((a) => [{ spike: '单日突增', month_up: '月度上升', backlog: '未处理积压' }[a.type], a.label, a.text])] });
  return buildXlsx(sheets);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
