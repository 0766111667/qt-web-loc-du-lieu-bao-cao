// Toàn bộ chữ hiển thị (tiếng Việt). Thuật ngữ thống nhất: Lô nhập, Hạng mục, Phát sinh, Đã xử lý, Tồn, Cần xem lại, Kiểm tra khớp.
export const T = {
  appName: 'Tổng hợp sự cố QT',
  tabs: { import: 'Nhập ảnh', review: 'Cần xem lại', summary: 'Tổng hợp tháng', history: 'Lịch sử' },
  col: { no: 'STT', item: 'Hạng mục', occ: 'Phát sinh', proc: 'Đã xử lý', backlog: 'Tồn', pct: 'Tỷ lệ' },
  status: { queued: 'Đang chờ', working: 'Đang đọc', review: 'Cần xem lại', done: 'Đã duyệt', error: 'Lỗi', duplicate: 'Ảnh trùng' },
  issue: {
    unreadable: (r) => `Dòng ${r + 1}: không đọc được số`,
    low_confidence: (r) => `Dòng ${r + 1}: số đọc chưa chắc`,
    processed_exceeds: (r) => `Dòng ${r + 1}: đã xử lý lớn hơn phát sinh`,
    unknown_name: (r) => `Dòng ${r + 1}: hạng mục chưa xác định`,
    no_rows: () => 'Không tìm thấy dòng dữ liệu nào',
    no_total: () => 'Không nhận ra dòng tổng trên ảnh',
    unreadable_total: () => 'Không đọc được số ở dòng tổng',
    sum_mismatch: (_r, i) => `Tổng các dòng (${i.sums.occ}/${i.sums.proc}) khác tổng trên ảnh (${i.total.occ}/${i.total.proc})`,
    duplicate_item: () => 'Có hạng mục xuất hiện hai lần',
  },
};

export const errorText = (e) => ({
  NO_HEADER: 'Không thấy hàng tiêu đề xanh của bảng — ảnh có đúng là bảng thống kê không?',
  NO_ROWS: 'Không dò được các dòng của bảng. Thử ảnh rõ hơn hoặc cắt sát bảng.',
  NO_COLUMNS: 'Không dò được đủ cột (cần cột tên + 2 cột số).',
}[e?.code] || `Không đọc được ảnh: ${e?.message || e}`);
